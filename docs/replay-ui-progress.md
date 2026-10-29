# Replay UI Progress

## Reference Point

- Branch: `replay-viewer-ui`
- Fresh `origin/main` base and revert/reference SHA:
  `c4e5cde977b0554f6275f8aceca91e2c922e8328`
- Base commit description: Merge PR #19 from smangat1/replay-checked-narration (includes merged replay contracts from Prompt A and B).
- This SHA is a reference only. The implementation must not reset or merge automatically.

## Phase C1 — Adapter + Honest States

Status: complete.

Implemented:
- Typed versioned replay export contracts in `ui/src/replay/types.ts` for both `replay-export-1.0` and `replay-export-2.0`.
- Strict validation in `ui/src/replay/validators.ts`: bounds file size (<= 64 MB), validates schema version, checks all required top-level and narration fields, validates content integrity and detects missing content bytes/partial exports.
- Honest state presentation:
  - Explicit origin: Real Recording vs Synthetic Fixture vs Simulated Demo.
  - Granularity: `tool_boundary` (supported attributed tool step) vs `observed_checkpoint` vs `unknown`.
  - Completeness: `complete`, `partial`, `missing`, `unsupported` with gap reasons.
  - Historical / stopped status is never labeled 'live'.
  - No-model A recordings load seamlessly without demo fallbacks or fake narration.
  - Missing tests remain "not observed", never passing.
- Safe historical source & diff decoding: decodes content-addressed base64 stored bytes purely in-memory; no arbitrary renderer filesystem access.
- Allowlisted narrow Electron IPC: added `openRecording` channel to `ui/electron/spectate-main.cjs`, `spectate-preload.cjs`, and verified with `spectate-main.test.cjs`.
- Preserved project selection/live-watch flow with clean, quiet "Open recording (.json)" action on StartupScreen and Header.
- ReplayAdapter in `ui/src/adapter/replayAdapter.ts` implementing `FaultMeshAdapter` and providing clean historical timeline, checkpoint, and narration queries without leaking simulated data.

Acceptance:
- `cd ui && npx tsc --noEmit`: passed with 0 errors.
- `cd ui && npx vitest run src/test/replayImport.test.ts src/test/replayAdapter.test.ts`: 12 passed.
- `cd ui && npm test`: 20 test files (165 vitest tests) + 8 electron tests passed.

Phase C1 commit: `4384cc0051e59c2357335606d15a9ffca5ea969a`.

## Phase C2 — Replay Workspace

Status: complete.

Implemented:
- Quiet Obsidian/Zotero-style Replay Workspace layout with restrained edges, spacious typography, high contrast, plain labels, and no busy dashboard gimmicks.
- `ReplayTimeline` component:
  - Chapter list with title, sequence range, checkpoint count.
  - Prominent tags: `model interpretation` for model chapters vs `baseline` for deterministic chapters.
  - Checkpoint scrubber/list with sequence `#`, timestamps, tool name, completeness badge, attribution status, and test outcome indicators.
  - Narration ON/OFF toggle and Model vs Baseline chapters comparison toggle.
- `ReplayDiffViewer` component:
  - File selector with status badges (`added`, `modified`, `deleted`).
  - Stored before/after unified diff viewer with addition/deletion color coding and line numbers.
  - Toggle between stored diff and full stored historical source text (decoded safely in-memory from `content_base64_by_sha256`).
  - Stale AST / syntax error handling: displays visible `Stale AST / Syntax error` badge when `verified === false`.
- `ReplayEvidenceInspector` component:
  - Nearby Tests tab: shows exit code, actual test scope, structured pytest counts, individual test node IDs, and state-match distinction (`State matched` vs `nearby in time, code state unverified`). Missing tests are explicitly `not observed`, never passed. Chronological disclaimer included.
  - Checked Atomic Claims tab: 3-way verdicts with plain text labels (`checked against recording`, `contradicted` with strikethrough + reason code & counterevidence, `unsupported / unknown` neutral badge). Never turns paragraphs green; raw claim kept distinct from verdict. Expandable evidence refs.
  - Likely Reason (Model inference): always labeled `likely reason (model inference)`. Verifies citation quotes (`Source quote checked` distinct from intent). Entailment marked `not deterministically assessed` and `verified intent: false`.
  - Summary Audit tab: displays original agent summary text and audited statements with explicit display statuses (`supported`, `contradicted`, `not_supported_by_this_recording`, `unverified`).
  - Limitations tab: displays explicit recording limitations and `evaluation pending` status.
