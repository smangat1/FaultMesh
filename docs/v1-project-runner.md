# V1 isolated project test runner

V1 runs a configured existing pytest suite in Docker and stores a durable run record. It does not
use inference, decide what tests mean, or claim causality. It also does not provide per-test coverage,
test-to-code edges, or exact failed-test replay; those are V2.

## Supported boundary

- The target is an existing Git checkout at one full commit SHA. Dirty files are allowed but are
  disclosed and covered by a content hash.
- The base is a Python image pinned by registry digest.
- Test dependencies use simple `name==version` pins. FaultMesh installs only these pins while
  building a test image; it does not install the target or run its setup scripts.
- The test command is an argv list beginning with `python -m pytest`. There is no shell expansion.
- The runtime is offline, non-root, capability-free, read-only, `no-new-privileges`, and bounded by
  CPU, memory, PID, time, and captured-output limits. The target mount is read-only. Only `/tmp` and
  the run's output directory are writable.
- Docker must already be installed and available. There is no local-execution fallback.

The config schema is shown in [configuration.md](configuration.md). Run and inspect it with:

```console
faultmesh run-tests /path/to/project-run.toml
faultmesh test-run <run-id> --config /path/to/project-run.toml
```

`run-tests` exits 0 only for `PASSED`, 1 for a reported pytest failure, and 2 for every other
outcome. The output root contains `runs.sqlite3` and one immutable `runs/<run-id>/` directory per
attempt. Each directory has the config snapshot, generated Dockerfile, bounded stdout/stderr,
`run.json`, and a pytest JSON report when pytest produced one. References inside `run.json` are
relative to the output root. `resolved_image_id` is the local built-image ID;
`environment.base_image` retains the configured registry digest. `registry_digest` remains null
when Docker supplies no separate resolved registry identity.

## Fresh acceptance record

This V1 validation was run on 2026-10-26 on an 8 GB Apple M2 through Colima. It is separate from
older `.faultmesh` evidence and model files.

- Source: `https://github.com/python-hyper/hpack.git`
- Revision: `c2edbee3b5508e0b1689877fe6f173eafb097aef`
- License: MIT
- Suite: the complete upstream `tests` directory, run serially
- Base: `python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377`
- Pins: `pytest==9.0.3`, `hypothesis==6.152.1`, `pytest-json-report==1.5.0`
- Local built image: `sha256:5059f85e8cdf058001bd6e59087f0d923cfaf3bbe3285d497410621a73057a1b`
- Docker server: 29.5.2, ARM64

The acceptance config used `argv = ["python", "-m", "pytest", "-q", "tests"]`,
`pythonpath = ["src"]`, a 300 second timeout, 512 MiB memory, 1 CPU, and 128 PIDs. From a directory
containing `hpack/` and `hpack-run.toml`, the repeatable commands are:

```console
git clone https://github.com/python-hyper/hpack.git hpack
git -C hpack checkout --detach c2edbee3b5508e0b1689877fe6f173eafb097aef
faultmesh run-tests hpack-run.toml
faultmesh run-tests hpack-run.toml
```

Both clean runs used network-disabled test containers, collected 502 tests, passed 502, and exited
0. The independent run IDs were `run-684ec2fb17e8` and `run-9e29c4dddd11`; their durations were
11,784 ms and 6,022 ms. The target was clean before and after both runs and had the same content hash.

A disposable clone with one added failing pytest test produced `run-5410f00a2d1f`: 503 collected,
502 passed, 1 failed, exit 1, outcome `FAILED`. A separate test that slept for 30 seconds under a
1-second limit produced `run-961aed44bb30`: no process exit code or pytest summary was invented,
termination and outcome were `TIMEOUT`, and the CLI exited 2. The clean upstream checkout was not
changed by either control.

The real-container probe reported host UID/GID `501:20` rather than root, `CapEff` all zero,
`NoNewPrivs` 1, seccomp mode 2, denied root/source writes, blocked DNS, and no inherited host
secret-like environment names. The marked Docker integration test also passed; it is excluded from
ordinary CI because hosted runners are not the acceptance evidence.

## Limits and old evidence

V1 does not support arbitrary dependency managers, editable installs, project build hooks, services,
databases, browsers, writable source trees, or non-pytest commands. Projects that need those features
must wait for an explicit extension instead of weakening isolation.

The main evidence store now has scoped immutable entity identities and schema version 2. Legacy
unversioned databases are rejected before modification. Keep them in place and configure a fresh
`artifact_directory`, such as `.faultmesh-v2`, for new analysis. Project-test runs use their own
versioned `runs.sqlite3`; they do not migrate or modify old investigation history.
