# V3 progress and validation

V3 started from fresh `origin/main` at
`425ab6848395126c82329893a9cf7e8712a3c4ea` on 2026-10-26. That base contains merged V2 PR #4
and fixture-only UI PR #3. The separate UI worktree and all files under `ui/` are out of scope.

## Phase status

- Phase 1: complete — schema 3.0 structure models and non-executing indexer.
- Phase 2: complete — honest static relationships with explicit uncertainty.
- Phase 3: complete — read-only Git changes and symbol status.
- Phase 4: complete — CLI/export, V2 overlay, real-project acceptance, docs, and PR prep.

The real hpack gate passed at revision
`c2edbee3b5508e0b1689877fe6f173eafb097aef`: 19 files, 171 symbols, 446 static edges,
461 unresolved references, and a V2 overlay with 7,910 matches and 1,149 explicit unmatched
records. The FaultMesh `src/` scan found 42 files and 390 symbols. Full acceptance details are in
[v3-static-structure.md](v3-static-structure.md).