- `ReplayWorkspace` top toolbar:
  - Checkpoint Prev/Next scrubber buttons, current sequence badge, stable record ID, and tool name.
  - Honesty badges: Origin (`REAL RECORDING` / `SYNTHETIC FIXTURE` / `SIMULATED DEMO`), `HISTORICAL (STOPPED)` (never 'live'), `TOOL BOUNDARY` / `OBSERVED CHECKPOINT`, and agent version.
  - Optional Project Map toggle.
  - Accessible keyboard shortcuts: `ArrowLeft` / `j` (previous) and `ArrowRight` / `k` (next).

Acceptance:
- `cd ui && npx tsc --noEmit`: passed with 0 errors.
- `cd ui && npx vitest run src/test/replayViewer.test.tsx src/test/replayEvidence.test.tsx`: 11 passed.
- `cd ui && npm test`: 22 test files (176 vitest tests) + 8 electron tests passed.

Phase C2 commit: `d8b33ad6929837a77d5494cb3d1b821ee5ae042e`.

## Phase C3 — Tests + Real Pixels

Status: complete.

Implemented & Verified:
- Replay fixture generators and sanitized fixtures:
  - `scripts/generate_replay_fixtures.py`: automated script generating realistic, schema-valid, sanitized fixtures.
  - `tests/fixtures/replay/fixture_replay_v2_enriched.json`: `replay-export-2.0` synthetic fixture demonstrating complete manifests, tool boundary checkpoints, model-generated chapters labeled `model interpretation`, unified diffs with AST badges, recorded pytest run with exit code 1 and failed tests, `State matched (man-02)` label, likely reason with source quote citation and `verified intent: false`, 3-way checked atomic claims (checked against recording, strikethrough contradicted with reason code, unsupported/unknown), and complete summary audit statements.
  - `tests/fixtures/replay/fixture_replay_v1_nomodel.json`: `replay-export-1.0` synthetic fixture demonstrating model-unavailable scenarios, missing chapters, observed checkpoint granularity, `partial` completeness with snapshot gaps, missing test observations ("not observed"), and honest empty states without fake narration or simulated leaks.
- Unit and integration tests:
  - Added fixture validation tests in `ui/src/test/replayImport.test.ts` verifying both disk fixtures pass schema, hash, and origin checks.
  - Updated `ui/src/replay/utils.ts` to utilize standard `globalThis.crypto.subtle` avoiding Node crypto bundler warnings in Vite.
  - All 177 UI Vitest unit tests pass.
  - All 8 Electron IPC tests pass.
  - Python replay test suite (18 tests in `test_replay_capture.py` and `test_replay_narration.py`) passes cleanly.
- Visual inspection & pixel capture:
  - Created automated screenshot runner `ui/scripts/capture_replay_screenshots.js` using Chrome headless over `file://` with zero external requests or localhost servers.
  - Captured 8 screenshots across both desktop viewports (1440x900 and 1024x700) into `docs/screenshots/replay/`:
    1. `01_whole_recording_chapters_diff_1440x900.png` & `01_whole_recording_chapters_diff_1024x700.png`: Replay workspace showing 3-column layout, chapter list tagged `model interpretation`, checkpoint scrubber with failure indicator, unified diff with function badge, and evidence inspector.
    2. `02_failed_test_state_match_1440x900.png` & `02_failed_test_state_match_1024x700.png`: Nearby Tests tab showing exit code 1, structured pytest counts (passed: 3, failed: 1, errors: 0, skipped: 0), test node failure output, explicit `State matched (man-02)` badge, and chronological disclaimer.
    3. `03_evidence_inspector_verdicts_reason_1440x900.png` & `03_evidence_inspector_verdicts_reason_1024x700.png`: Evidence Inspector showing `likely reason (model inference)` card with `Source quote checked` and `verified intent: false`, checked atomic claims with strikethrough for contradicted facts with counterevidence reasons, and neutral unsupported claims.
    4. `04_nomodel_partial_missing_evidence_1440x900.png` & `04_nomodel_partial_missing_evidence_1024x700.png`: Graceful degradation for Prompt A/no-model export showing `PARTIAL` gap badge, no fabricated chapters, and honest empty diff and claim states.
  - Visual inspection verified: Obsidian/Zotero calm aesthetic, no layout shift, zero horizontal text clipping at 1024x700, readable strikethrough, high-contrast badges, and strict visual distinction between recorded ground truth and model interpretations.

Acceptance:
- `cd ui && npx tsc --noEmit`: passed with 0 errors.
- `cd ui && npm test`: 22 test files (177 vitest tests) + 8 electron tests passed.
- `python -m pytest tests/unit/test_replay*`: 18 passed.
- `cd ui && npm run build`: production bundle built cleanly (0 errors).

Phase C3 commit: `352e6fb589cb1cb25d67996a10a07a1f3e18ff48`.

## Review Alignment — Backend Contract Alignment & Honesty Polish

Status: complete.

