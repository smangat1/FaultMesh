# Replay evaluation

## Frozen protocol before implementation

Evaluation protocol 1.0 was written before narration prompts or claim-checker behavior were
tuned. The frozen inputs are under `benchmarks/replay/`:

- `protocol-v1.json`: proposed comparisons, metrics and go/no-go gates;
- `label-rubric-v1.json`: independent human-label definitions;
- `split-manifest-v1.json`: whole-run split and reserved held-out run IDs;
- `metrics-v1.py`: canonical deduplication, one-to-one coverage and undefined-zero precision.

Only the two existing sanitized capture fixtures are development data. The held-out reservations
contain no recordings or labels. They must not be silently populated from development failures or
reassigned after tuning.

## Current status

Status: **PRELIMINARY/UNVALIDATED**.

Implemented measurements, actual local-model results and human judgments will be recorded here in
Phase 4B. Until real held-out runs and independent human labels exist, the final evaluation gate is
pending. Synthetic checker tests can prove deterministic behavior on their cases; they cannot
establish natural SLM quality, usefulness or universal soundness.
