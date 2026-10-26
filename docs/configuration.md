# Configuration

FaultMesh reads `.faultmesh.toml` from the repository root. CLI flags override file values.

```toml
[faultmesh]
model = "llama-server" # llama-server, llama-cli, or heuristic
llama_endpoint = "http://127.0.0.1:8080/v1/chat/completions"
llama_model = "local-model"
llama_cli = "llama-completion"
model_path = "/models/code-model.gguf"
max_context_characters = 12000
max_examples = 200
confirmation_runs = 3
timeout_seconds = 30
docker_image = "faultmesh-sandbox:0.1.0"
artifact_directory = ".faultmesh"
```

The evidence database schema is now explicitly versioned. A legacy unversioned database is rejected
without being modified. To keep old artifacts, point `artifact_directory` at a fresh directory such
as `.faultmesh-v2`; FaultMesh does not silently migrate or reset old history.

Build the sandbox image once with
`docker build --network=default -f Dockerfile.sandbox -t faultmesh-sandbox:0.1.0 .`. The heuristic
backend exists for deterministic tests and limited docstring-derived checks. It does
not substitute for model-quality evaluation. Docker images must be pulled or built in advance
because verification containers run with networking disabled.

`llama-completion` is the default executable for the `llama-cli` backend because it is llama.cpp's
single-shot completion binary. Recent `llama-cli` releases provide an interactive chat interface and
are not interchangeable with a batch subprocess adapter. Override `llama_cli` for older llama.cpp
distributions that use a different executable name. FaultMesh also passes `--single-turn` so a
chat-templated model cannot leave the batch subprocess waiting for another interactive turn.

## V2 project test runs

The project runner uses a separate TOML file and a separate run store. Paths are relative to that
file. A minimal config is:

```toml
[project_run]
schema_version = "2.0"
target_root = "hpack"
revision = "c2edbee3b5508e0b1689877fe6f173eafb097aef"
artifact_root = "faultmesh-v2-runs"

[project_run.environment]
base_image = "python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377"
dependency_pins = [
  "pytest==9.0.3",
  "hypothesis==6.152.1",
  "pytest-json-report==1.5.0",
  "coverage==7.10.7",
]

[project_run.test]
argv = ["python", "-m", "pytest", "-q", "tests"]
working_directory = "."
pythonpath = ["src"]

[project_run.limits]
timeout_seconds = 300
memory = "512m"
cpus = 1.0
pids = 128
max_output_bytes = 1000000
max_evidence_bytes = 10000000
```

`artifact_root` must be separate from `target_root`. FaultMesh owns the pytest JSON report options,
rejects shell commands and escaping paths, and requires a full lowercase commit SHA, a registry
digest on the base image, and exact dependency pins. See
[v1-project-runner.md](v1-project-runner.md) for the underlying runner boundary.

Pass `--observe` to add FaultMesh's pinned coverage instrumentation. The runtime stays offline;
image preparation can use the network only before the isolated test container starts. Observation
rejects xdist, forked execution, and user-supplied coverage/plugin controls. Subprocess, native
extension, and background activity is not attributed completely. `max_evidence_bytes` bounds each
container evidence report before parsing.

Project-runner records and its SQLite store use schema 2.0. A V1 store is rejected before any
write; select a fresh `artifact_root` instead of deleting or relabeling history. Requested pins and
the actual installed package inventory are both recorded because direct pins alone do not describe
the complete prepared environment. See [v2-test-evidence.md](v2-test-evidence.md).

