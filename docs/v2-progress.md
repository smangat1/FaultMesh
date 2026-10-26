# V2 progress and validation

V2 started from fresh `origin/main` at
`542cc5d070510d3e6ff449bc921c8b63bb0ceae6` on 2026-10-26. The separate
`/Users/samyanmangat/Downloads/FaultMesh-ui` worktree is out of scope and untouched.

## Phase status

- Phase 1: complete — versioned per-test evidence contracts and append-only persistence.
- Phase 2: pending — real container observation and source mapping.
- Phase 3: pending — read/export and exact failed-test replay.
- Phase 4: pending — real-project acceptance, documentation, and PR.

V2 keeps pytest execution results separate from observed line evidence. `TEST_EXECUTED_SYMBOL` will
mean that a test-phase coverage context measured at least one executable line owned by that symbol.
It will not claim direct invocation, a call path, causality, or complete function coverage.
