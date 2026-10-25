# Milestone 1 real-runtime validation

Validation was performed on October 25, 2026. No heuristic inference or host execution was used for
the passing end-to-end runs.

## Environment

- Host: Apple M2, 8 GiB unified memory, macOS 26.3.1, ARM64.
- llama.cpp: Homebrew `0.7.0`, build 11669, commit `620d2225c`.
- Model: official `Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF`, Q4_K_M, 1.065 GiB.
- Model SHA-256: `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046`.
  The digest matched the publisher's Hugging Face LFS metadata.
- Docker CLI: 29.9.1. Docker Engine: 29.5.2, Linux ARM64, provided by Colima 0.10.3
  using macOS Virtualization.framework.
- Colima allocation: 2 CPUs and 2 GiB memory; no Kubernetes, Rosetta, or x86 emulation.
- Sandbox image: `faultmesh-sandbox:0.1.0`, ARM64, 59,856,202 bytes, image ID
  `sha256:e437c45e43c295f883b53090bb287255cfbd760c2200f1ae9197b142fe83aa2f`,
  configured as UID/GID `65534:65534`.
- Pinned sandbox base: `python:3.11-slim` digest
  `sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377`.

## Passing server end-to-end result

The CLI analyzed the deliberately buggy example with `--model llama-server` and the Docker default;
`--allow-local-execution` was not present.

- Investigation: `inv-4b65f760985a`.
- Verified incident: `inc-de2480778c42`.
- Real model calls: 3.
- Model hypotheses: 3 total; the one grounded property was verified and two hypotheses emitted while
  inspecting test functions were deterministically rejected as `UNSUPPORTED` because their targets
  did not uniquely identify the inspected indexed function.
- Full CLI wall time: 33.41 seconds.
- Host CLI maximum RSS: 49,659,904 bytes; the separate loaded llama-server process used about
  1,196,528 KiB RSS after the run.
- Relevant inference call: 1,475 prompt tokens, 615 completion tokens, 11.93 seconds in an isolated
  preflight; the full-run call took 10.46 seconds.
- Minimized counterexample: `{"value": 0, "maximum": 0}`.
- Verification: `PROPERTY_VIOLATION`, 3/3 confirmations, Python 3.11.17 on Linux ARM64.
- Replay: 3/3 confirmations and exact fingerprint match
  `eead832e25ee2c693e55aa6e`.
- Regression, replay, JSON, and Markdown artifacts were generated.

The model supplied the behavioral hypothesis and explicit result-bound oracle. FaultMesh replaced
model-authored source hashes and line identities with the exact source reference from the AST index
before semantic validation; models are not trusted to reproduce content hashes.

## Passing batch CLI end-to-end result

A second fresh copy of the example was analyzed with `--model llama-cli`, whose default executable is
llama.cpp's batch-oriented `llama-completion`. The same Docker default was used and
`--allow-local-execution` was not present.

- Investigation: `inv-b6709a3d038a`.
- Verified incident: `inc-48beed714b35`; hypothesis: `hyp-ea015de23152`.
- Real model calls: 3, all with backend metadata `llama.cpp-cli`, the Qwen GGUF filename, and zero
  repair attempts.
- Per-call latency: 13.06, 13.12, and 12.32 seconds; full CLI wall time: 39.32 seconds.
- Host process maximum RSS: 1,517,813,760 bytes (about 1.41 GiB); no swap was observed.
- The model stated `0 <= value <= maximum` and `maximum >= 0`. The safe precondition compiler
  converted the nonredundant relationship to the executable constraint `value <= maximum`; the
  strategy's `[0, 100]` bounds already enforced the literal comparisons.
- Docker verification found `PROPERTY_VIOLATION` and minimized it to
  `{"value": 0, "maximum": 0}` with 3/3 confirmations.
- An independent `faultmesh reproduce` invocation used Docker, produced 3/3 confirming failures,
  and matched fingerprint `eead832e25ee2c693e55aa6e` on Python 3.11.17/Linux ARM64.
- Two model proposals made while inspecting test functions used prose outside the compiler's small
  allowlist. Both were persisted as `UNSUPPORTED` and were not executed.

An initial terminal-attached batch attempt reached the 120-second inference timeout because
llama.cpp automatically enabled conversation mode for the model's chat template and waited for a
subsequent turn. The adapter now passes `--single-turn`; its command construction is covered by a
regression test, and the fresh run above passed with a real terminal attached.

## Isolation probe

An independent container using the exact production flags reported:

- UID/GID 65534/65534.
- Effective capabilities `0000000000000000`.
- `NoNewPrivs: 1`; seccomp mode `2`.
- Writes to both the image root and repository mount denied.
- External DNS resolution blocked under `--network none`.
- Cgroup memory maximum 536,870,912 bytes.
- Cgroup PID maximum 64.
- Cgroup CPU maximum `100000 100000` (one CPU).
- No host credential environment variables were inherited. The image exposes only its base-image
  `GPG_KEY`, the public Python release-signing key, among environment names matching the probe.

The first real Colima run also exposed that `/var/folders` is not shared into its VM. Docker job
manifests now live temporarily under the repository's ignored `.faultmesh` directory, within the
explicit project mount. The corrected worker run and full fresh investigation both passed.

The final image also independently checks the scan-time source hash before importing target code and
validates replay inputs against the complete declared domain. The unchanged real-model incident
still replayed with a matching fingerprint. A separate locked-down Docker replay using the same
manifest and an intentionally corrected source file returned `HARNESS_ERROR` for the content-hash
mismatch before target import.

## Other checks

- Unit/integration/end-to-end suite: 22 passed, including production Docker command-policy and
  worker evidence-integrity coverage.
- Ruff: passed.
- Strict mypy: passed across 35 source and test files.
- The Docker build context is 151.6 KiB after adding `.dockerignore`; model weights and `.venv` are
  excluded.

## Still unvalidated or not passing

- The llama.cpp **server adapter passed**, and the llama.cpp batch CLI adapter passed through
  `llama-completion`. The interactive `llama-cli` executable itself is not batch-compatible in the
  tested llama.cpp release and is not claimed as validated.
- Only one quantized model, one Apple Silicon host, one Docker/Colima configuration, and the seeded
  example were exercised. This is a functional validation, not a model benchmark.
- The precondition compiler intentionally accepts only integer comparisons, conjunctions, and the
  supported integer-range sentence. Other natural-language preconditions are conservatively marked
  `UNSUPPORTED`; broader natural-language compilation remains unvalidated.
- Dependency-heavy target repositories and custom sandbox images were not exercised.
- Docker Desktop itself was not tested; the passing engine was Docker under Colima.
- The benchmark/ablation claims reserved for Milestone 4 remain unmeasured.

No Milestone 2 agents or consensus behavior were added during this work.
