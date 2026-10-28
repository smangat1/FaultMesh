# Replay evaluation

## Frozen protocol before implementation

Evaluation protocol 1.0 was written before narration prompts or claim-checker behavior were
tuned. The frozen inputs are under `benchmarks/replay/`:

- `protocol-v1.json`: proposed comparisons, metrics and go/no-go gates;
- `label-rubric-v1.json`: independent human-label definitions;
- `split-manifest-v1.json`: whole-run split and reserved held-out run IDs;
- `metrics-v1.py`: canonical deduplication, one-to-one coverage and undefined-zero precision.

These exact frozen files and their lock are also embedded under
`faultmesh/replay/evaluation_assets/` in built wheels. `replay-evaluate` resolves package resources
when installed, so it does not depend on a source checkout or current working directory.

Only the two existing sanitized capture fixtures are development data. The held-out reservations
contain no recordings or labels. They must not be silently populated from development failures or
reassigned after tuning.

## Current status

Status: **PRELIMINARY/UNVALIDATED**.

Implemented measurements, actual local-model results and human judgments will be recorded here in
Phase 4B. Until real held-out runs and independent human labels exist, the final evaluation gate is
pending. Synthetic checker tests can prove deterministic behavior on their cases; they cannot
establish natural SLM quality, usefulness or universal soundness.

## Implemented offline comparison

`faultmesh replay-evaluate observations.json --out report.json` validates the frozen protocol lock,
requires identical packet order/split/context/output budgets within each comparison group, and
writes a schema-checked report. It reports numerator, denominator and sample count; deduplicates
canonical facts for one-to-one coverage; keeps first/repaired and natural/injected strata separate;
and reports zero-accepted precision as undefined (`null`).

The committed development-only synthetic oracle result is
`benchmarks/replay/preliminary-synthetic-report-v1.json`:

| Arm | True/checkable | Accepted/generated | True accepted/accepted | Coverage | False accepted | False contradicted | False unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Deterministic template | 1/1 | 1/1 | 1/1 | 1/1 | 0 | 0 | 0 |
| Injected raw output | 1/3 | 3/3 | 1/3 | 1/1 | 2 | 0 | 0 |
| Injected output + checker | 1/3 | 1/3 | 1/1 | 1/1 | 0 | 1 | 1 |

These are three supplied synthetic observations for metric/checker validation, not natural model
results. No model ran, no human reviewed labels, and no held-out sample was opened. All six frozen
gates remain pending. The decision is **NO-GO: experimental/default-off**.
