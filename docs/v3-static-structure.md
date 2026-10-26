# V3 static structure and Git changes

V3 exports one deterministic schema 3.0 JSON document for a future read-only graph adapter. It
uses file bytes, Python's AST, and read-only Git subprocess argv. It never imports or executes
target code, runs tests, installs dependencies, calls a model, or follows a symlinked file or
directory.

## Commands

```console
faultmesh structure PROJECT [--base REV] [--head REV|worktree] [--coverage V2_EXPORT] [--out FILE]
faultmesh structure-summary FILE
```

With `--out`, the first command writes the document and prints a count summary. Without it, the
document goes to stdout. `structure-summary` validates and reads only its JSON input; the project
can be absent.

The default comparison is `HEAD` to `worktree`. Explicit revisions resolve to full commit SHAs or
fail as missing/ambiguous. Git commands never checkout, reset, stash, clean, fetch, or modify the
index. A non-Git project still gets a structure export with `git.available=false`. No-commit,
detached, shallow, untracked, renamed, copied, and submodule states remain explicit.

## Contract

- `envelope`: project name, resolved base/head, worktree marker and dirty state, and deterministic
  SHA-256 of the export body.
- `files[]`: every regular Python file, including empty, isolated, tests, package initializers,
  syntax failures, and non-UTF-8 files. IDs are `file:<path>`. Test classification is labeled as a
  path heuristic.
- `symbols[]`: classes, functions, methods, async variants, and nested functions. The identity is
  project-relative path plus qualified name; `@N` disambiguates repeated definitions. Each item
  carries its own source-segment hash, line range, signature, parameter names, decorators, bases,
  and only the verbatim first docstring line when one exists. Removed Git symbols remain as ghost
  nodes with `removed=true`.
- `edges[]`: `defines`, `contains`, `imports`, and `possible_call`. Every edge has layer `static`, a
  source, optional target, source location, resolution reason, and `resolved`, `ambiguous`, or
  `unresolved` confidence.
- `unresolved[]` and `external_modules[]`: dynamic imports/callables, star imports, unknown receiver
  types, decorators, module/class-body calls, builtins, stdlib, and third-party references that V3
  does not pretend to resolve.
- `git.files[]`: added, modified, deleted, renamed, copied, untracked, or unchanged. Rename/copy
  similarity is reported only when Git reports it.
- `git.symbols[]`: added, modified, removed, or unchanged using changed-hunk line-range overlap and
  source-segment hashes. This is not semantic equivalence.
- `possible_impact[]`: one-hop static neighbors of changed symbols, labeled
  `possible_static_impact` rather than proven impact.
- `skips[]`, `parse_errors[]`, and `counts`: explicit scan accounting.

The checked-in [schema example](fixtures/v3-structure-example.json) is real output from
`examples/buggy_python_project` and contains all three files, including file clusters with no need
for a connecting edge.

## Static relationship rules

Imports resolve only to project modules or top-level definitions established by absolute/relative
imports and package re-exports. Possible calls resolve only from an import binding, a module or
enclosing-scope definition, `self`/`cls` method in the same or simply identified project base class,
or an imported module attribute. Multiple candidates produce ambiguous edges. V3 has no type
inference and does not guess through arbitrary values.

Static edges are possibilities from source text, not proof a call happens at runtime. Absence of an
edge is not proof of no call. Dynamic Python creates false negatives, especially through `getattr`,
dynamic imports, decorators, monkeypatching, dependency injection, descriptors, metaclasses,
native code, and runtime mutation.

## V2 coverage join

`--coverage` accepts a schema 2.0 `RunEvidenceExport`. Each `ObservedSymbol` joins by the existing
V2 identity `(path, qualified_name)`. A matching file with a different hash produces an overlay
entry with `stale=true`. Missing or duplicate structure identities go to `unmatched`; they are not
silently selected. The overlay layer is `observed_coverage` and never creates static or runtime
call edges. It means only that coverage measured an executed line in that symbol for that test.
V1/V2 records and databases are never modified.

## Mapping to the fixture UI types

