# Replay Timeline-First Layout & Timeline Bar Progress

## Reference Baseline

- Phase P0 branch: `replay-timeline-bar` (PR #21 merged into main)
- Phase P1 branch: `replay-timeline-p1` (PR #22 merged into main)
- Phase P2 branch: `replay-timeline-p2` (PR #23 merged into main)
- Phase P3 branch: `replay-timeline-p3`
- Branched from `origin/main` commit SHA:
  `957aa27d70ec305f25c5fcd3ffe6b09f0808f406`
- Base commit description: `Merge pull request #23 from smangat1/replay-timeline-p2` (Phase P2 visual foundation and token system).
- This SHA is the strict revert baseline for all work in Phase P3.

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

## Phase P2 — Visual Foundation & Tokens

Status: complete. Visual token system implemented, applied across all replay components, WCAG AA verified, zero purple/yellow regressions, 25/25 test files passing (202 vitest tests, 8 electron tests), real fresh screenshots captured.

### Implementation Summary
- **Token System**: `ui/src/styles/replay.css` (imported via `ui/src/styles/theme.css` and `ui/src/index.css`)
  - Strict black/gray through dark-blue palette translated from Homeboard iOS design language:
    - Canvas: `--replay-bg-canvas` (`#07090e`, near-black with dark blue cast)
    - Surface 1: `--replay-bg-surface-1` (`#0d111a`, deep blue-gray container panes)
    - Surface 2: `--replay-bg-surface-2` (`#141a26`, raised cards, header, drawers)
    - Surface 3: `--replay-bg-surface-3` (`#1c2436`, active/hover states)
    - Code: `--replay-bg-code` (`#090c12`, diff editor background)
    - Borders: `--replay-border-subtle` (`rgba(255,255,255,0.06)`), `--replay-border-card` (`rgba(255,255,255,0.09)`), `--replay-border-focus` (`rgba(96,140,200,0.45)`)
    - Text: `--replay-text-primary` (`#e6edf8`, passes WCAG AAA at 16:1), `--replay-text-muted` (`#8b97ad`, passes WCAG AA at 6.5:1), `--replay-text-faint` (`#4d576a`)
    - Accent: `--replay-accent` (`#4a7bb0`, muted steel blue), `--replay-accent-glow` (`rgba(74,123,176,0.15)`)
    - Calm status tokens:
      - Complete/Verified: `--replay-status-complete` (`#4a7bb0` steel blue)
      - Warning: `--replay-status-warning` (`#946c32` muted amber, only for genuine completeness warnings or gap alerts)
      - Danger: `--replay-status-danger` (`#9c4444` muted rose, only for test failures or contradicted claims)
      - Neutral: `--replay-status-neutral` (`#5a6578` quiet gray-blue, for skipped/unmatched/unsupported)
    - Diff styling: `--replay-diff-add-bg`, `--replay-diff-add-gutter`, `--replay-diff-del-bg`, `--replay-diff-del-gutter`
    - Radii & Shadows: `--replay-radius-panel` (14px), `--replay-radius-card` (10px), `--replay-radius-control` (7px), `--replay-shadow-ambient`, `--replay-shadow-subtle`
    - Motion: `--replay-transition-quick` (160ms cubic-bezier ease-out), respecting prefers-reduced-motion.
- **Component Application**:
  - `ReplayWorkspace.tsx`: Header, sequence badge, navigation buttons, honesty origin badges, and completeness warnings updated with calm tokens.
  - `ReplayTimeline.tsx`: Panes, chapter list, checkpoint sequence list, and pass/fail indicators calmed; removed deprecated purple and neon cyan.
  - `ReplayDiffViewer.tsx`: Diff canvas, empty state cards, file selector tabs, unified diff lines, and stale AST warning badges calmed.
  - `ReplayEvidenceInspector.tsx`: Inspector tabs, likely-reason cards, atomic claim cards, citation validity badges, test observation cards, and summary audit cards calmed; removed deprecated purple `#c084fc` and neon badges.
- **Scope Integrity**:
  - Strictly zero touches to startup/entry screens (`StartupScreen`, `ProjectSelectorScreen`, `LiveEntranceScreen`).
  - Strictly zero touches to live/spectate workspace screens.

### Testing & Verification (`ui/src/test/replayVisualTokens.test.tsx`)
- **Suite**: 5 comprehensive visual & contrast tests:
  1. Primary text passes WCAG AAA contrast (>= 7:1) on all dark surfaces (`#07090e`, `#0d111a`, `#141a26`).
  2. Muted text passes WCAG AA contrast (>= 4.5:1) on all dark surfaces.
  3. Accent elements pass WCAG 2.1 graphical & UI component contrast (>= 3.0:1).
  4. `ReplayWorkspace` renders calm tokens without deprecated purple (`#c084fc`), yellow (`#fbbf24`), bright green (`#10b981`), or bright red (`#ef4444`).
  5. `ReplayEvidenceInspector` renders calm status tokens for claims, model inference, and tests.
- **Test Suite Results**:
  - `npm test`: 25/25 test files passed (202 Vitest tests, 8 Electron node tests).
  - `npm run build`: `tsc && vite build` passed cleanly with zero errors.

### Real Screenshot Capture
- Re-captured all 8 distinct screenshots in `docs/screenshots/replay/` against real fixtures (`fixture_replay_v2_enriched.json` and `fixture_replay_v1_nomodel.json`) using headless Chrome at 1440x900 and 1024x700:
  - `01_whole_recording_chapters_diff_1440x900.png` & `1024x700.png`
  - `02_failed_test_state_match_1440x900.png` & `1024x700.png`
  - `03_evidence_inspector_verdicts_reason_1440x900.png` & `1024x700.png`
  - `04_nomodel_partial_missing_evidence_1440x900.png` & `1024x700.png`

---

## Phase P3 — Hero Timeline Bar Component

Status: complete. Hero scrubber component implemented with pure time geometry, calm tokens, animated thumb snap (Rule 2), full keyboard navigation, ARIA slider accessibility, and rich hover tooltips. 10/10 unit tests passed; full UI test suite 26/26 files (212 Vitest tests + 8 Electron tests) passing; production build clean.

### Implementation Summary
- **Component**: `ui/src/components/replay/ReplayTimelineBar.tsx`
  - Integrated with pure time model `computeTimelineBarGeometry` from `ui/src/replay/timeModel.ts`.
  - **Chapter Lane**:
    - Bracketed spans showing sequence ranges and titles.
    - Model interpretations labeled with subtle dashed border and `model` pill tag.
    - Deterministic template chapters rendered with solid accent border.
    - Clicking any chapter bracket jumps directly to `start_sequence`.
    - Rich hover tooltip displaying title, sequence range, title status, and duration (flagging `Discontinuous` if gap spanned).
  - **Main Track Lane**:
    - Axis breaks rendered with idle labels (e.g. `15m idle`, `32m idle`) and SVG squiggles for stretches over threshold.
    - Gap stretches rendered with diagonal warning hatch pattern (`var(--replay-status-warning-bg)`) and `GAP` badge; hover reveals `gapReason` with "elapsed wall-clock time unknown".
    - Step ticks along track with dedicated styles for tools (`.tick-tool`), gaps (`.tick-gap`), and active selection (`.tick-selected`).
    - Test markers along track showing pass (`.test-pass` circle), fail/error (`.test-fail` diamond), and neutral states; clicking jumps to associated sequence.
    - **Hero Scrubber Thumb (Rule 2 Compliance)**:
      - Thumb pill with calm steel-blue fill (`var(--replay-accent)`), subtle white border, centered grip lines, and ambient shadow.
      - Animated snap transition (`160ms cubic-bezier(0.16, 1, 0.3, 1)`) respecting `prefers-reduced-motion`.
      - **Rule 2 Strictly Enforced**: On click and drag, thumb position is strictly derived from `nearestStep.positionRatio`. Thumb never rests in unrecorded floating space between steps.
  - **Footer Strip**:
    - Left: local start time (`timeline[0].captured_at`).
    - Center: active step indicator (`Step #X of Y`, `record_type`, local wall time, tool duration for pre/post pairs, gap reason).
    - Right: local end time.
  - **Accessibility**:
    - `role="slider"`, `tabIndex={0}`, `aria-label="Timeline scrubber"`.
    - `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and descriptive `aria-valuetext`.
    - Keyboard navigation: Left/Right arrows or j/k (step prev/next), Home/End (first/last step), PgUp/PgDn (prev/next chapter start).
- **Workspace Integration**: `ui/src/components/replay/ReplayWorkspace.tsx`
  - Wired `ReplayTimelineBar` as the hero element directly below the header spanning full workspace width.
  - Connected two-way to session step navigation (`currentSeq`, `handleSelectSequence`, timeline ticks, diff viewer, evidence inspector, and header sequence badge).
  - Wired `adapter.getAllTests()` and dynamic timeline options (`timeline-options-changed`).
- **Styles**: `ui/src/styles/replay.css`
  - Added dedicated classes for `.replay-timeline-bar-root`, chapter lane/segments, track lane/rail, axis breaks, gap hatch pattern, ticks, test markers, and thumb scrubber using calm `--replay-*` tokens.

### Unit Test Verification (`ui/src/test/replayTimelineBar.test.tsx`)
- **Suite**: 10 comprehensive tests:
  1. Safe, clean empty state when `timeline: []` (`aria-valuenow="0"`).
  2. Single-step session boundary render with thumb at 0%.
  3. Multi-step session visual elements (accessibility slider, chapters, model tag, ticks, axis break, gap hatch, test markers, thumb, footer).
  4. Rule 2 click snapping: clicking track calculates ratio and snaps strictly to nearest recorded step.
  5. Rule 2 drag snapping: pointer drag across track snaps sequentially to nearest steps.
  6. Chapter click: clicking chapter navigates to `start_sequence`.
  7. Test marker click: clicking test navigates to associated sequence.
  8. Full keyboard navigation: Left/Right, j/k, Home/End, PgUp/PgDn.
  9. Boundary protection: preventing overshoots before first step or beyond last step.
  10. Hover tooltips: chapters (deterministic vs discontinuous model), gap reasons, axis breaks, test results, and mouse leave dismissal.

### Real Screenshot Capture & Data Honesty (`docs/screenshots/replay/`)
- **Strict Data Honesty (Rule 2 Enforcement)**:
  - Completely removed test harness backdoor from production code:
    - Deleted `window.__FAULTMESH_TIMELINE_OPTIONS__` global and its event listener in `ReplayWorkspace.tsx`.
    - Deleted `idleLabel` override from `TimeModelOptions` in `timeModel.ts`.
    - Every visual element and label on `ReplayTimelineBar` is derived strictly from recorded fixture data (`formatIdleDuration` calculates idle label from real timestamps).
  - Added dedicated synthetic replay export fixture `ui/src/fixtures/fixture_replay_timeline_hero.json` (`replay-export-2.0`):
    - Contains 7 chronological records with real timestamps.
    - Honest 15-minute idle stretch between step 5 (`12:03:00Z`) and step 6 (`12:18:00Z`), naturally producing `15m idle` via `formatIdleDuration(900000)` without overrides.
    - Honest mid-run gap record at step 4 (`record_type: "gap"`, `gap_reason: "corrupt input: sequence loss during agent tool execution"`).
    - Chapter 1 (steps 1–3) as deterministic template and Chapter 2 (steps 4–7) as model interpretation.
    - Structured test evidence with 1 passing test at step 3 and 1 failing test (`test_negative_input_raises`) at step 6.
- **Genuine, Distinct Screenshot Scenarios**:
  - Re-captured each scenario as a distinct page state with unique viewport layout and sequence position:
    1. `01_normal_run_${vp.name}.png`: Selected step 3 (`post_tool`), showing diff viewer with `calc.py` changes, deterministic Chapter 1, and Summary Audit tab.
    2. `02_idle_break_axis_label_${vp.name}.png`: Selected step 6, showing honest `15m idle` axis-break squiggle and label on hero bar, red diamond test marker, and failing test in Tests tab.
    3. `03_gap_region_${vp.name}.png`: Selected step 4, showing mid-run gap region on hero bar with diagonal warning hatch pattern, `GAP` badge, and gap reason.
    4. `04_model_interpretation_chapter_${vp.name}.png`: Selected step 7, showing Chapter 2 on hero bar with dashed bracket and `[model]` tag, plus Claims tab with verified/unverified assertions.
  - Eliminated all duplicate captures and redundant alias filenames.
  - Verified 100% unique SHA-256 hashes across all 8 files (zero duplicates):
    | File | SHA-256 Checksum |
    |---|---|
    | `01_normal_run_1024x700.png` | `77e756dc361531637cfc76cd8ed04408bf30ec06b6f32086f81c00a1594cadcb` |
    | `01_normal_run_1440x900.png` | `b163d21bb72c13aca90ef03ae522ef3275267a9be8ccb727b27f64e7f4a3ccdd` |
    | `02_idle_break_axis_label_1024x700.png` | `60856de2e91e19228a35fc91c93f041b155afbe84f77d9baef9ad2b24d7a48d7` |
    | `02_idle_break_axis_label_1440x900.png` | `2083bf87e8251c0331b3d1dfaccff5346b446115bf102215b833d5225e8e8b89` |
    | `03_gap_region_1024x700.png` | `6dee5376337ecacbf72a54503252e08d05616bc8eb09b329896b232e158627c3` |
    | `03_gap_region_1440x900.png` | `8a8d29ece9093d1aefa3dd1b76ad9f0480813ce378286c180603f340811f9960` |
    | `04_model_interpretation_chapter_1024x700.png` | `08c5aa244427344c4e39e40ae41cb232674bf5a7bb1a9d85bf9cc59c1e16c6ed` |
    | `04_model_interpretation_chapter_1440x900.png` | `3c5f2c02970db82b21191e36209644f2a4137ba97e228c3574b3baae0154ed2b` |

### Quality & Verification Results
- `npm test`: 26/26 test files passed (213 Vitest tests including fixture verification, 8 Electron node tests).
- `npm run build`: `tsc && vite build` passed cleanly in 1.75s with zero errors.

---

## Next Phase: P4 — Layout Restructure + Mini-Map Dock
- Restructure `ReplayWorkspace.tsx`:
  - Timeline bar as full-width hero across top of replay workspace.
  - Diff view below as the primary default focus.
  - Chapters accordion and evidence inspector become on-demand panels (left rail and right drawer), closed by default.
  - Project map becomes resizable mini-map dock (persists size and open state in localStorage, shortcut `M` to toggle, drag handle to resize, honest empty state when recording carries no structure data).
- How to resume: Run `continue` to proceed to Phase P4 implementation.
