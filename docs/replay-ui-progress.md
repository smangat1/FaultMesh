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

Phase C2 commit: pending.

## Phase C3 — Tests + Real Pixels

Status: in progress.
