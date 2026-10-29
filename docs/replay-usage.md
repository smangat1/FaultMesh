# Local replay usage

## Defaults

FaultMesh replay is explicit opt-in and local-only. Storage defaults to
`~/.faultmesh/replay`, outside the selected checkout. Override it with `--store`. Starting a live
recording inspects only its selected project. Separately, read-only history discovery scans only
`~/.codex/sessions` and `~/.claude/projects`; it never scans unrelated home directories.

Default capture bounds are 2,000 UTF-8 Python files, 512 KiB per file, 32 MiB per snapshot and
512 MiB of stored unique content. `.git`, `.faultmesh`, model/dependency/build/artifact folders,
binaries, secret-like filenames and symlinks are excluded. Non-Python source is visibly skipped;
no language-agnostic AST claim is made.

Tool input/output is best-effort pattern-redacted and bounded before persistence. Redaction is not
a secrecy guarantee. `--raw-logging` explicitly opts into unredacted local fields. Exports can
contain private source and evidence, so review them before sharing.

Retention is manual. Records and content are append-only during a session. `replay-delete` deletes
one whole selected recording and garbage-collects content not referenced by another recording.
There is no automatic cloud upload, telemetry or cloud model fallback.

## List and import existing agent history

List the lightweight redacted index without importing every session:

```console
faultmesh replay-history-list
```

The JSON result reports each root's status and each session's id, tool, hashed project group,
display name, time range, prompt count, bounded redacted first-prompt preview, format version and
parse status. Missing roots are not errors. Automatic discovery is limited to the two dotfolders;
explicit `--codex-root` and `--claude-root` overrides exist for deliberate local testing.

Import one selected session into the existing replay export shape:

```console
faultmesh replay-history-import <session-id> --out history-replay.json
```

Use `--tool codex` or `--tool claude_code` only to disambiguate a repeated id. Import is read-only
with respect to the source log and project. Prompts, tool evidence and edit evidence are typed-
redacted before export. Historical file bytes remain unknown, so the export contains no manifests
or source content and edit records carry `file_state: unknown`. The resulting file is validated by
the same `replay-export-1.0` model and can be opened through the ordinary export loader.

Poll for newly added, changed or removed history files without reading their contents:

```console
faultmesh replay-history-watch
```

Watch events contain only an opaque source key, tool, change kind, mtime and size. Codex compressed
logs require a locally installed `zstd` executable; otherwise they remain visible as unsupported.
Claude parsing currently recognizes only the documented synthetic provisional format because no
real Claude Code log was available during development.

## Record a new selected project

```console
faultmesh replay-start /path/to/project \
  --codex-version 'codex-cli 0.165.0-alpha.1.2'
```

The command captures the initial snapshot and prints a synchronous hook command plus the matcher
`^(Bash|apply_patch)$`. Configure that command for both Codex `PreToolUse` and `PostToolUse` for the
new session. Hook capture is rejected when its working directory differs from the selected root.

List and stop recordings:

```console
faultmesh replay-sessions
faultmesh replay-stop <session-id>
```

For a capture producer that writes the frozen NDJSON contract:

```console
faultmesh replay-ingest <session-id> capture.ndjson --source-name codex-hook-stream
```

An incomplete trailing line remains pending. Duplicate ingestion is stable. Detectable
rotation/truncation starts a new generation with a visible gap.

## Query without executing

```console
faultmesh replay-timeline <session-id>
faultmesh replay-checkpoint <session-id> 3
```

These commands read stored bytes only. The checkpoint response includes source, diff, changed
Python symbols, tool/prompt evidence markers and structured/unknown test markers. It does not run
the selected command or test.

## Export and play back without the checkout

```console
faultmesh replay-export <session-id> --out replay.json
faultmesh replay-view-export replay.json --sequence 3
```

`replay-view-export` needs neither the replay store nor the original project. Content hashes and
sizes are verified before display.

Run the disposable no-model demonstration:

```console
faultmesh replay-demo
```

The demo creates two synthetic Python checkpoints, exports them, deletes its disposable checkout,
and selects the earlier and later source from the export. It does not launch Codex, pytest or
Docker.

## Add checked narration without blocking recording

The deterministic path is always available:

```console
faultmesh replay-narrate replay.json --out narrated.json --backend none
```

To use one explicitly selected local GGUF with bounded 1.5B-class resource settings:

```console
faultmesh replay-model-inventory /path/to/models --available-memory-bytes 8589934592
faultmesh replay-narrate replay.json --out narrated.json \
  --backend llama-cli --model-path /path/to/model.gguf --preset small-1.5b
```

Loopback `llama-server` is also supported with an explicit `--endpoint`. FaultMesh does not guess
model paths, download weights, contact a cloud service or load several models together. Presets are
resource caps for 1.5B-, 3B- and 7B-class files, not claims that any specific model is installed,
fits memory or performs well. Missing, invalid or timed-out model output falls back to deterministic
claims and chapters. Recording and ordinary playback never start an inference job.

## Delete a recording

```console
faultmesh replay-delete <session-id>
```

Deletion is the only supported mutation of historical recording evidence and operates on the
whole selected session. It is local and irreversible unless the store has been backed up.

## Current limitations

- One selected project, one supported Codex version, new sessions and no concurrent writers.
- Exact pre/post tool snapshots; intermediate writes inside one tool invocation are unavailable.
- Bounded UTF-8 Python source only.
- Concurrent external changes inside a tool interval cannot be attributed reliably.
- Command output has no pytest-count semantics without separate structured evidence or a narrow
  version-tested parser.
- Existing investigator, spectate and isolated failed-test rerun features remain separate legacy
  capabilities and are not prerequisites for playback.
- History replay has prompts, ordered steps and timings but no exact before/after file bytes,
  trustworthy changed-file reconstruction or verified causal attribution.