| V3 field | UI type/field | Adapter note |
|---|---|---|
| `files[]` | `FileCluster` | `path -> file`, basename -> `name`, count child symbols |
| file Git status | `FileCluster.changeStatus` | map deleted to removed; renamed/copied retain provenance separately |
| `symbols[]` | `CodeNode` | `id`, `path -> file`, `qualified_name -> name`, lines and kind map directly |
| symbol Git status | `CodeNode.changeStatus` | schema values already match UI values |
| `edges[kind=possible_call]` | `GraphEdge(category=static_call)` | provenance is AST location and resolution reason |
| `edges[kind=imports]` | `GraphEdge(category=static_import)` | file or symbol target; never runtime observed |
| `unresolved[]` | `UnresolvedReference` | path/line/text/reason map directly |
| `parse_errors[]` | `ParseError` | path/line/message map directly |
| coverage overlay | `TestItem.exercisedNodeIds` | matched structure IDs only; preserve stale/unmatched separately |

V3 intentionally supplies no generated descriptions, roles, tiers, complexity, source snippets, or
runtime-observed edges. A later adapter must leave those optional UI fields empty.

## Acceptance

Acceptance ran on 2026-10-26 from base
`425ab6848395126c82329893a9cf7e8712a3c4ea`.

The real hpack project was cloned locally into a disposable directory, left clean, and pinned to
MIT-licensed `python-hyper/hpack` revision
`c2edbee3b5508e0b1689877fe6f173eafb097aef`:

```console
faultmesh structure /Users/samyanmangat/Downloads/FaultMesh-v3-validation-20261026-99x692/hpack-clean \
  --coverage /tmp/faultmesh-v2-export-check.json \
  --out /Users/samyanmangat/Downloads/FaultMesh-v3-validation-20261026-99x692/hpack-clean-structure.json
faultmesh structure src --out /tmp/faultmesh-v3-self-src.json
```

Hpack produced 19 files, 171 symbols, 130 `contains`, 41 `defines`, 48 resolved imports, 56
external/unresolved imports, and 171 resolved possible calls. It also retained 461 unresolved
references, 20 external modules, 28 skipped entries, and zero parse errors. The source checkout was
clean before and after. Manual source-line checks confirmed these resolved edges:

1. `bench/test_bench_hpack.py:1` imports `encode_integer` and `decode_integer` from `hpack.hpack`.
2. `src/hpack/hpack.py:120` constructs imported `HPACKDecodingError`.
3. `src/hpack/hpack.py:144` calls same-module `_to_bytes`.
4. `src/hpack/hpack.py:169` constructs imported `HeaderTable`.
5. `src/hpack/hpack.py:249` calls `self._encode_table_size_change`.

Manual checks also confirmed five honest unresolved records: pytest's injected `benchmark` value at
`bench/test_bench_hpack.py:9`, builtin `bytes` at line 23, module-body `sys.path.insert` at
`docs/source/conf.py:17`, module-body `open` at line 22, and unknown receiver `match.group` at line
25. These are retained because V3 does not infer fixture or receiver types.

The real V2 acceptance export joined 7,910 observed test-symbol entries, zero stale entries, and
1,149 explicit unmatched/ambiguous entries. The injected failure's `encode_integer` observation
mapped to `symbol:src/hpack/hpack.py:encode_integer`; its disposable injected test file correctly
remained unmatched in the clean upstream tree.

The FaultMesh `src/` scan produced 42 files, 390 symbols, 150 `contains`, 240 `defines`, 254 resolved
imports, 203 unresolved imports, 486 resolved possible calls, 1,683 unresolved references, 45
external modules, 40 skipped entries, and zero parse errors.

Finally, a separate disposable hpack clone received a real edit to `_to_bytes`, a Git rename of
`huffman_constants.py` to `huffman_codes.py`, and a new `v3_added.py`. V3 reported the file states
as modified, renamed at 100% Git similarity, and untracked/added respectively; `_to_bytes` was
modified, `added_for_v3` was added, and eight one-hop possible-impact records were emitted.
