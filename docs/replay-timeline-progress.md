# Replay Timeline-First Layout & Timeline Bar Progress

## Reference Baseline

- Phase P0 branch: `replay-timeline-bar` (PR #21 merged into main)
- Phase P1 branch: `replay-timeline-p1`
- Branched from `origin/main` commit SHA:
  `f3530fe6e9d64dc17cef679e4aa84eb9030fb230`
- Base commit description: `Merge pull request #21 from smangat1/replay-timeline-bar` (Phase P0 time-field gate investigation doc).
- This SHA is the strict revert baseline for all work in Phase P1.

---

## Phase P0 — Time-Field Gate (Investigation & Data Model Verification)

Status: complete. Gate passed.

### Investigation Scope & Sources of Truth
- Python Backend Models: `src/faultmesh/replay/models.py`
- Python Store Implementation: `src/faultmesh/replay/store.py`
- Python Export & Timeline Views: `src/faultmesh/replay/views.py`
- Python Chapters Module: `src/faultmesh/replay/chapters.py`
- Real Serialized Fixtures:
  - `tests/fixtures/replay/fixture_replay_v2_enriched.json` (`replay-export-2.0`)
  - `tests/fixtures/replay/fixture_replay_v1_nomodel.json` (`replay-export-1.0`)

---

### Gate Findings

#### 1. Actual `captured_at` / `observed_at` Precision and ISO Format
- **Generation**: Backend generates timestamps using `datetime.now(UTC)` in `src/faultmesh/replay/store.py` (`_now()`) and `src/faultmesh/replay/adapter.py`.
- **Serialization**: Serialized via Pydantic v2 `StrictModel` (`model_dump(mode="json")` and `model_dump_json()`).
- **Precision**: Microsecond precision (6 decimal places), e.g. `2026-10-28T23:34:43.547425Z`.
- **ISO Format**: UTC ISO 8601 string terminating with a literal `Z` (e.g. `YYYY-MM-DDTHH:MM:SS.ffffffZ`).
- **Client Parsing**: In TypeScript/JS, `new Date(isoString).getTime()` parses microsecond UTC strings ending with `Z` seamlessly, truncating or rounding sub-milliseconds to millisecond integer timestamps.

#### 2. Timezone Offsets and Export Round-Trip
- **Verification**: Verified using Pydantic `model_dump(mode="json")` and `TimelineEntry.model_validate()`. Timezone offsets survive round-trip (e.g. `2026-10-28T17:30:00.123456-04:00` preserves `TzInfo(-14400)`).
- **Backend Standard**: The backend store and capture code standardizes internal timestamps to UTC (`datetime.now(UTC)`), serialized with `Z`.
- **Client Invariance**: `Date.parse(isoString)` in standard JavaScript converts both `Z` and explicit offsets (`+HH:MM` / `-HH:MM`) directly into UTC epoch milliseconds. Timeline calculations are therefore invariant to client or server local timezones.

#### 3. Timeline Order: `captured_at` vs `sequence` Monotonicity
- **Store Order**: `src/faultmesh/replay/store.py` line 670 executes `SELECT record_json FROM records WHERE session_id = ? ORDER BY sequence`. The timeline entries in `ReplayExport.timeline` are strictly ordered by integer `sequence` (1, 2, 3...).
- **Discrepancy Analysis**:
  - In standard capture, `captured_at` is monotonically non-decreasing.
  - However, consecutive records captured rapidly during the same microsecond tick can share the exact same timestamp (`captured_at[i+1] == captured_at[i]`).
  - System clock adjustments (e.g., NTP corrections) or imported log rotations could theoretically introduce cases where `captured_at[i+1] < captured_at[i]`.
- **Design Decision for P1 Geometry**:
  - `sequence` remains the primary index of chronological progression; steps are positioned strictly in sequence order.
  - In the time model, delta times between consecutive steps `i` and `i+1` are clamped to non-negative: `Math.max(0, t[i+1] - t[i])`. Steps never move backwards or visually invert order on the timeline bar.

#### 4. `exported_at` Relationship to Last Record's `captured_at`
- **Definition in Code**: In `src/faultmesh/replay/views.py` lines 312-314:
  ```python
  exported_at=max(
      (record.captured_at for record in records), default=session.created_at
  )
  ```
- **Confirmation**: `exported_at` exactly equals the maximum `captured_at` across all records in the session (falling back to `session.created_at` only if 0 records exist).
- **Semantics**: `exported_at` is NOT wall-clock export time; it represents the latest stored record time, effectively serving as the session's recorded end time.

#### 5. Chapter Mapping When Boundaries Land on Gaps
- **Chapter Representation**: In `src/faultmesh/replay/chapters.py`, `ReplayChapter` defines sequence ranges: `start_sequence: int` to `end_sequence: int`. Chapters are sequence spans, not continuous time durations.
- **Gap Semantics**: In `src/faultmesh/replay/models.py`, gap records (`record_type == 'gap'`) carry a `gap_reason` (e.g., corrupt input, sequence loss, rotation). Elapsed wall-clock time across a gap is UNKNOWN.
- **Design Decision for P1/P3 Bar Geometry**:
  - A chapter's visual footprint on the timeline bar spans from the horizontal pixel coordinate of `entry[start_sequence]` to `entry[end_sequence]`.
  - When a chapter boundary begins, ends, or includes a gap record:
    1. The gap is drawn as a visually distinct, fixed-width broken/gap region (never proportional elapsed time), showing `gap_reason` on hover.
    2. Chapter segment geometry encompasses the fixed gap width without pretending the elapsed time was recorded.
    3. Duration tooltips on chapter hover show elapsed time only when the chapter contains no gaps; if any gap is spanned, the hover state marks the duration as discontinuous / unknown.

#### 6. Available Project-Map Structure Data for Replay Imports
- **Available Structure Data**:
  - Checkpoint Manifests: Each checkpoint's manifest (`SnapshotManifest`) in `exported.manifests` lists `files: CapturedFile[]` with `path`, `content_sha256`, `size`, and `parse_error`.
  - Changed Symbols: Each timeline entry provides `changed_symbols: ChangedSymbolView[]` with function/class qualified names, kinds, changes (`added`, `modified`, `deleted`), and `verified: bool` (AST freshness).
- **Unavailable Data**:
  - Whole-project dependency graph edges (cross-file imports, call graph edges) are NOT serialized in replay exports (`edges: []` in `replayAdapter.ts`).
- **Design Decision for P4 Mini-Map Dock**:
  - When manifest files are present, the mini-map renders the read-only file cluster nodes and symbol nodes derived from the active checkpoint's manifest and changed symbols.
  - When a recording carries no manifest files or no structure data, the mini-map dock displays an honest empty state explaining that the recording contains no project structure data, strictly avoiding blank panes or fabricated mock nodes.

---

### Gate Verdict
`captured_at` is present on 100% of recorded timeline entries with microsecond ISO 8601 UTC timestamps. Time-based spacing is valid and deterministic.
**Phase P0 Gate is PASSED.**

---

## Phase P1 — Time Model + Unit Tests

Status: complete. 18/18 unit tests passed, full suite 24/24 files (197 tests + 8 electron tests) passed, build clean.

### Implementation Summary
- **Module**: `ui/src/replay/timeModel.ts`
  - Pure TypeScript geometry and timing calculator for the hero timeline bar.
  - Takes `timeline: TimelineEntry[]`, `tests?: StructuredTestEvidence[]`, `chapters?: ReplayChapter[]`, and configurable `options?: TimeModelOptions`.
  - Calculates proportional time positions along `[0.0, 1.0]` with visual separation guarantees (`minIntervalWeightMs`).
  - Identifies idle stretches exceeding `idleThresholdMs` (default 5m), caps their visual weight to `cappedIdleWeightMs`, and generates `AxisBreak` data with human-readable labels (e.g. `2h 14m idle`, `30m idle`).
  - Identifies gap records (`record_type === 'gap'`), allocates `fixedGapWeightMs` (since elapsed time is unknown), and generates `GapRegion` items preserving `gapReason` (e.g., `corrupt input`, `sequence loss`).
  - Accurately tracks tool call durations strictly for matching `pre_tool` and `post_tool` pairs with the same `tool_use_id`.
  - Maps `ReplayChapter` sequence ranges to bar coordinate ratios, flags model interpretations (`isModelInterpretation: boolean`), and detects gap spans (`spansGap: boolean`). Chapters spanning gaps have `durationMs = null` to maintain strict data honesty.
  - Maps `StructuredTestEvidence` to bar positions via command record linkage, manifest association, or interpolated timestamps.
  - Clamps clock jumps and log rotations using `Math.max(0, nextTs - curTs)` to ensure strictly monotonic sequence ordering.
  - Provides `findNearestStep(ratio)` snap helper, honoring the rule that scrubber thumb snaps to the nearest recorded step and never rests in unrecorded space.
  - Provides strict wall-clock time hover string helper: `formatRecordedAt()` ("recorded at 2:03:22 PM", never "agent spent X on this").

### Unit Test Verification (`ui/src/test/replayTimeModel.test.ts`)
- **Suite**: 18 tests across 11 key scenarios:
  1. `formatRecordedAt`: UTC ISO timestamps formatted into wall-clock times (AM/PM, midnight, invalid fallback).
  2. `formatIdleDuration`: Concise axis-break labels (`15m idle`, `2h 14m idle`, `45s idle`).
  3. `Scenario 1`: Empty session (`timeline: []`) cleanly returns empty geometry with null-safe lookup methods.
  4. `Scenario 2`: Single step session correctly sets `positionRatio: 0.0` and snaps queries to that step.
  5. `Scenario 3`: Normal run with proportional time spacing and visual separation.
  6. `Scenario 4`: Idle stretch over threshold caps virtual weight and creates `AxisBreak` with exact start/center/end ratios.
  7. `Scenario 5`: Gap mid-run allocates fixed gap weight and creates `GapRegion` with `gapReason`.
  8. `Scenario 6`: Rotation clock jumps / timestamp regressions preserve monotonic sequence ordering without backwards positions.
  9. `Scenario 7`: Chapter spanning a gap sets `spansGap: true` and `durationMs: null`.
  10. `Scenario 8`: Chapters from all three source values (`deterministic_prompt_turn`, `deterministic_fixed_group`, `model`) and both title statuses (`deterministic template`, `model interpretation`).
  11. `Scenario 9`: Tool call duration calculated for matching `pre_tool` and `post_tool` pairs with matching `tool_use_id`.
  12. `Scenario 10`: `findNearestStep(ratio)` snaps accurately to nearest recorded step for various position queries and clamps bounds.
  13. `Scenario 11`: Maps test markers with pass/fail/error and neutral states.

### Quality & Verification Results
- `npm test`: 24/24 test files passed (197 Vitest tests, 8 Electron node tests).
- `npm run build`: `tsc && vite build` passed with zero errors.

---

## Next Phase: P2 — Visual Foundation & Tokens
- Introduce calm black/gray/dark-blue tokens in `ui/src/index.css` (layered blue-gray surfaces, 1px low-contrast borders, soft shadows, rounded corners, quiet metadata).
- Apply tokens strictly to the replay workspace scope (`ReplayWorkspace`, `ReplayTimeline`, `ReplayDiffViewer`, `ReplayEvidenceInspector`, replay header elements).
- Leave entry screens (`StartupScreen`, `ProjectSelectorScreen`, `LiveEntranceScreen`) and live/spectate workspace untouched.
- Run tests and take real screenshots.
- How to resume: Run `continue` to proceed to Phase P2 implementation.