Implemented & Verified:
1. Exact Merged Backend Contract Alignment:
   - Aligned all frontend types and validators in `ui/src/replay/types.ts` and `ui/src/replay/validators.ts` with merged Python backend schemas (`src/faultmesh/replay/models.py`, `narration.py`, `claims.py`, `chapters.py`, `citations.py`):
     - `schema_version` for session, record, manifest, and test evidence: `'replay-store-1.0'`.
     - `SessionStatus`: `'active' | 'stopped'`.
     - `RecordKind`: `'initial_snapshot' | 'pre_tool' | 'post_tool' | 'checkpoint' | 'gap' | 'unsupported'`.
     - `TestAssociation`: `'content_identity' | 'controlled_no_write' | 'nearby_in_time_state_unverified' | 'none'`. Both `content_identity` and `controlled_no_write` render `State matched`.
     - `Chapter.source`: `'deterministic_prompt_turn' | 'deterministic_fixed_group' | 'model'`.
     - `Chapter.title_status`: `'deterministic template' | 'model interpretation'`.
     - `CitationIntegrity`: `'valid_exact_quote' | 'invalid_source_or_quote'`. `'valid_exact_quote'` renders `Source quote checked`.
     - `CheckedLikelyReason.citation_status`: `'valid' | 'invalid' | 'empty'`.
     - `SummaryStatementAudit.display_status`: `'supported_recorded_fact' | 'contradicted_by_complete_recording' | 'not_supported_by_this_recording'`.
     - `ClaimRunRecord.schema_version`: `'replay-claim-run-1.0'` and `final_claims` supports `ClaimBatch` object mapping.
     - Extensible union types with `(string & {})` to render unknown future enum values with neutral raw text.
2. Active-Session Replay Support:
   - `validateReplayExport` accepts active-session exports without errors (`session.status === 'active'`, `session.stopped_at === null`).
   - `ReplayAdapter` sets `replaySessionStatus: session.status` and computes runtime duration from first to last recorded checkpoint.
   - Replay header renders `IN-PROGRESS SNAPSHOT` badge for active sessions.
3. Backend-Generated Sanitized Fixtures & Green CI:
   - Replaced hand-written fixtures with exports generated directly by real backend classes (`ReplayStore`, `export_session`, `build_narration_export`) in `tests/fixtures/replay/fixture_replay_v2_enriched.json` and `fixture_replay_v1_nomodel.json`.
   - Deleted `scripts/generate_replay_fixtures.py` to eliminate 15 ruff line-length violations.
   - All Python tests (`pytest tests/`, 205 passed) and linting (`ruff check .`, 0 errors) pass 100% green.
4. Backend Contract Regression Tests:
   - Added `ui/src/test/replayBackendContract.test.tsx` verifying:
     - Real backend-generated V2 export loads with verified honesty contracts.
     - Model-interpretation chapters labeled `model interpretation`.
     - Contradicted summary statement struck through with line-through styling and `contradicted` badge.
     - Supported fact badged with `supported fact`.
     - `valid_exact_quote` citation displays `Source quote checked`.
     - Both `controlled_no_write` and `content_identity` tests display `State matched`.
     - Active-session export (`fixture_replay_v1_nomodel.json`) imports and displays `IN-PROGRESS SNAPSHOT`.
5. Calmed Obsidian Header & Single Badge Row:
   - Header top bar: calm Obsidian aesthetic showing project name without raw hash fragments, human-formatted duration (`formatDuration`), removed `STRUCTURE ONLY` pill on replay, and eliminated duplicate replay badge rows.
   - Replay Workspace header: scrubber controls on left; honesty badges (`ORIGIN`, `IN-PROGRESS SNAPSHOT` vs `HISTORICAL (STOPPED)`, `GRANULARITY`, agent version, `PARTIAL` if incomplete, and `Project Map`) on right.
   - Diff viewer empty state: replaced empty void with a structured, informative honest state displaying checkpoint overview, attribution status, recording completeness, gap details, and baseline export note.
6. Distinct Screenshot Capture:
   - Updated `ui/scripts/capture_replay_screenshots.js` to ensure View 1 displays the Summary Audit tab while View 3 displays the Claims & Reason tab.
   - Re-captured all 8 screenshots across 1440x900 and 1024x700 viewports.
   - Verified each PNG has a distinct sha1 checksum (no byte duplicates).

Acceptance:
- `cd ui && npx tsc --noEmit`: 0 errors.
- `cd ui && npm test`: 23 test files (179 vitest unit tests + 8 electron tests) passed.
- `cd ui && npm run build`: production bundle built cleanly in 1.55s.
- `ruff check .`: All checks passed! (0 errors across whole repository).
- `pytest tests/`: 205 passed, 5 skipped (0 errors across whole repository).
- All 8 screenshots verified distinct with valid visual elements.


