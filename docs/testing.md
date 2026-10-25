# Testing FaultMesh locally

These commands reproduce the Milestone 1 checks on the validated 8 GiB Apple M2 setup. Run them
from the FaultMesh repository root. They do not use heuristic inference or host execution for the
real-model validation.

## Fast automated checks

```console
.venv/bin/ruff check .
.venv/bin/mypy --strict src tests
.venv/bin/pytest -q
```

The expected result is a clean Ruff run, a clean strict mypy run, and all tests passing. Some
automated tests exercise the explicitly unsafe local runner against the bundled trusted fixture;
they are not substitutes for the separate real-model and Docker checks below.

## Build and check the Docker sandbox

Start the small VM and build the current source into the sandbox image:

```console
colima start
docker info --format 'engine={{.ServerVersion}} arch={{.Architecture}} cpus={{.NCPU}} memory={{.MemTotal}}'
docker build --network=default -f Dockerfile.sandbox -t faultmesh-sandbox:0.1.0 .
docker image inspect faultmesh-sandbox:0.1.0 --format 'image={{.Id}} bytes={{.Size}} user={{.Config.User}}'
```

On this machine, `docker info` should report ARM64, 2 CPUs, and approximately 2 GiB. The image user
must be `65534:65534`.

This probe runs with the same production isolation flags and should report UID/GID 65534, zero
effective capabilities, `NoNewPrivs` 1, seccomp 2, the configured cgroup limits, denied writes, and
blocked DNS:

```console
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 1.0 \
  --user 65534:65534 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --volume "$PWD/examples/buggy_python_project:/workspace:ro" --workdir /workspace \
  faultmesh-sandbox:0.1.0 python -c '
import os, pathlib, socket
status = {line.split(":", 1)[0]: line.split(":", 1)[1].strip()
          for line in pathlib.Path("/proc/self/status").read_text().splitlines() if ":" in line}
print("uid_gid", os.getuid(), os.getgid())
print("cap_eff", status["CapEff"])
print("no_new_privs", status["NoNewPrivs"])
print("seccomp", status["Seccomp"])
for name in ("memory.max", "pids.max", "cpu.max"):
    print(name, pathlib.Path("/sys/fs/cgroup", name).read_text().strip())
for path in ("/faultmesh-write-probe", "/workspace/faultmesh-write-probe"):
    try:
        pathlib.Path(path).write_text("x")
        print("write", path, "ALLOWED")
    except OSError as error:
        print("write", path, "DENIED", error.errno)
try:
    socket.getaddrinfo("example.com", 443)
    print("dns ALLOWED")
except OSError:
    print("dns BLOCKED")
'
```

## Fresh real llama.cpp-to-Docker run

First verify that the already-installed binary and model are present:

```console
command -v llama-completion
test -f .faultmesh/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
shasum -a 256 .faultmesh/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
```

The expected model digest is
`cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046`.

Create a new fixture inside the repository so Colima can mount it, then analyze it:

```console
FAULTMESH_VALIDATION_DIR=".faultmesh/manual-validation-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$FAULTMESH_VALIDATION_DIR"
rsync -a --exclude=.faultmesh --exclude=.hypothesis --exclude=__pycache__ \
  examples/buggy_python_project/ "$FAULTMESH_VALIDATION_DIR/"

.venv/bin/faultmesh analyze "$FAULTMESH_VALIDATION_DIR" \
  --model llama-cli \
  --model-path .faultmesh/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf \
  --json-logs
```

Do not pass `--allow-local-execution`. A successful summary reports `"sandbox": "docker"`, three
real model calls for the bundled fixture, and one incident. The exact hypothesis text can vary, so
success means a validated property violation—not a byte-for-byte match to an earlier response.

Copy the printed incident ID and replay it from the saved artifact:

```console
.venv/bin/faultmesh reproduce <incident-id> --repository "$FAULTMESH_VALIDATION_DIR"
.venv/bin/faultmesh report <incident-id> --repository "$FAULTMESH_VALIDATION_DIR" --format markdown
```

Replay passes when `outcome` is `PROPERTY_VIOLATION`, `fingerprint_matched` is `true`, and all three
confirmation runs fail with the same fingerprint. Stop Colima afterward to return its memory:

```console
colima stop
```

## What this does not prove

This procedure validates one Qwen quantization, one seeded example, and Docker through Colima on one
Apple Silicon host. It does not validate the interactive `llama-cli` binary, Docker Desktop, other
models or machines, arbitrary dependency-heavy projects, or natural-language preconditions outside
FaultMesh's deliberately small safe compiler subset.
