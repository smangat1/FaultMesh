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

Diff commands pass `--no-ext-diff` and `--no-textconv`, remove inherited
`GIT_EXTERNAL_DIFF`/`GIT_DIFF_OPTS`, and set `GIT_OPTIONAL_LOCKS=0` for every Git child process.
This blocks the executable diff and text-conversion paths covered by Git's command interface and
avoids optional index refresh writes. It is not a general process sandbox: Git itself and repository
metadata are still read from the host, so scans should use a trusted Git executable and repository
configuration.

Path-bearing Git records use NUL-delimited byte output, then require strict UTF-8 before entering
the JSON contract. Spaces, tabs, newlines, quotes, backslashes, and Unicode are preserved exactly;
an undecodable repository path stops the comparison with an explicit error. Revision scans inspect
tree modes and skip symlinks and gitlinks instead of materializing their blobs as Python source.

## Contract

- `envelope`: project name, resolved base/head, worktree marker and dirty state, and deterministic
  SHA-256 of the export body.
- `files[]`: every regular Python file, including empty, isolated, tests, package initializers,
  syntax failures, and non-UTF-8 files. IDs are `file:<path>`. Test classification is labeled as a
  path heuristic. A deleted base-side file remains as a ghost with `removed=true` and
  `revision_side=base`.
- `symbols[]`: classes, functions, methods, async variants, and nested functions. The identity is
  project-relative path plus qualified name; `@N` disambiguates repeated definitions. Each item
  carries its own source-segment hash, line range, signature, parameter names, decorators, bases,
  and only the verbatim first docstring line when one exists. Removed Git symbols remain as ghost
  nodes with `removed=true` and base-side provenance. Their parent IDs always resolve to a current
  or ghost parent.
- `edges[]`: `defines`, `contains`, `imports`, and `possible_call`. Every edge has layer `static`, a
  source, optional target, source location, resolution reason, and `resolved`, `ambiguous`, or
  `unresolved` confidence. Removed containment uses separate base-side edges and is never presented
  as a current-head fact.
- `unresolved[]` and `external_modules[]`: dynamic imports/callables, star imports, unknown receiver
  types, decorators, module/class-body calls, builtins, stdlib, and third-party references that V3
  does not pretend to resolve.
- `git.files[]`: added, modified, deleted, renamed, copied, untracked, or unchanged. Rename/copy
  similarity is reported only when Git reports it.
- `git.symbols[]`: added, modified, removed, or unchanged using changed-hunk line-range overlap and
  source-segment hashes. This is not semantic equivalence.
- `possible_impact[]`: one-hop static neighbors of changed symbols, labeled
  `possible_static_impact` rather than proven impact.
- `skips[]`, `parse_errors[]`, and `counts`: explicit scan accounting, including current versus
  ghost file and symbol totals.

The checked-in [schema example](fixtures/v3-structure-example.json) is real output from
`examples/buggy_python_project` and contains all three files, including file clusters with no need
for a connecting edge.

## Static relationship rules

Imports resolve only to project modules or top-level definitions established by absolute/relative
imports and package re-exports. Possible calls resolve only from an import binding, a module or
enclosing function/module definition, a supported `self`/`cls` method, an actually resolved project
base class, or an imported module attribute. Function parameters and compile-time locals block
fallback to outer imports. Class namespaces are not treated as function lexical scopes, and dotted
imports keep the module chain Python binds. Multiple candidates produce ambiguous edges. V3 has no
type inference and does not guess through arbitrary values.

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
references, 21 external modules, 28 skipped entries, and zero parse errors. The source checkout was
clean before and after. Manual source-line checks confirmed these resolved edges:

1. `bench/test_bench_hpack.py:1` imports `encode_integer` and `decode_integer` from `hpack.hpack`.
2. `src/hpack/hpack.py:120` constructs imported `HPACKDecodingError`.
3. `src/hpack/hpack.py:144` calls same-module `_to_bytes`.
4. `src/hpack/hpack.py:169` constructs imported `HeaderTable`.
5. `src/hpack/hpack.py:249` calls `self._encode_table_size_change`.

Manual checks also confirmed five honest unresolved records: pytest's injected local `benchmark`
value at `bench/test_bench_hpack.py:9`, builtin `bytes` at line 23, and the module-body calls
`sys.path.insert`, `open`, and `match.group` in `docs/source/conf.py`. These are retained because V3
does not infer fixture or receiver types or present module-body calls as function call edges.

The real V2 acceptance export joined 7,910 observed test-symbol entries, zero stale entries, and
1,149 explicit unmatched/ambiguous entries. The injected failure's `encode_integer` observation
mapped to `symbol:src/hpack/hpack.py:encode_integer`; its disposable injected test file correctly
remained unmatched in the clean upstream tree.

The FaultMesh `src/` scan produced 42 files, 417 symbols, 167 `contains`, 250 `defines`, 258 resolved
imports, 205 unresolved imports, 531 resolved possible calls, 1,764 unresolved references, 44
external modules, 40 skipped entries, and zero parse errors.

Finally, a separate disposable hpack clone received a real edit to `_to_bytes`, a Git rename of
`huffman_constants.py` to `huffman_codes.py`, and a new `v3_added.py`. V3 reported the file states
as modified, renamed at 100% Git similarity, and untracked/added respectively; `_to_bytes` was
modified, `added_for_v3` was added, and eight one-hop possible-impact records were emitted.

The PR #5 corrective pass reran Ruff, strict mypy, and the complete non-container suite: Ruff was
clean, mypy found no issues in 61 files, and pytest reported 96 passed with 3 container tests
deselected. Dedicated regressions cover disabled external diff/textconv helpers, Python binding
shadowing and class scopes, exact Git paths and tree modes, coherent removed hierarchies, and
zero-length hunk boundaries. Two consecutive hpack exports were byte-identical.
