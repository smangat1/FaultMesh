# FaultMesh

FaultMesh is an offline-first, evidence-driven bug discovery and reproduction framework for
Python. A bounded model or deterministic proposer suggests an explicit behavioral property;
FaultMesh validates that property, searches for a counterexample with Hypothesis, reproduces the
failure, persists its evidence in SQLite, and emits an executable regression test plus JSON and
Markdown incident reports.

The model is not the oracle. A finding reaches `VERIFIED` only after a validated property is
violated by a stable, repeated execution.

## Milestone 1 status

Implemented:

- Python AST indexing with hashes, functions, classes, calls, branches, handlers, and assertions.
- A versioned Pydantic contract for hypotheses and executable property specifications.
- llama.cpp server and CLI adapters with JSON validation, repair retries, and usage metadata.
- Safe compilation of a small precondition subset into executable property constraints.
- A documented deterministic heuristic backend for offline integration testing.
- An SQLite evidence graph with typed records, edges, revisions, and guarded state transitions.
- Allowlisted property/oracle validation, Hypothesis counterexample search and shrinking.
- A Docker sandbox (secure default) and an explicit unsafe local subprocess fallback.
- Stable-failure confirmation, fingerprints, replay, pytest artifact generation, and Markdown/JSON
  reports.
- A deliberately buggy example and end-to-end tests.

Validated on an 8 GB Apple M2 with llama.cpp 0.7.0, the official Qwen2.5-Coder-1.5B-Instruct
Q4_K_M GGUF, and an ARM64 Docker engine: both the `llama-server` path and the batch
`llama-completion` CLI path proposed the boundary hypothesis, the locked-down container found and
shrank the counterexample, and saved-artifact replay matched the failure fingerprint. See
[docs/milestone-1-validation.md](docs/milestone-1-validation.md) for exact versions, measurements,
isolation probes, and remaining limitations. Multi-agent roles and flaky-test investigation belong
to later milestones.

## Install and run

```console
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
faultmesh analyze examples/buggy_python_project --model heuristic --allow-local-execution
```

The local runner executes repository code on the host and is intended only for trusted fixtures.
For an untrusted repository, omit `--allow-local-execution`; FaultMesh uses Docker with networking
disabled, a read-only root filesystem, resource limits, and a non-root user.
Add `--json-logs` to emit redacted, machine-readable progress events on stderr while keeping the
execution summary on stdout.

For llama.cpp's OpenAI-compatible server:

```console
faultmesh analyze ./repository --model llama-server \
  --llama-endpoint http://127.0.0.1:8080/v1/chat/completions
```

Or configure `.faultmesh.toml` (see [docs/configuration.md](docs/configuration.md)). Other commands:

```console
faultmesh reproduce <incident-id> --repository ./repository
faultmesh report <incident-id> --repository ./repository --format markdown
faultmesh inspect ./repository
```

See [docs/architecture.md](docs/architecture.md) for architecture, contracts, risks, the complete
data flow, and Milestone 1 acceptance criteria. The supported programmatic surface is documented in
[docs/api.md](docs/api.md). To reproduce the automated, Docker-isolation, and real-model checks, use
the copy-paste procedure in [docs/testing.md](docs/testing.md).

## Safety

Scanning is non-executing. Verification is a separate phase. Docker is the product default and
network access is disabled. The worker rejects source that no longer matches the scan-time content
hash and replay input outside the accepted property domain. Host execution requires the explicit
`--allow-local-execution` flag and is not a security boundary. FaultMesh never publishes findings.

## Development

```console
python -m pytest
ruff check .
mypy
```

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). FaultMesh is licensed under the
Apache License 2.0.

