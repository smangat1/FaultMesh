# Replay Timeline-First Layout & Timeline Bar Progress

## Reference Baseline

- Branch: `replay-timeline-bar`
- Branched from `origin/main` commit SHA:
  `5b29d26e45b41f9bc1a730e3e688bceba2e39e4c`
- Base commit description: `Merge pull request #20 from smangat1/replay-viewer-ui` (includes complete merged replay viewer, typed contracts, sanitized fixtures, and backend contract alignment).
- This SHA is the strict revert baseline for all work in this stream.

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

## Next Phase: P1 — Time Model + Unit Tests
- Create pure TypeScript module `ui/src/replay/timeModel.ts` producing bar geometry (proportional time, capped idle stretches with axis-break squiggles, gap regions, chapter segment bounds, test markers).
- Add unit tests in `ui/src/test/replayTimeModel.test.ts` covering: empty session, single step, normal run, idle stretch over threshold, gap mid-run, rotation clock jump, chapter spanning a gap, chapters from all three source values.
- How to resume: Run `continue` to proceed to Phase P1 implementation.
