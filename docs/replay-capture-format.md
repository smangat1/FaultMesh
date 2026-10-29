# Replay capture contract 1.0

`replay-capture-1.0` is FaultMesh's frozen local ingestion contract for new, explicitly selected
recordings. It is separate from the legacy investigator, spectate output, project-runner evidence
and Codex rollout history.

## Boundary

The supported adapter is `codex-cli 0.165.0-alpha.1.2` synchronous `PreToolUse` and
`PostToolUse` hooks for `Bash` and `apply_patch`. A matched `tool_use_id` produces an exact
pre/post tool boundary. A snapshot is an observation of selected-root bytes; it is not syscall
provenance. Multiple writes inside one tool call remain unobserved intermediate states.

Unknown record types are retained as visible `unsupported` records. Wrong schema versions are
rejected. Missing, corrupt, unmatched, rotated or sequence-skipped inputs produce visible gap
records rather than silently disappearing.

## Capture envelope

Each complete NDJSON line is one strict `CaptureEnvelope` from
`faultmesh.replay.models`. Important fields are:

| Field | Meaning |
| --- | --- |
| `schema_version` | Exact `replay-capture-1.0` adapter contract |
| `record_id` | Source record identity; repeated command text does not deduplicate it |
| `record_type` | Initial snapshot, pre/post tool, checkpoint, gap or unsupported |
| `source_sequence` | Optional source-native monotonic sequence |
| `source_timestamp` | Optional source time, separate from capture time |
| `captured_at` | Time FaultMesh observed the snapshot |
| `project_root_sha256` | Identity of the explicitly selected canonical root |
| `codex_version` | Exact version selected when the recording started |
| `session_id`, `turn_id`, `tool_use_id` | Session and supported source correlation identities |
| `files` | Bounded project-relative path, size, SHA-256, mtime and base64 exact bytes |
| `skipped` | Visible exclusion or failure reasons |
| `partial`, `truncated` | Evidence completeness flags |
| `raw_tool_input`, `raw_tool_response` | Bounded evidence fields, redacted by default |
| `gap_reason` | Explicit missing or unsupported reason |

Committed synthetic examples:

- `tests/fixtures/replay/capture_initial.json`
- `tests/fixtures/replay/capture_sequence.ndjson`

The fixtures contain no real transcript, private code, secret, local database or absolute home
path.

## Durable store

`replay-store-1.0` uses SQLite metadata plus immutable content-addressed objects:

- record sequence is monotonic within one session;
- `(session_id, source_identity, source_offset)` makes source ingestion idempotent across restart;
- different source offsets remain different actions even when command text matches;
- each content object is SHA-256 checked before reuse and after read;
- object writes use a same-directory temporary file, fsync and atomic replace;
- SQLite uses foreign keys, WAL and full synchronous transactions;
- manifests and replay records are append-only;
- derived Python structure rows are rebuildable from stored bytes;
- an invalid current parse stores its current hash while marking last-good symbol facts stale and
  retaining the different hash those facts actually verify;
- deleting one whole selected recording is the disclosed retention exception. Unreferenced local
  objects are garbage-collected.

The reader tolerates an incomplete trailing NDJSON line and does not advance past it. A later
invocation resumes from the last complete byte offset. Device/inode replacement or file-size
regression starts a new source generation and inserts a rotation/truncation gap, preventing two
histories from being joined silently.

## Capture limits and exclusions

Defaults are one selected project, one writer, 2,000 Python files, 512 KiB per file, 32 MiB per
snapshot and 512 MiB of stored content. Live capture inspects only the explicitly selected project;
it does not reconstruct an old session.

Capture never imports or executes project code. It records bounded UTF-8 `*.py` bytes and visibly
skips supported-source candidates it cannot capture. It ignores `.git`, `.faultmesh`, virtual
environments, dependency/model/build/artifact folders, binaries, secret-like names and symlinks.
Non-Python source is skipped with `non_python_source`; no language-agnostic AST claim is made.

Reads use no-follow file descriptors where the platform supports them and compare pre/post file
identity, size and mtime. This reduces obvious symlink and change-during-read races but is not a
general concurrent-writer solution.

## Privacy

Tool input and output are recursively pattern-redacted and bounded before persistence by default.
Redacted and truncated values carry markers and cannot verify the missing text. Pattern redaction
is best effort, not a secrecy guarantee. `--raw-logging` is an explicit local-only opt-in.

History import always applies typed redaction before prompt previews or imported evidence reach an
index/export. Markers such as `[redacted: api key]` remain visible and the record carries
`redaction_types`. History import has no raw-logging mode.

FaultMesh does not upload, export or commit recordings automatically. Only the reviewed synthetic
fixtures above belong in Git.

## Explicit lifecycle

```console
faultmesh replay-start /path/to/project --codex-version 'codex-cli 0.165.0-alpha.1.2'
faultmesh replay-sessions
faultmesh replay-stop <session-id>
faultmesh replay-ingest <session-id> capture.ndjson
faultmesh replay-delete <session-id>
```

`replay-start` prints the synchronous hook command and matcher for the selected local store. Hook
capture is accepted only while the session is active and only when the hook working directory
matches the selected root. Storage defaults outside the selected checkout and can be overridden
with `--store`.

## Read-only history export

History import is a separate producer of the unchanged `replay-export-1.0` envelope. Discovery
automatically scans only `~/.codex/sessions` and `~/.claude/projects`; absent roots are ordinary
statuses. Listing performs a light metadata/prompt scan, while full parsing happens only for the
selected session.

An imported export uses the optional session fields `import_source`, `format_version` and
`source_file_sha256`. Records may use the optional `source_item_id`, `prompt_id`, `prompt_text`,
`file_state`, `edit_patch`, `edit_command` and `redaction_types` fields. Existing required fields,
versions, enums and literals are unchanged. Imported records use existing record kinds,
`provenance: history_import`, `attribution_status: unknown`, and partial/unsupported completeness.

Because logs do not contain trustworthy historical project bytes, imported exports have empty
`manifests`, `content_base64_by_sha256` and structured `tests`. Timeline entries preserve prompts,
tool/edit evidence, ordering, timestamps and visible gaps but have no changed-file or changed-symbol
claims. The ordinary `load_export` integrity path validates and loads the result.

Codex `.jsonl.zst` input uses a local `zstd` executable when available; there is no added zstd
dependency. A missing executable leaves the session visible as unsupported. Claude Code parsing is
limited to the provisional synthetic contract and does not claim real-release compatibility.
