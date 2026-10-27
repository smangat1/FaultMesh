# Live spectate foundation

## Decision and local-only data flow

Live spectate is an explicitly enabled, read-only observer for Python source changes. The engine uses
standard-library polling rather than an OS event dependency. Polling behaves consistently across
supported platforms, makes atomic-save and debounce behavior deterministic in tests, and adds no
native package. It opens no HTTP server, WebSocket, socket, or network port.

The desktop flow is one way:

1. The user chooses an existing directory through Electron's native folder dialog.
2. Electron main keeps the resolved path private and returns only an opaque project handle plus a
   display name.
3. Nothing starts until the user explicitly starts watching that selected project.
4. Electron main spawns the fixed `faultmesh spectate <validated-root>` command, validates bounded
   newline-delimited JSON from stdout, and forwards valid records to the renderer.
5. The renderer can request choose/start/stop and subscribe to facts. It cannot provide a path,
   invoke a command, read arbitrary files, open a URL, or access Node.js.

The poller compares stat identity `(mtime_ns, size, inode)` first and hashes content only for a
candidate change. It waits for the configured quiet period and accepts a read only when stat values
are identical before and after the read and again after a short stability interval. Each accepted
version becomes the in-memory stable baseline. Diffs are therefore against the **previous stable
snapshot**, never against Git.

## `spectate-1.1` records

Every stdout line is one JSON object with `schema_version`, `session_id`, an increasing `sequence`,
UTC `emitted_at`, and an `event` discriminator. Event-specific models live in
`src/faultmesh/spectate/models.py`; `docs/fixtures/spectate-stream-example.ndjson` is a small example.

| Event | Meaning |
|---|---|
| `session_started` | Opt-in session facts, limits, and ignore policy. It says tests were not rerun. |
| `initial_snapshot` | Deterministically ordered file hashes and the matching V3 file/symbol IDs. |
| `file_changed` | Stable create/modify/delete/rename fact, line ranges, and affected existing IDs. |
| `source` | Exact UTF-8 source for the stable version, or an explicit bounded skip reason. |
| `diff` | Unified hunks with old/new coordinates against the previous stable version. |
| `structure_update` | One-file file/symbol data and added/modified/removed node deltas. |
| `relationship_update` | V3-shaped static edges, unresolved references, external modules, and stale/partial facts for the settled snapshot. |
| `evidence_stale` | Loaded V2 evidence whose containing-file hash no longer matches. |
| `watch_error` | Explicit read, parse, permission, or configured-bound outcome. |
| `root_missing` | The selected root disappeared, moved, unmounted, or became inaccessible. |
| `session_ended` | Clean terminal reason such as stdin close, SIGTERM, stop, or missing root. |

Records contain observable facts only. They do not attribute an editor or person, explain intent,
run tests, claim that a change works, or turn static `possible_call` edges into observed edges.
The initial relationship update follows `initial_snapshot`; later updates follow the complete batch
of file, source, diff, and structure facts for each settled group of changes.

## Default bounds and exclusions

Defaults are 2,000 watched files, 512 KiB per file, 2,000 diff lines, 200 emitted records per
second, 20,000 characters per source line, 1 MiB per stdout line, 250 ms quiet debounce, and 100 ms
polling. Bound outcomes are labeled with `watch_error`, or with `complete=false`, `truncated=true`,
and a reason on the source/diff record. Relationship updates set `complete=false` and list
`partial_reasons` when file limits, read bounds, or stale/invalid parses make the relationship view
partial. Multiple writes inside one quiet window coalesce into the final stable version, and the
relationship index is rebuilt only after that settled batch.

The walker reuses `IGNORED_PARTS`, never follows file or directory symlinks, accepts Python files
only, resolves every candidate beneath the chosen root, and ignores nested Git worktrees. It never
reads or names secret-like candidates matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, or
`credentials*`. `.faultmesh` is ignored, so existing evidence and local state are untouched.

## Structure and evidence behavior

File IDs remain `file:<project-relative-path>` and symbol IDs come from the existing structure
indexer. A stable changed file alone is re-indexed. The relationship event reuses the V3
`StaticEdge`, `UnresolvedReference`, and external-module shapes and parses only the watcher's
already-bounded in-memory bytes; it never imports or executes watched code. Changed ranges overlap
a symbol when
`range.start <= symbol.end_line` and `range.end >= symbol.start_line`, the same rule used by V3 Git
changes. If an edit is temporarily invalid Python, the update records the parse error and retains
the last good symbols and relationships so the map does not collapse. Every such relationship
event names the path plus its last-good and current SHA-256 values in `stale_paths`; the retained
structure is never presented as current. Recovery emits the real symbol delta and fresh
relationships. Deleted nodes are IDs in the delta; static relationships remain AST claims only.

When optional V2 evidence is loaded, its observed-symbol `content_sha256` is compared only with the
containing file hash. A mismatch emits `evidence_stale`; it does not rerun or reinterpret evidence.

## Threat model

The selected project and child output are untrusted. Main-process path validation rejects missing,
non-directory, symlinked, or out-of-root targets. The child inherits Git's existing safety posture
only if Git facts are requested; live diffs themselves do not invoke Git. Child stdout is line- and
schema-bounded, malformed records are not forwarded, and the child is terminated on stop, window
close, app quit, or crash cleanup.

The renderer runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
Preload exposes only `chooseProjectFolder()`, `startWatch()`, `stopWatch()`,
`onSpectateEvent(callback)`, and `requestSource(fileId)`. IPC handlers require the main frame and the
exact packaged local page. Unknown channels have no handler. The renderer never receives the root
path and cannot choose a command or arguments.

## Known gaps

