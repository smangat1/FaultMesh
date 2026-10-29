# Codex capture boundary

## Decision

FaultMesh can capture exact selected-project bytes immediately before and after a supported local
Codex tool call by using synchronous `PreToolUse` and `PostToolUse` hooks. The two hook events carry
the same `tool_use_id`, so a snapshot pair can be attributed to that logged tool invocation. This is
an exact **tool boundary**, not a syscall or individual-write trace.

The supported Phase 1 granularity is therefore:

- exact pre-tool and settled post-tool bytes for observed `Bash` and `apply_patch` calls;
- an initial selected-root snapshot;
- an explicit gap when one tool call performs multiple writes, when a hook is absent or fails, or
  when a tool path does not support hooks;
- no assertion that a byte change was authored by the agent outside a complete supported hook pair.

Phase 1 may proceed at this boundary. Checkpoint-only fallback approval is not needed for the
tested adapter.

This exact-byte capture path is distinct from read-only history import. History discovery inspects
only `~/.codex/sessions` and `~/.claude/projects`, then imports a selected session's prompts,
completed steps and timing as partial source evidence. History import never claims historical file
bytes: it emits no manifests or content objects, marks edit evidence with `file_state: unknown`,
and keeps unknown versions or corrupt records visible as unsupported/gap steps. Selecting a project
folder remains optional and is required only to begin new byte-exact hook capture.

## Tested implementation

- Installed executable: `codex-cli 0.165.0-alpha.1.2`
- Matching open-source tag: `rust-v0.165.0-alpha.1.2`
- Matching source commit: `720fec862a608ae1e5878d1eecb04fb93192e93c`
- Platform tested: macOS arm64, one new local `codex exec --json` session
- Test date: 2026-10-28
- FaultMesh base: `a2b406aeee9471b6afea45cfd73ed07f4c095906`

The version-matched sources show that rollout JSONL is a durable session representation, while the
rollout policy distinguishes persisted completed items from transient begin/end events and bounds
persisted command output. The TypeScript SDK's `FileChangeItem` contains paths and change kinds,
not complete before/after bytes. It cannot by itself reconstruct shell-written changes or exact
historical content.

Sources:

- [rollout recorder](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/rollout/src/recorder.rs)
- [rollout persistence policy](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/rollout/src/policy.rs)
- [SDK item types](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/sdk/typescript/src/items.ts)
- [official hooks documentation](https://learn.chatgpt.com/docs/hooks)

## Supported local interface

The probe supplies session-local hook configuration through `codex exec -c` and uses
`--dangerously-bypass-hook-trust` only for its generated synthetic repository. Both hooks are
synchronous and restricted to `Bash` and `apply_patch`. Each hook receives:

- session and turn identity;
- canonical tool name;
- one `tool_use_id` shared by the pre and post event;
- tool input;
- post-tool response on `PostToolUse`.

`codex exec --json` separately emits ordered `item.started` and `item.completed` records. For this
version, command items include the command, aggregated output, exit code and status. File-change
items identify the changed path and add/delete/update kind, but not full bytes.

FaultMesh's boundary probe does not read the transcript path or scan the Codex home. It starts one
new session and snapshots only the explicitly created fixture root. This statement describes the
probe and live-capture adapter, not the separate read-only history importer.

## Real-run fixture and results

Run:

```console
python scripts/replay_capture_probe.py probe
```

The interpreter must provide pytest. The script creates a temporary Git repository, writes a
synthetic Python module and one test, and asks a new Codex session to perform eight separate tool
calls:

1. edit a function through `apply_patch`;
2. run a failing pytest invocation;
3. restore the function through a shell-written edit;
4. create a Python file;
5. rename it;
6. delete it;
7. perform three immediate writes to one file inside one shell command;
8. run the now-passing pytest invocation.

Acceptance result from the 2026-10-28 run:

| Evidence | Observed result |
| --- | --- |
| CLI JSONL records | 23 |
| Hook records | 17: one initial snapshot plus 8 pre/post pairs |
| Complete `apply_patch` boundaries | 1 |
| Complete `Bash` boundaries | 7 |
| Function edit | pre/post SHA-256 changed and later returned to the exact initial hash |
| Create/rename/delete | exact bytes followed the path change, then the path disappeared |
| Failing pytest | exit code 1; one failing test in bounded command output |
| Passing pytest | exit code 0; one passing test in bounded command output |
| Rapid writes | only `STAGE = 3\n` existed at the post-tool boundary |

Sanitized content identities:

- initial/final `calculator.py`:
  `ee74e1d7b3f1de8e0aecec6b7be47aea6fad592c0f758eccc7e328ce097e7d6f`
- patched failing `calculator.py`:
  `29d5327c3e097221059dcfd0923e757408b78c79be876399f1155d3a3b0b4e7e`
- created/renamed content:
  `c2d93c104977d99341e1447a2f75749ee8bdc781a25f144e7cb33072582eb41c`
- settled `rapid.py`:
  `60dc5a0e1fe3af7f1fc1a524594284eac615573400387cb9f626a8f355f0bd58`

The raw synthetic transcript, hook events and base64 bytes remained in the probe's printed local
temporary output directory. They are not committed because raw recordings and machine-specific
paths are not source fixtures.

## Evidence states

Phase 1 must preserve these distinctions:

- `observed`: a snapshot was read and hashed at one hook boundary;
- `merged`: adjacent post/pre snapshots have identical manifests and may share content objects,
  while their source records remain distinct;
- `missing`: the expected boundary is absent, a file changed during capture, or the source is
  truncated/corrupt;
- `unsupported`: the Codex version, event, tool path or file kind has no tested adapter;
- `unknown attribution`: bytes changed without a complete matching pre/post tool pair;
- `tool_boundary`: complete matching hook pair; the diff occurred during the tool interval, but
  this is not a claim about which subprocess or actor performed each filesystem operation.

## Known limitations

- Three rapid writes inside one Bash call produced only the settled final bytes. `STAGE = 1` and
  `STAGE = 2` were not observed and must never be fabricated.
- The hook pair proves an interval around a logged tool call. A concurrent external writer inside
  that interval cannot be distinguished reliably by this mechanism alone.
- Specialized or hosted tool paths may not invoke local tool hooks. Unknown events must become
  visible `unsupported` records rather than disappear.
- A killed process, hook timeout, hook error or abrupt Codex termination can leave an unmatched
  boundary. That is a gap, not a completed action.
- Post-tool output may be bounded or redacted. A shell exit code is command evidence, not a
  structured pytest result or proof of exact test counts.
- SDK file-change items do not contain complete patches or historical bytes. Rollout history is
  supporting action evidence, not the byte store.
- History-import redaction is best effort. A visible marker records the detected secret family but
  cannot prove that arbitrary imported text contains no undiscovered secret.
- Claude Code support is provisional and synthetic-contract-only because no real Claude history
  was available on the development machine.
- This probe tested one installed Codex build, one selected project and no concurrent writers.
- Hook configuration is trusted executable code. Production capture must be explicit opt-in,
  visible to the user and version-gated.

## Repeatability and privacy

The probe source is `scripts/replay_capture_probe.py`. It creates a new repository and session on
each run, records only `*.py` under that repository, skips symlinks and tool metadata folders, and
retains output locally for inspection. It does not use old sessions, recursively inspect the
Codex home, upload recording data, or commit raw transcripts. Separately, history import reads
existing dotfolder logs without writing them, scans no broad home folders, follows no symlinked
directories and exports only the explicitly selected session after typed redaction.
