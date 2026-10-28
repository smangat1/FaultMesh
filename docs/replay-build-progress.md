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

Commit Phase 0. Then implement the versioned append-only local store and ingestion tests for
Phase 1, using the proven hook-pair contract and explicit gaps for unmatched or unsupported input.
