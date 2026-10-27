# Phase 2 preregistered pilot design (not yet run)

Phase 2 will test a limited population of small, pure, synchronous top-level Python functions whose
contracts and inputs fit FaultMesh's closed integer/text/`list[int]` DSL. It will not estimate
effectiveness for arbitrary Python projects, methods, stateful systems, async code, nested objects,
or dependency-heavy applications. This document is a design; it contains no measurements.

## Corpus and split frozen before tuning

The pilot will contain 12 buggy/corrected pairs: four development pairs and eight held-out pairs.
The split, defect identity, supported target, oracle family, and budgets will be frozen before prompt
or baseline tuning. The corpus will mix clearly labeled synthetic defects with sourced historical
bugs. Each historical item must record repository URL, source and fix commits, license, original
path, extraction notes, and whether adaptation changed semantics. Synthetic items must record their
generator/author and contract. Corrected implementations, evaluator assertions, defect labels, and
held-out adjudication notes stay outside model context and proposal selection.

Every pair is evaluated under the buggy and corrected variant's own freshly indexed source identity.
A real finding must fail on the buggy variant, pass on its corrected control, reproduce with a stable
fingerprint, and survive independent contract/ground-truth adjudication. One defect has one stable
`bug_id`; multiple properties, seeds, or arms finding it do not increase the bug count.

## Arms and budgets

Three primary arms use the same closed DSL and verifier:

1. **SLM-only**: the fixed local model/settings/prompt propose properties.
2. **baseline-only**: a transparent non-SLM proposer enumerates documented contracts without model
   inference.
3. **combined**: the union of SLM and transparent-baseline proposals, deduplicated before search.

The current deterministic upper-bound heuristic is reported separately as a narrow ablation, not as
the transparent baseline and not folded into baseline-only results.

Each target/arm receives the same maximum number of validated properties, Hypothesis examples,
confirmation runs, replay attempts, and verifier timeout. Seeds are paired across arms. At least five
paired search seeds are used (preregistered pilot seeds: `11, 23, 37, 53, 71`). The model,
quantization, llama.cpp commit, temperature, context size, prompt template, maximum calls, token cap
where reported by the backend, and repair cap are fixed before held-out execution. Repeating a
temperature-zero model output is not treated as an independent model sample.

Equal search budgets are not called equal compute. A separate equal end-to-end wall-time comparison
charges inference, validation/repair, search, confirmation, and replay. Both comparisons report
actual generated examples/evaluations, model calls, repair calls, timeouts, elapsed time, and unused
budget. Missing token or memory telemetry remains `null`; it is never estimated.

## Outcomes and reporting

Independent adjudication classifies every target/arm result into real bug findings, false properties
on corrected controls, invalid proposals, unsupported targets, harness/environment failures,
timeouts, misses, duplicate findings, flaky/inconclusive outcomes, and successful replays. Reports
include counts and denominators, incremental unique bugs over baseline, paired uncertainty intervals,
latency distributions, actual model calls/tokens where available, and hardware/model/quantization/
llama.cpp/FaultMesh commit metadata. Zero findings is valid and must be published unchanged.

## Machine-readable raw-run record

Phase 2 will implement newline-delimited JSON records with a versioned schema. Each attempt record
will include at least:

```json
{
  "schema_version": "phase2-pilot-1.0",
  "run_id": "opaque",
  "bug_id": "stable-corpus-id",
  "variant": "buggy-or-corrected",
  "split": "development-or-held-out",
  "provenance": {"kind": "synthetic-or-historical", "license": null, "source_commit": null},
  "arm": "slm-only-or-baseline-only-or-combined-or-heuristic-ablation",
  "paired_seed": 11,
  "budgets": {"properties": 4, "examples_per_property": 200, "model_calls": 2, "repairs": 2, "timeout_seconds": 30},
  "actual": {"properties": 0, "examples": 0, "evaluations": 0, "model_calls": 0, "repairs": 0, "timeouts": 0, "unused_examples": 0},
  "classification": "unmeasured",
  "unique_bug_found": false,
  "replay": null,
  "timing_ms": {"inference": null, "verification": null, "end_to_end": null},
  "tokens": {"prompt": null, "completion": null},
  "runtime": {"model": null, "quantization": null, "hardware": null, "llama_cpp_commit": null, "faultmesh_commit": null}
}
```

The zeroes and `null` values above describe field types only; they are not pilot measurements.

## Exact bounded command to implement in phase 2

The phase 2 harness will implement this command shape and reject missing corpus locks or output paths:

```console
faultmesh benchmark phase2-pilot \
  --manifest benchmarks/phase-2-pilot.lock.toml \
  --arms slm-only,baseline-only,combined,heuristic-ablation \
  --seeds 11,23,37,53,71 \
  --max-properties 4 \
  --max-examples 200 \
  --confirmation-runs 3 \
  --max-model-calls 2 \
  --max-repairs 2 \
  --timeout-seconds 30 \
  --raw-out .faultmesh/benchmarks/phase-2-pilot.ndjson
```

That command does not exist in phase 1 and is not run here. Phase 2 must add the locked manifest,
transparent proposer, raw schema, adjudication workflow, and aggregation before producing any
comparative claim.
