# V2 per-test evidence and failed-test replay

V2 extends the V1 Docker runner without adding host execution or model inference. Observation is
opt-in. It stores exact pytest cases, phase outcomes, failure evidence, and coverage.py dynamic
contexts mapped to a scan-time source snapshot. Read and export use only saved evidence.

## Evidence contract

Every observed test refers to its run, exact node ID, source revision and worktree content hash,
file hashes, phases, instrumentation version, immutable image ID, actual installed packages, and
artifact paths. Collection/import-time lines are stored separately. Unknown contexts, outside-root
files, parse errors, and unmapped lines remain explicit rather than being promoted to symbols.

`TEST_EXECUTED_SYMBOL` means a test-phase context recorded an executable line owned by the named
symbol. It does not prove a direct call, caller/callee relationship, causal responsibility, or full
function coverage. Setup and teardown evidence belongs to the test context that pytest exposed;
shared fixture attribution is not evidence that every dependent test executed the setup.

Failure fingerprints normalize line endings, workspace prefixes, memory addresses, and reported
durations, then hash the normalized failure text with SHA-256. Raw bounded failure text stays in the
record. A matching fingerprint on one replay proves one matching repeat only.

## Commands

```console
faultmesh run-tests --observe /path/to/project-run.toml
faultmesh test-cases <run-id> --config /path/to/project-run.toml
faultmesh test-evidence <run-id> '<exact-node-id>' --config /path/to/project-run.toml
faultmesh replay-test <run-id> '<exact-failed-node-id>' --config /path/to/project-run.toml
faultmesh export-run <run-id> --config /path/to/project-run.toml
```

Read/export never executes target code and still works if the checkout is missing. Replay accepts
only a failed/error case already stored under the parent run. It safely rebuilds argv to select that
exact node, including parameter IDs, and starts a fresh isolated container. It refuses changed or
missing source, a missing/different prepared image, different packages, unsafe custom pytest argv,
and unsupported selectors. The replay is a new append-only run linked to its parent.

## Supported boundary and limits

Observation supports serial, in-process pytest. It rejects xdist, pytest-forked, and attempts to
override FaultMesh's coverage/plugin controls. Coverage cannot completely attribute subprocess,
background, or native-extension execution. The runtime retains V1's read-only source/root, no
network, non-root user, dropped capabilities, no-new-privileges, and resource/output limits.
Evidence reports have a separate byte limit and are validated as untrusted input. This protects the
host parser but does not make artifacts cryptographically tamper-proof against target code.

The project-runner store and config are schema 2.0. A V1 run database is rejected without mutation;
use a fresh artifact root. No automatic migration or history reset is performed.

## Real-container acceptance

The gate ran on 2026-10-26 using Docker 29.5.2 on ARM64 through Colima. The target was MIT-licensed
[`python-hyper/hpack`](https://github.com/python-hyper/hpack) at full revision
`c2edbee3b5508e0b1689877fe6f173eafb097aef`. The upstream checkout stayed clean and had content hash
`df3410df5c8bf6f5608d434bc1d3006625ee58a2036b854662c11bd6e2ed102d`.

The config used Python 3.11 slim at registry digest
`sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377`.
Its locally prepared immutable image was
`sha256:41242ff8bcb8bda7755aa1d4a832902523b8b14a1968ffb204ec3296c0268f75`.
Requested packages were pytest 9.0.3, Hypothesis 6.152.1, pytest-json-report 1.5.0, and coverage
7.10.7; the complete installed inventory is retained in the fixture.

Two independent observed runs, `run-27d885ccc99b` and `run-3d3402eb34e2`, each collected and passed
502 tests with `COMPLETE` observation. Their records and artifacts were separate. Selected exact
tests produced different source-grounded symbol sets, including an integer-encoding case mapped to
`encode_integer` and an encoder case mapped to encoder and header-table methods.

A disposable clone added `tests/test_faultmesh_injected_failure.py` with one intentionally wrong
expectation: `encode_integer(10, 5) == b"\\x00"`. This is an injected acceptance failure, not an
upstream hpack bug. Parent `run-1c31adf64626` collected 503 tests: 502 passed and one failed. The
failure observed `src/hpack/hpack.py` lines 55, 57, 61, 65, 67, and 68 in `encode_integer`, and had
fingerprint `903afcd3b317b31e4efe2707558e22cb70890c1b774fc9affb093485808eb38e`.
Exact replay `run-9de6b4cb5a58` selected only that node and returned `SAME_FAILURE` with the same
fingerprint.

A separate one-second timeout run, `run-ea9f64f06520`, was stored as `TIMEOUT` with
`INSTRUMENTATION_ERROR`, no invented test cases, and no failure claim. Changing only the disposable
test source then caused replay to refuse the checkout because its content hash no longer matched.
The compact acceptance record is [fixtures/v2-hpack-acceptance.json](fixtures/v2-hpack-acceptance.json),
and [fixtures/v2-test-evidence-example.json](fixtures/v2-test-evidence-example.json) shows the saved
test evidence shape.
