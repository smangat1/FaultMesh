# History log import findings

## Gate and revert point

Status: P0 complete on 2026-10-28; P1 additive schema complete on 2026-10-28; parser phases
remain pending.

Revert point: `957aa27d70ec305f25c5fcd3ffe6b09f0808f406`

The original P0 branch point was `f3530fe6e9d64dc17cef679e4aa84eb9030fb230`. Before P1, this
branch was rebased onto freshly fetched `origin/main` at the revert point above. The intervening
changes were confined to `ui/`, replay UI screenshots and the replay timeline progress document;
no backend replay contract changed. The inspection was read-only and local. It examined record
structure and aggregate counts under `~/.codex/sessions` and checked for `~/.claude/projects`. It
did not copy, quote or commit prompts, commands, outputs, project paths, session IDs or raw log
records.

## Real local inventory

At the inspection point, Codex had four JSONL files and no `.zst` file. All four used the date
folder layout `YYYY/MM/DD/<session>.jsonl`. The logs were active and grew during inspection, so
line/item counts are diagnostic only, not a stable dataset. All inspected complete lines parsed as
JSON. Two `session_meta.cli_version` values were present:

- `0.164.0-alpha.11.1` in one file;
- `0.165.0-alpha.1.2` in three files.

Neither `~/.claude` nor `~/.claude/projects` existed. Consequently, P0 could not validate a real
Claude project-folder encoding or Claude JSONL variant on this machine. By explicit continuation
decision, P3 will be built and tested from sanitized synthetic fixtures only. It will remain
version-gated and will not claim validation against a real Claude log on this machine.

The local `zstd` executable exists, but the repository has no zstandard Python dependency and the
real inventory contains no compressed sample. By explicit continuation decision, P2 will invoke
the local `zstd` executable read-only when it is available and will not add a Python dependency.
When that executable is absent, compressed sessions will remain discoverable as visible
`unsupported` entries carrying the reason. Portable `.jsonl.zst` parsing is not proven by a real
sample on this machine.

## Codex rollout shape observed

Every inspected record had top-level `timestamp`, `type`, `payload` and `ordinal`. Observed
top-level types were:

- `session_meta`;
- `turn_context`;
- `response_item`;
- `event_msg`;
- `token_usage_record`;
- `world_state`;
- `compacted`.

The same top-level families occurred in both observed CLI versions. One older-version file also
contained completed `ImageView` items; newer files contained completed `Extension` items. Both
versions contained messages, reasoning, commands, file changes and MCP calls. Some
`response_item` rows had an optional top-level `metadata` object.

### Session and project identity

`session_meta.payload` contained string `id`, `session_id`, `timestamp`, `cwd` and `cli_version`.
It also contained `source`, `thread_source`, `originator`, `history_mode`, Git metadata and runtime
workspace roots. `cwd` is the available project grouping input. It identifies where the session
ran, not a byte snapshot, and must not be published as a raw home path.

The observed session sources were exec and VS Code, the history mode was paginated, and the thread
source was user. Git metadata exposed branch, commit and repository URL fields; these are private
source data and are not needed for the initial session index.

### User prompts and messages

User prompt text appeared in `response_item` records with payload type `message`, role `user`, and
content parts of type `input_text`. Agent messages used role `assistant` and `output_text` parts.
Completed `event_msg.item_completed` records also contained `UserMessage` and `AgentMessage`
objects with text content.

The completed `UserMessage` texts were an exact-content subset of the response-item user texts in
the inspected files, but used different item IDs. A parser that imports both paths would duplicate
prompts. P2 should use response-item user messages as the canonical prompt stream for these known
versions and treat completed `UserMessage` entries as corroborating/alternate-format input, not a
second prompt. This rule is version-gated.

### Tool calls, results and edits

Low-level `response_item` records included:

- `custom_tool_call` / `custom_tool_call_output` with `id`, `call_id`, name and input/output;
- `function_call` / `function_call_output` with `id`, `call_id`, name and arguments/output;
- matching call/output correlation through `call_id` in all but one still-unpaired active call at
  the inspection boundary.

The current local format did **not** persist direct Bash/apply_patch names as the primary completed
step representation. Most custom calls were named `exec` and carried an orchestration input string.
Completed steps were instead exposed through `event_msg` payload type `item_completed`:

- `CommandExecution`: command list, working directory, parsed command classifications, aggregate
  output, status, exit code, process identity and duration;
- `FileChange`: a mapping of affected paths to add/update/delete facts with content/unified diff,
  optional move path, status, stdout and stderr;
- `McpToolCall`: server/tool identity, arguments, result, status, duration and read-only hint;
- `Reasoning`, `AgentMessage`, `UserMessage`, `ImageView`, `Extension` and `ContextCompaction`.

Observed `FileChange` entries covered add, update and delete. Their patch/content fields are useful
edit evidence but are not complete before/after project snapshots. They must be redacted before
persistence and rendered with unknown historical file state. `CommandExecution` can surface shell
edits as a command step, but its command text does not prove resulting file bytes. The parser must
prefer completed item shapes for displayable steps while retaining call IDs/source IDs for
correlation and deduplication.

