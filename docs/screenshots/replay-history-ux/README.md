# Replay history UX screenshots

These Phase 1 screenshots were captured from the production Electron build at
implementation commit `14713ad556f9b0c6d62ddc5be51ea6cf4f647bce`.

- `phase1-home-watch-popup.png` shows the project-folder prompt.
- `phase1-replay-step-strip.png` shows the plain-language replay step strip.
- `phase1-evidence-tabs.png` shows the unclipped evidence inspector tabs.
- `phase1-tips-overlay.png` shows the replay first-use guide.

The Phase 2 screenshot was captured from the production Electron build at
implementation commit `00af356925bee8798a585886282fa75e42f1fbc6`.

- `phase2-derived-file-state.png` shows a reconstructed compact diff carrying
  the required derived/unverified label.

The Phase 4 screenshot was captured from the production Electron build with a
synthetic local narration stream.

- `phase4-local-narration-running.png` shows an in-place chapter upgrade, the
  `Narrating 3/8` progress chip, and the current step's AI summary with no
  setup, tips, or watch-project overlay covering the workspace.

The chapter-first screenshots were captured from the production Electron build at implementation
commit `8cafd27` with the synthetic replay fixture and bridge stream:

- `chapter-first-baseline-open.png` shows deterministic chapters on first render before any title
  has upgraded.
- `chapter-first-titling-progress.png` shows the newest chapter upgraded in place, the
  `Titling chapters 1/2` chip and working **Stop titling** control.
- `chapter-first-selection-summary.png` shows a shift-selected range and its explicit checked-claim
  count in the evidence drawer.
- `chapter-first-step-explanation.png` shows the cached on-click explanation and checked claims for
  one non-trivial step.

The capture script asserts that tips, setup and watch-project overlays do not overlap any of these
states. All four images were visually checked after capture and have distinct SHA-256 hashes.

All replay screenshots use the checked-in synthetic fixture. The home screen is
obscured behind its prompt, so no discovered session content is recorded.
