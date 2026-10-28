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

Phase C1 commit: pending.

## Phase C2 — Replay Workspace

Status: in progress.

### Scope & Contract
- Look: quiet Obsidian/Zotero-like interface, restrained edges, spacious layout, plain labels, no physics gimmicks or busy dashboard. Existing project-wide map can be optional; reading a run must not require a graph.
- Chapter timeline with selectable ranges, titles and counts. Model titles say 'model interpretation'; deterministic chapters say 'baseline'. Use validated backend ranges, don't invent groups. Bound/virtualize long lists where needed.
- Previous/next/scrub selects a historical checkpoint. Show stable ID/time, prompt/tool evidence, changed files/functions and exact stored before/after diff. Navigation never edits code, reruns commands/tests, rolls back or starts inference.
- Historical state stays historical when the current checkout differs. Handle added/deleted/renamed files, stale AST/syntax errors, truncated source and missing snapshots. Last-good structure is visibly stale.
- Tests before/after/nearby: command, actual test scope, output/exit evidence, structured counts when supplied. Missing = 'not observed', not passed. 'State matched' only on backend-supported identity; otherwise 'nearby in time, code state unverified'. Later pass is not 'fixed by this edit'.
- Click a test/claim to see its exact recorded evidence, path/range/ID/hash where useful, no private absolute roots.
- Supported facts: small 'checked against recording' label + evidence link. Contradicted: strikethrough plus readable verdict/reason/counterevidence. Unsupported/unknown: neutral explicit label. Don't use color alone. Keep raw claim separate from verdict; never make a whole free-form paragraph green.
- 'likely reason (model inference)' remains labeled even when citations exist. 'Source quote checked' is distinct, not an intent/causality badge. Expand exact prompt sentence, prior step or agent-logged explanation. Missing/invalid citations remain visible and neutral. Never say the checker verified why.
- Summary audit: original agent sentence, supported/contradicted/unknown predicate and evidence. 'Not supported by this recording' is not 'false'. Broad semantic claims remain unverified.
- Allow narration off and baseline comparison. Show measured results separately from targets; no hardcoded improvement/fit/success claims. If evaluation is pending, display 'evaluation pending'.
- Accessible keyboard controls/focus/buttons/status text. Long paths/quotes/diffs/tracebacks and narrow windows must wrap/scroll without hiding controls. Keep selection/scroll stable; no camera reset each step.
Gate: timeline/diff/tests/evidence stay coherent; verdicts/inference remain distinct; existing watch/import flows still work. Commit.
