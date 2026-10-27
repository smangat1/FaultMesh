# Typed-input investigator validation evidence

This is phase 1 acceptance evidence from 2026-10-27. It is not a benchmark and makes no claim
about model recall, precision, or superiority. The phase 2 pilot remains unexecuted.

## Runtime lock

- FaultMesh base: `2812bb6e9cfcf84ac6c2e163fa80e9f4f38e2616` (PR #8 merge head)
- llama.cpp: `llama-completion` 0.7.0, build 11669, commit `620d2225c`
- model: `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`
- model SHA-256: `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046`
- Docker image: `faultmesh-sandbox:0.1.0`
- image ID: `sha256:57e6feb9c91db0a36510f75e4b181ebdea9cb387837a3df2e2cee89b6562cbe0`
- sandbox controls: no network, read-only root, all capabilities dropped, no-new-privileges,
  non-root UID/GID 65534, 64-process limit, 512 MiB, one CPU

## Deterministic real-Docker acceptance

The checked-in specifications were searched and replayed through `DockerSandbox`, not through host
execution. Both searches minimized a real violation and both replays produced the same fingerprint:

| case | search counterexample | fingerprint | search | replay | worker time (search/replay) |
| --- | --- | --- | --- | --- | --- |
| text length | `{"value":""}` | `a45179c7247a6154f3c7ff6c` | 3/3 | 3/3 | 87.37 ms / 0.92 ms |
| list multiset | `{"value":[0,0]}` | `6145528736d50a76063649fb` | 3/3 | 3/3 | 24.60 ms / 2.14 ms |

The committed container regression is:

```console
FAULTMESH_RUN_CONTAINER_TESTS=1 pytest -q \
  tests/integration/test_typed_investigator_container.py -m container
```

## Real local-model smoke

Each target was copied into an isolated root containing only its buggy source. The corrected
variant, evaluator assertions, generated regression, and defect labels were not in model context.
The CLI used the real llama.cpp backend and selected Docker (no `--allow-local-execution`).

Text proposal (`14,209.27 ms`, zero repairs):

- proposed `schema_version: 1.1` and one hypothesis;
- incorrectly selected `integer_lists` for the annotated `str` argument;
- proposed `result_length_eq_arg` despite the cited at-most contract;
- added the prose precondition `value is a string`;
- final status: `UNSUPPORTED`; reason: the prose precondition is not a supported integer
  comparison; experiments/incidents/replays: 0/0/0.

List proposal (`14,280.16 ms`, zero repairs):

- proposed `schema_version: 1.1`, an `integer_lists` domain, and one hypothesis;
- selected only `result_list_nondecreasing`, omitting the independently documented multiset
  requirement;
- added the prose precondition `The input value is a list of integers.`;
- final status: `UNSUPPORTED`; reason: the prose precondition is not a supported integer
  comparison; experiments/incidents/replays: 0/0/0.

These are safe rejects, not bug findings or model successes. Because neither proposal reached
execution, there is no model-proposal replay evidence. Replay evidence above comes from the
deterministic, schema-valid Docker acceptance path and is reported separately on purpose.

During smoke setup, the model-facing schema initially allowed nested property versions and contract
citations to be omitted, and model-authored source identity could miss the evidence graph's canonical
node. The final implementation requires those fields in the inference grammar while preserving
schema 1.0 runtime deserialization, and deterministically binds every per-function proposal to the
freshly indexed function identity. The final runs above completed without either integration error.
