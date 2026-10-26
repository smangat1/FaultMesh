# V2 progress and validation

V2 started from fresh `origin/main` at
`542cc5d070510d3e6ff449bc921c8b63bb0ceae6` on 2026-10-26. The separate
`/Users/samyanmangat/Downloads/FaultMesh-ui` worktree is out of scope and untouched.

## Phase status

- Phase 1: complete — versioned per-test evidence contracts and append-only persistence.
- Phase 2: complete — real container observation and source mapping.
- Phase 3: complete — read/export and exact failed-test replay.
- Phase 4: complete — real-project acceptance, regression coverage, documentation, and PR prep.

V2 keeps pytest execution results separate from observed line evidence. `TEST_EXECUTED_SYMBOL` will
mean that a test-phase coverage context measured at least one executable line owned by that symbol.
It will not claim direct invocation, a call path, causality, or complete function coverage.

The real-container gate passed on 2026-10-26 against hpack revision
`c2edbee3b5508e0b1689877fe6f173eafb097aef`. Details and commands are in
[v2-test-evidence.md](v2-test-evidence.md). This branch remains V2-only; it does not contain the
separate UI worktree or begin V3.