- Polling observes stable versions, not every transient byte write. That is deliberate.
- Rename detection is best-effort from inode and content identity; a delete/create pair can remain
  two facts when identity is ambiguous.
- The minimal UI hook highlights IDs in its own state. Wiring those IDs into Gemini's evolving map
  component is deliberately left to the final layout integration.
- Native dialog and process lifecycle behavior must be checked per desktop platform. There is no
  automatic OS notification or OS-level popup.

## Verified `spectate-1.1` relationship CLI demonstration

On 2026-10-26 the real CLI watched a disposable two-file project. `consumer.py` imported and called
`provider.target`; stdin was then closed to stop the session cleanly. The actual relationship record,
reduced only to the fields relevant to the static cross-file edge, was:

```json
{"schema_version":"spectate-1.1","sequence":3,"event":"relationship_update","complete":true,"partial_reasons":[],"stale_paths":[],"edges":[{"kind":"possible_call","source_id":"symbol:consumer.py:caller","target_id":"symbol:provider.py:target","callsite_path":"consumer.py","confidence":"resolved","resolution_reason":"import_binding"}]}
```

The CLI did not import or execute either watched module. Automated engine tests cover relationship
updates across settled create, modify, delete, and rename operations; syntax error and recovery;
last-good hash labeling; secret and symlink exclusion; file/read limits; debounce coalescing; and
contiguous sequence ordering.

## Legacy `spectate-1.0` macOS demonstration

On 2026-10-26 the real CLI watched a throwaway copy of `examples/buggy_python_project` outside the
repository while `scripts/spectate_demo_editor.py` ran as a separate process. The editor process did
an in-place save, an atomic temp-file rename-over save, function addition, function removal, syntax
error, syntax recovery, file deletion, and new-file creation. The watcher produced 34 contiguous
records and exited cleanly. Selected actual stdout records, reduced to the fields relevant to each
assertion, were:

```json
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":1,"event":"session_started"}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":3,"event":"file_changed","path":"src/buggy_python_project/bounds.py","kind":"modified","parse_ok":true,"changed_line_ranges":[{"start_line":6,"end_line":6}],"parse_error":null}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":14,"event":"structure_update","path":"src/buggy_python_project/bounds.py","parse_ok":true,"added_symbol_ids":["symbol:src/buggy_python_project/bounds.py:live_demo_added"],"removed_symbol_ids":[],"kept_last_good_symbols":false,"parse_error":null}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":19,"event":"file_changed","path":"src/buggy_python_project/bounds.py","kind":"modified","parse_ok":false,"changed_line_ranges":[{"start_line":1,"end_line":1}],"parse_error":"invalid syntax at line 1"}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":22,"event":"structure_update","path":"src/buggy_python_project/bounds.py","parse_ok":false,"added_symbol_ids":[],"removed_symbol_ids":[],"kept_last_good_symbols":true,"parse_error":"invalid syntax at line 1"}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":23,"event":"file_changed","path":"src/buggy_python_project/bounds.py","kind":"modified","parse_ok":true,"changed_line_ranges":[{"start_line":1,"end_line":1}],"parse_error":null}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":27,"event":"file_changed","path":"src/buggy_python_project/bounds.py","kind":"deleted","parse_ok":true,"changed_line_ranges":[{"start_line":1,"end_line":1}],"parse_error":null}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":30,"event":"file_changed","path":"src/buggy_python_project/live_created.py","kind":"created","parse_ok":true,"changed_line_ranges":[{"start_line":1,"end_line":2}],"parse_error":null}
{"schema_version":"spectate-1.0","session_id":"911d4f03-6afd-4d07-bbaf-dd54b6ef7524","sequence":34,"event":"session_ended","reason":"stdin_closed_or_signal"}
```

The full records also contained exact source, unified hunks, old/new hashes, and symbol deltas. The
atomic save appeared as one stable `modified` version. No transient partial version was emitted.
Automated tests cover partial/truncate writes, CRLF, binary and invalid UTF-8 input, oversized and
many-file bounds, symlink and traversal escape, secret names, root loss/rename/permission errors,
and Electron framing, stdout, and child-lifecycle failures.

The real Electron app was then launched on macOS. The native dialog selected the throwaway folder,
the CLI child observed edits, and the rendered pixels were inspected for the
[banner](screenshots/live_spectate_banner_macos.png),
[source/diff panel](screenshots/live_spectate_source_diff_macos.png),
[parse-error retention state](screenshots/live_spectate_parse_error_macos.png), and
[stopped state](screenshots/live_spectate_stopped_macos.png). The app quit with no watcher child
remaining. This verifies the macOS dialog and lifecycle only; Linux and Windows desktop flows were
not run. The engine polls, so there is no platform-specific native file-event claim.

To run the observer directly:

```console
faultmesh spectate /absolute/path/to/python-project
```

To repeat the editor sequence, run the following in another terminal against a throwaway example
copy selected as the watch root:

```console
python scripts/spectate_demo_editor.py /absolute/path/to/throwaway-copy
```

## Hand-off for Gemini

Consume the ordered `spectate-1.1` stream and keep the existing map layout positions. Build the
whole-project static layer from `initial_snapshot`, `structure_update`, and `relationship_update`.
Match
`affected_file_ids`, `affected_symbol_ids`, and `changed_node_ids` directly to V3 IDs. Show source
and diff as exact facts against the previous stable snapshot; show parse errors while retaining the
last good symbols; label watching as **Watching (no tests rerun)**; and mark V2 evidence stale only
from `evidence_stale`. The polished layout must preserve explicit opt-in and Stop controls. It must
not add model-written explanations, editor attribution, fake test results, observed-edge claims, or
silent bound failures.
