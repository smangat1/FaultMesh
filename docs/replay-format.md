# Replay export format 1.0

`replay-export-1.0` is a deterministic, no-model, offline playback document. It contains only
persisted replay evidence: session metadata, ordered source records, manifests, content-addressed
bytes, structured test evidence, timeline views and explicit limitations. It does not require the
original checkout.

Print the machine-readable schema with:

```console
faultmesh replay-schema export
```

`replay-export-2.0` is the optional enriched document. It retains every v1 evidence field and adds
bounded evidence packets, raw/parsed/repaired claim attempts, three-way checker verdicts,
evidence-linked likely-reason records, summary audits, deterministic baseline chapters and selected
chapters. Print its schema with `faultmesh replay-schema narration-export`. V1 documents remain
loadable and never require narration.

Every claim run persists the actual selected `final_claims` batch and whether it came from the first
output, repaired output or deterministic fallback. Claim IDs and verdict IDs must form a one-to-one
mapping. An offline v2 consumer can render the canonical atomic claims and verdicts without a model,
packet reconstruction or access to backend facts.

Model-selected facts are checked atomically. A supported predicate does not certify adjacent prose.
Summary prose receives a fact status only when its exact span equals the deterministic canonical
rendering of that typed predicate and occupies a standalone summary line. Nearby, embedded,
compound or unrelated prose remains unverified even when paired with a true or false assertion.
Likely reasons are always model inferences, and model chapter titles are always interpretations.
The sanitized UI contract examples are in `tests/fixtures/replay/narration_examples.json`.

The capture input schema is available as `faultmesh replay-schema capture`.

## Top-level fields

| Field | Meaning |
| --- | --- |
| `schema_version` | Exact `replay-export-1.0` contract |
| `exported_at` | Deterministic latest stored record time, not wall-clock export time |
| `session` | Selected session identity, Codex version, limits and privacy mode; no root path |
| `records` | Append-only ingestion order and source identities/offsets |
| `manifests` | Exact bounded Python file identities and visible skip reasons |
| `content_base64_by_sha256` | Complete historical bytes keyed by verified SHA-256 |
| `tests` | Structured results and separate command-only observations |
| `timeline` | Derived read-only diffs, changed symbols, gaps and test markers |
| `limitations` | Claims the evidence cannot support |

Loading an export verifies that its content keys exactly match referenced manifest objects and
that every base64 object's SHA-256 matches its key. Checkpoint selection verifies size again. A
corrupt or unsupported document is rejected.

## Optional history-import extension

Both `replay-export-1.0` and `replay-export-2.0` accept the same strictly additive history-import
fields. Every field is optional, so existing exports and UI fixtures remain valid without changes.
No existing record kind, completeness value, attribution value or schema-version literal changes.

Optional session fields:

| Field | Meaning |
| --- | --- |
| `import_source` | `codex` or `claude_code` for a read-only history import |
| `format_version` | Exact source format/version label observed by the importer |
| `source_file_sha256` | SHA-256 identity of the local log; never its private path |

Optional record fields:

| Field | Meaning |
| --- | --- |
| `source_item_id` | Stable source-native identity used to deduplicate resumed history |
| `prompt_id` | Source-native user-prompt identity, when present |
| `prompt_text` | Full user prompt after typed secret redaction |
| `file_state` | `unknown` when history cannot establish exact before/after bytes |
| `edit_patch` | Source-provided patch evidence after typed secret redaction |
| `edit_command` | Source-provided file-writing command after typed secret redaction |
| `redaction_types` | Secret-class labels corresponding to visible redaction markers |

The existing optional `turn_id` remains the turn correlation field. Imported records use existing
record kinds and set attribution to `unknown`; their completeness remains `partial` or
`unsupported` as appropriate. Patch and command text are action evidence, not reconstructed file
state or proof of resulting bytes.

## Record and checkpoint semantics

Session `sequence` is monotonic. `source_identity` plus `source_offset` distinguishes ingestion
records and makes restart replay idempotent. Equal command text is not an identity and does not
collapse repeated tool calls.

`before_manifest_id` and `after_manifest_id` are chronological boundaries. They do not prove that
an edit caused, fixed or regressed a test. `tool_boundary` means synchronous pre/post hooks shared
one tool-use ID. `observed_checkpoint` is weaker and must not be presented as a tool step.

Completeness values:

- `complete`: the supported record and bounded snapshot are present;
- `partial`: some bytes or text were skipped, redacted or truncated;
- `missing`: a gap such as corrupt input, sequence loss, failed hook or rotation;
- `unsupported`: a known record exists but this adapter cannot interpret it.

Attribution values:

- `tool_boundary`: exact pre/post selected-root snapshots bracket one supported tool call;
- `observed_checkpoint`: snapshot only, with no supported tool attribution;
- `unknown`: no supported attribution can be established;
- `not_applicable`: initial metadata/snapshot.

## Source, diff and static symbols

Checkpoint files are decoded only from `content_base64_by_sha256`; replay never reads the current
checkout. Unified diffs compare stored bytes. Python symbol changes reuse the non-executing AST
index. A current syntax error makes last-good symbol facts explicitly unverified; old AST facts do
not verify current bytes. Static symbol changes and possible calls are not observed execution.

## Test evidence

Test states are `pass`, `fail`, `error`, `skipped`, `not_observed` and `incomplete`.

Structured evidence records:

- suite scope;
- exact test node IDs that actually ran, when supported;
- separate pass/fail/error/skipped counts;
- source type (`structured_fixture` or a narrow `version_tested_parser`);
- an associated manifest identity only when content identity or a validated no-write interval is
  available.

A shell command observation is deliberately separate. Its exit code proves only the recorded
command status. It cannot contain structured pytest counts or claim a test outcome. When a command
mentions pytest but output is absent, the state is `incomplete`; when output exists without a
supported parser, the state is `not_observed`. Timestamp proximity is
`nearby_in_time_state_unverified`, never “tests for this change.”

Existing `replay-test` project-runner behavior remains a separate explicit opt-in execution path.
Selecting or exporting an agent recording does not invoke it.

## Examples and honest unknowns

### Initial or empty project

An initial record may reference an empty manifest. Selection returns `files: []`; it does not
invent a source file or test result.

### Multi-step edit

Each complete tool pair has its own record IDs and manifests. Create, rename and delete appear as
path-level stored-byte transitions. Several files changed by one supported tool remain one tool
boundary. A polling batch, if imported, is labeled a checkpoint batch rather than a tool call.

### Failing then passing

Two structured results may say `fail` and later `pass` only when each result identifies its suite
scope and associated stored content. The words “before” and “after” remain chronological; the
export does not claim the edit fixed the failure.

### Missing output

A recorded `python -m pytest` command with no supported result is `incomplete` and has null counts.
No green badge or inferred pass is allowed.

### Partial or syntax-error snapshot

Skipped large/non-UTF-8/secret-like files set partial evidence and retain reasons. Invalid Python
bytes remain selectable and diffable. Changed symbols derived from an older parse are marked
`verified: false`.

## Read-only guarantees

Timeline, checkpoint and exported-checkpoint queries never:

- write into or require the original checkout;
- apply patches;
- reexecute recorded commands;
- launch pytest or the existing test-rerun feature;
- install dependencies;
- start Docker;
- call a model or cloud replay service.

The explicit `replay-export` command writes only the requested local JSON file. FaultMesh never
silently exports or publishes private recordings.
