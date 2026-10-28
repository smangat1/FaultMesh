# Replay build progress

## Reference point

- Branch: `replay-capture-foundation`
- Fresh `origin/main` base and revert/reference SHA:
  `a2b406aeee9471b6afea45cfd73ed07f4c095906`
- This SHA is a reference only. The implementation must not reset or merge automatically.

## Phase 0 — capture boundary

Status: complete; exact tool-boundary capture proven on 2026-10-28.

Acceptance:

- Installed version: `codex-cli 0.165.0-alpha.1.2`.
- Version-matched source: tag `rust-v0.165.0-alpha.1.2`, commit
  `720fec862a608ae1e5878d1eecb04fb93192e93c`.
- `python scripts/replay_capture_probe.py probe`: passed against a new synthetic local session.
- Observed one initial snapshot, one complete `apply_patch` boundary and seven complete `Bash`
  boundaries. Function edit, shell edit, create/rename/delete, failing/pass pytest and final rapid
  write state were present.
- Rapid intermediate writes inside one Bash call were not recoverable. The supported granularity
  is exact pre/post tool bytes, not individual filesystem writes.
- Full boundary, attribution and unsupported-case report:
  `docs/replay-capture-boundary.md`.
- `ruff check scripts/replay_capture_probe.py`: passed.
- `python -m py_compile scripts/replay_capture_probe.py`: passed.

## Next step

Phase 0 commit: `3a252369cd3942f5233625673fb68b1626a0c57d`.

## Phase 1 — durable local recording

Status: complete.

Implemented:

- strict `replay-capture-1.0` and `replay-store-1.0` contracts;
- explicit start/hook/stop/list/ingest/delete CLI lifecycle for one selected root;
- immutable content-addressed exact bytes and append-only SQLite records/manifests;
- monotonic session sequence plus source identity/offset/sequence distinctions;
- idempotent restart-safe NDJSON ingestion, partial-tail tolerance and rotation/truncation gaps;
- strict schema rejection and visible unknown/corrupt/gap records;
- bounded UTF-8 Python capture, secret/build/model/artifact/symlink/binary exclusions;
- best-effort bounded pre-persistence redaction and explicit raw logging opt-in;
- exact initial and tool-boundary manifests, with unmatched attribution left unknown;
- non-executing Python structure reuse and explicit stale last-good facts after invalid syntax;
- bounded object storage, corruption checks, atomic durable object writes and whole-session deletion;
- sanitized frozen JSON/NDJSON fixtures under `tests/fixtures/replay/`.

Acceptance commands:

- `ruff check src/faultmesh/replay src/faultmesh/cli/app.py tests/unit/test_replay_capture.py
  tests/unit/test_replay_store.py tests/unit/test_replay_privacy.py`: passed.
- `mypy`: passed for all configured packages after the editable environment was pointed at this
  worktree (53 source files).
- `PYTHONPATH=src python -m pytest tests/unit/test_replay_capture.py
  tests/unit/test_replay_store.py tests/unit/test_replay_privacy.py -q`: 17 passed.
- The same new tests plus spectate engine/models/relationships and structure index/Git-safety
  regressions: 42 passed.

Known boundary:

- intermediate writes inside one tool invocation remain unsupported;
- no concurrent-writer guarantee beyond stable-read checks and explicit unknown attribution;
- only the tested Codex adapter and bounded UTF-8 Python source are supported;
- pattern redaction is best effort and redacted/truncated text cannot verify missing content.

## Next step

Phase 1 commit: `4a45e500ab62f21c24604d10ada7bae2cb02f795`.

## Phase 2 — no-model replay and tests around changes

Status: complete; Phase 2 is the current branch-head commit.

Implemented:

- ordered timeline and checkpoint selection from stored records only;
- exact before/after source, unified diffs and non-executing changed Python symbols;
- explicit unverified symbol state for syntax-error snapshots;
- prompt/tool evidence markers without treating redacted text as verification;
- separate structured test states/scope/node IDs/counts and command-only observations;
- content-identity and validated no-write associations, plus nearby-unverified semantics;
- strict `replay-export-1.0` with all historical content-addressed bytes;
- export hash/size verification and read-only selection with no store or checkout;
- machine-readable capture/export schema commands;
- disposable no-model demo that deletes its checkout before playback;
- internal store v1-to-v2 migration that adds test evidence without rewriting replay records;
- format and privacy/retention/usage documentation.

Acceptance commands:

- Targeted ruff for replay, CLI and four new replay test modules: passed.
- `mypy`: passed for all configured packages.
- Four new replay test modules: 23 passed.
- New replay tests plus the specified spectate, project replay/evidence and structure regressions:
  61 passed.
- `PYTHONPATH=src python -m faultmesh.cli.app replay-demo`: passed; earlier/later source was
  reconstructed after the disposable checkout was deleted, with `model_used: false`.
- Final CI `ruff check .`: passed.
- Final CI `mypy`: passed for 53 source files.
- Final CI `PYTHONPATH=src python -m pytest -m 'not container' --cov=faultmesh
  --cov-report=term-missing`: 179 passed, 5 container tests deselected, total coverage 85%.

The end-to-end view test ingests the committed NDJSON fixture, mutates and deletes the original
checkout, then selects the earlier and later stored states byte-for-byte.

Known gaps:

- No supported structured parser is supplied for arbitrary pytest text; command-only counts remain
  null and states remain `not_observed` or `incomplete`.
- Intermediate filesystem writes inside one tool call and arbitrary concurrent-writer attribution
  remain unsupported.
- No UI files changed in this scope, so UI tests/build are not required.

## Next step

Push the reviewed branch and open one draft PR against `main`. Stop with the PR unmerged. Prompt B
can consume `replay-export-1.0` only after review accepts this capture and replay foundation.
