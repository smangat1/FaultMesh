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

## Prompt B reference point

- Branch: `replay-checked-narration`
- Fresh `origin/main` base and revert/reference SHA:
  `131a48bcb6fafdd4523df08427aabf3430b82819`
- The base is merged Prompt A PR #18 and contains all Phase 0-2 commits.
- Evaluation protocol, rubric, split manifest and metric rules were frozen and SHA-256 locked under
  `benchmarks/replay/` before narration prompt or checker tuning. Held-out reservations are empty,
  so final evaluation remains pending.

## Phase 3A — typed claims and three-way checker

Status: complete.

Implemented:

- bounded immutable evidence packets built only from verified `replay-export-1.0` bytes;
- atomic typed predicates for file changes, Python function additions/removals, command exits and
  exact structured pytest counts;
- explicit function identity by project-relative path plus AST qualified name, with no inferred
  rename;
- `supported`, `contradicted` and `unsupported_or_unknown` verdicts with checker version, reason
  code and evidence references;
- packet, source session/step, evidence type, hash and completeness checks;
- deterministic no-model templates and bounded local-model selection with one repair attempt;
- separate preservation of first raw output, parsed first claims, repaired output, parsed repaired
  claims and final verdicts;
- cache identity over evidence, model config, prompt, schema and checker versions;
- invalid, unavailable or adversarial model output falls back without executing captured text.

Acceptance commands:

- Targeted ruff for the checker, checker tests and frozen metric rules: passed.
- `mypy`: passed for 54 source files.
- Checker plus replay store/view/privacy and legacy inference tests: 30 passed.
- Checker tests cover exact support, complete contradiction, wrong paths/names/hashes/counts,
  deleted functions, stale ASTs, partial reports, mismatched packet/source step, fabricated refs,
  invalid JSON and adversarial captured instructions.

## Next step

Phase 3A commit is the next coherent commit. Continue with evidence-linked inference and summary
audit; a valid citation must never upgrade model inference into verified intent.

Phase 3A commit: `c1189b0883ebd7445a5ab2428de390d29d408c79`.

## Phase 3B — evidence-linked reasons and agent-summary audit

Status: complete.

Implemented:

- local citation sources scoped to one replay session and bounded current/prior sequences;
- documented NFC/LF normalization with exact character offsets and quote matching;
- rejection of missing, wrong-session, future, current-non-prompt, redacted, truncated, altered or
  out-of-bounds references;
- permanent `likely reason (model inference)` labeling even when every quote is exact;
- explicit separation of citation integrity from unassessed entailment and unverified intent;
- exact-span agent-summary auditing through the Phase 3A typed-claim checker;
- only supported atomic predicates are extracted as facts; contradictions require complete
  contrary evidence and other statements remain “not supported by this recording.”

Acceptance commands:

- Targeted ruff and mypy for citation/audit code and tests: passed.
- Citation/audit tests: 5 passed.
- Cases cover quote forgery, altered quote, redaction, wrong session, future/current event,
  irrelevant-but-real quote, empty references, exact-span acceptance and summary false positives.

## Next step

Commit the Phase 3B boundary, then add deterministic and model-proposed chapters, independent local
model jobs and the backwards-compatible enriched export.

Phase 3B commit: `71f312671e375fbab4f29bfa1c611c8ed0d36f04`.

## Phase 4A — chapters and swappable local models

Status: complete; local-model quality remains unmeasured.

Implemented:

- always-available prompt-turn chapters with documented fixed-size grouping when turn IDs are
  absent;
- strict validation of model-proposed contiguous ranges, bounds, stable IDs, full coverage and real
  record links, with titles labeled `model interpretation`;
- honest empty, long and invalid-output fallbacks;
- one-worker local narration queue that cancels pending requests and discards stale results;
- bounded llama.cpp CLI and loopback-server configuration with 1.5B/3B/7B-class resource presets;
- explicit-root GGUF inventory and hashing with no download or model loading;
- `replay-export-2.0` containing v1 evidence plus packets, checked narration, reasons, audits,
  baseline chapters and selected chapters; v1 remains loadable;
- `replay-narrate`, `replay-model-inventory` and machine-readable narration/claim/chapter schemas;
- sanitized valid/unknown/contradicted/inference/timeout examples for Prompt C.

Local inventory on 2026-10-28:

- hardware reports 8,589,934,592 bytes RAM (8 GiB);
- no local `*.gguf` file was found in the inspected user area;
- neither `llama-cli` nor `llama-server` was on `PATH`;
- therefore no model was downloaded, loaded or benchmarked, and no 1.5B/3B/7B quality or fit claim
  is made.

Acceptance commands:

- Targeted ruff for CLI, backends, chapters, narration and tests: passed.
- `mypy`: passed for 57 source files.
- Chapters/narration plus checker, citations, replay store/view/privacy and legacy inference tests:
  42 passed.
- CLI no-model export, schema generation, v1/v2 round-trip, chapter fallback, stale job cancellation
  and explicit-root inventory are covered.

## Next step

Commit Phase 4A, then implement the frozen offline comparison/report command and record only actual
synthetic measurements plus the pending held-out/human/model/M2 gates.
