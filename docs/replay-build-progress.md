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

Status: complete; commit pending.

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
- `mypy`: passed for all configured packages.
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

Commit Phase 1. Then add Phase 2 read-only timeline/checkpoint/diff/test views and deterministic
offline export playback using only stored identities and bytes.
