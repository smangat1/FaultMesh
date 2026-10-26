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
records. The current FaultMesh `src/` scan found 42 files and 424 symbols. Full acceptance details are in
[v3-static-structure.md](v3-static-structure.md).

## PR #5 corrective pass

- Safety phase: complete — Git diffs disable external helpers and textconv; child Git processes
  disable optional locks without changing the caller environment.
- Binding phase: complete — parameters/locals, global/nonlocal declarations, class scope rules,
  dotted imports, and resolved base bindings prevent unsupported source-call edges.
- Path/type phase: complete — NUL-delimited Git paths preserve exact names; revision scans inspect
  tree modes and skip symlinks/gitlinks.
- Ghost phase: complete — removed files/symbols retain base-side hierarchy and edges; counts split
  current/ghost nodes and zero-length hunk boundaries do not touch adjacent symbols.

## Conditional import follow-up

- Mutually exclusive `if`/`elif`/`else` and `try`/`except` import targets merge as ambiguous
  candidates; identical targets deduplicate to one resolved edge.
- A branch assignment keeps the name unresolved, while an unconditional later import replaces the
  earlier binding. Star-import handling is unchanged.
- Ruff and strict mypy passed. The non-container suite reported 102 passed and 3 deselected.
- Two hpack exports were byte-identical. Hpack counts and its V2 overlay stayed unchanged at 7,910
  matches, 0 stale matches, and 1,149 explicit unmatched records. The example fixture's graph and
  counts were unchanged, so its historical-revision JSON was not rewritten.
