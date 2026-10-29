# History import UI contract

This is the backend contract for a later session-list UI. The current change does not modify
`ui/`. History discovery and import are read-only, local-only paths separate from live hook capture.

## List sessions

Invoke `faultmesh replay-history-list`. Its JSON object has two arrays:

- `roots`: `tool` (`codex` or `claude_code`), `status` (`ok`, `missing` or `unreadable`),
  `file_count`, and a path-free `message`;
- `sessions`: `session_id`, `tool`, `project_group_key`, `project_display_name`, `started_at`,
  `ended_at`, `prompt_count`, nullable `first_prompt_preview`, nullable `format_version`,
  `parse_status` (`ok`, `partial` or `unsupported`), nullable `unsupported_reason`,
  `source_file_sha256`, and `redaction_types`.

Group sessions by `project_group_key`; use `project_display_name` only as a label. Do not treat the
display name as a path or a unique identifier. Do not infer a missing root is an error requiring
macOS permission. A session with `partial` or `unsupported` status stays selectable and visible.

The preview is bounded and already redacted. A marker such as `[redacted: api key]` is intentional
content, not a rendering placeholder. Preserve it visibly and use `redaction_types` for optional
explanation. Never attempt to recover or request the hidden value.

## Import selection

Invoke:

```console
faultmesh replay-history-import <session-id> --tool <codex|claude_code> --out <local-json-path>
```

The command writes a validated `replay-export-1.0` document and prints only a summary containing
`schema_version`, `session_id`, record count and output path. The UI should load the file through
the same validation path used for any other v1 replay export. Import is on demand; listing must not
be replaced by eager import of every session.

The optional `--tool` value should be passed from the selected list row to avoid ambiguity. Source
paths are intentionally absent from both list and export contracts.

## Additive export fields

Existing v1 required fields and literals remain unchanged. The following fields are optional:

- session: `import_source`, `format_version`, `source_file_sha256`;
- record: `source_item_id`, `prompt_id`, `prompt_text`, `file_state`, `edit_patch`,
  `edit_command`, `redaction_types`.

History records reuse existing record kinds. They carry `provenance: history_import`, unknown
attribution and partial/unsupported completeness. The UI must continue accepting exports where all
new fields are absent.

## Rendering truthfully

- Show prompt text and tool/edit evidence as recorded after redaction.
- Render every `[redacted: <type>]` marker visibly; do not blank or silently omit it.
- Label `file_state: unknown` as unknown historical file state. Patch or command text is action
  evidence, not reconstructed source bytes.
- Render `gap` and `unsupported` records using their existing kind plus `gap_reason`; do not drop
  them from the timeline.
- Imported exports intentionally have empty `manifests`, `content_base64_by_sha256`, structured
  `tests`, changed-file lists and changed-symbol lists. Do not invent checkpoints or diffs.
- Do not infer that an edit caused a later state, that a command succeeded unless the source says
  so, or that redaction found every secret.
- Keep live capture visually distinct: it is opt-in per project and can provide exact stored bytes;
  history replay provides prompts/steps/timing but unknown file bytes.

Codex `.jsonl.zst` sessions are unsupported when no local `zstd` executable exists. Claude Code
support is synthetic-contract-only until validated against a real local format; the UI must not
claim general Claude compatibility.