### Timestamps and duration

All inspected top-level records carried an ISO-like timestamp string. Each completed-item event
also carried integer `started_at_ms` and `completed_at_ms`; command and MCP items contained duration
objects. Session metadata had its own timestamp, and task events exposed start, completion,
duration and time-to-first-token fields. Import can preserve event time and bounded duration without
inferring any missing interval.

### Resume, fork and compaction behavior

No repeated response-item ID was observed across the four real files, so this inventory did not
contain a demonstrated resumed/forked duplicate history. `compacted` records did contain window and
resume metadata, including last-started-turn and previous-turn settings. The importer must still
deduplicate by stable item ID across the selected source before rendering, as required by the
source contract, but tests rather than this sample will establish resumed-session behavior.

Prompt duplication between response items and completed user-message events is a separate
same-session representation issue and cannot be solved by item ID alone for the observed versions.

## Claude Code gate

The assumed `~/.claude/projects/<encoded-project>/<session>.jsonl` layout could not be checked
because the root was absent. P3 will therefore:

- keep the raw project folder name only in local import metadata;
- perform a documented best-effort path-style decode without claiming it is canonical;
- version-gate every accepted synthetic shape;
- represent unknown versions, records and corrupt lines with visible unsupported/gap records;
- count sidechain, subagent, meta and system handling explicitly;
- state clearly that support is synthetic-fixture-derived and make no real-format validation claim.

## Evidence boundary

History import can provide, when present:

- full user prompts after typed secret redaction;
- ordered agent messages and completed tool/edit steps;
- record/event IDs, turn/call correlation and timestamps/durations;
- command exit status and patch/command text as historical evidence.

History import cannot provide:

- exact project bytes before or after a step;
- a complete filesystem history or intermediate writes;
- proof that a command caused a file state;
- verified intent, correctness, test coverage or causality.

Claude file-history snapshots, if a future local sample contains them, are optional source evidence
and will not be treated as the live hook store's byte-exact snapshot contract.

## Strictly additive contract plan

Existing schema versions remain `replay-export-1.0` and `replay-export-2.0`. P1 must add optional
fields only. Existing required fields, enum/literal values and fixture meanings stay unchanged.
Imported records will reuse current values:

- provenance is already a free string and may carry `history_import`;
- attribution is `unknown`;
- incomplete historical file evidence uses `partial` or `unsupported`;
- existing record kinds are reused, with unsupported source records represented by the existing
  `unsupported` kind and corrupt/missing evidence by the existing `gap` kind.

Contract surfaces whose existing members and literals are frozen (files may receive optional
additions only):

- `src/faultmesh/replay/models.py`: `RecordKind`, `AttributionStatus`, `Completeness`,
  `ReplaySession`, `ReplayRecord`, `TimelineEntry`, `ReplayExport` and all required nested models;
- `src/faultmesh/replay/narration.py`: `ReplayNarrationExport`, `StepNarration`, chapter and checked
  narration contracts;
- `src/faultmesh/replay/views.py`: v1 export/load/checkpoint behavior;
- `src/faultmesh/replay/store.py`: current store records and live-capture semantics;
- `ui/src/replay/types.ts`: v1/v2 versions, record/completeness/attribution literals, required
  session/record/timeline/export fields and narration types;
- `ui/src/replay/validators.ts`: accepted versions and existing required-field validation;
- `ui/src/adapter/replayAdapter.ts`: current timeline/checkpoint assumptions;
- `tests/fixtures/replay/fixture_replay_v1_nomodel.json` and
  `tests/fixtures/replay/fixture_replay_v2_enriched.json`;
- `tests/fixtures/replay/capture_initial.json`, `capture_sequence.ndjson` and
  `narration_examples.json`.

P1 compatibility tests must load every existing replay fixture unchanged, validate absence and
presence of each optional import field, and prove the UI fixture contracts remain accepted without
editing `ui/`.

## P0 gate decision and open questions

P0 passes for the observed Codex JSONL versions after adjusting the plan to parse completed
`CommandExecution`/`FileChange` items rather than assuming direct Bash/apply_patch records.

Two resolved limitations remain important:

1. No real Claude Code log was available. P3 will implement conservative, version-gated support
   from sanitized synthetic fixtures only, and P5 will not claim a real Claude smoke result.
2. No real `.jsonl.zst` was available. P2 will use the local `zstd` executable without adding a
   dependency; if it is unavailable, the compressed session will be visibly unsupported.

No code, schema, fixture or UI file changed in P0. P1 adds optional Python model fields only and
does not change `ui/` or any existing fixture.

## P0 validation

The existing non-container suite passed with 205 tests and 5 container tests deselected; coverage
was 85%. Mypy reported no issues in 58 source files, and Ruff lint passed. There were zero changed
Python files to format-check in this documentation-only phase. A separate repository-wide Ruff
format audit identified 71 pre-existing unformatted files; P0 does not rewrite those unrelated
files.
