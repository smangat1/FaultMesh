# Phase 2: contract-grounded local-model proposal pilot

This is a bounded result for 12 small, pure, synchronous top-level functions covered by
FaultMesh's closed `int`/`str`/`list[int]` property DSL. It is not evidence that FaultMesh checks
arbitrary Python.

## Result

The proposal ladder improved the local model's semantic support rate, but it did not add a unique
held-out bug beyond the transparent documented-contract baseline.

- `current-main` and A produced zero supported SLM proposals on all eight held-out targets.
- A+B produced an executable proposal on 6/8 held-out targets. Six of seven syntactically valid
  proposed properties were semantically supported; two targets ended in bounded model-output
  errors after both allowed calls.
- A+B+C used one additional semantic retry where available but retained the same 6/8 target
  coverage, the same 6/7 supported-property rate, and the same two historically confirmed bugs.
  It therefore showed no incremental gain over A+B in this pilot.
- The transparent baseline produced 11/11 supported properties across 8/8 targets and found three
  historically confirmed bugs. The A+B and A+B+C SLM arms found two of those same three. Combined
  found the baseline's same three, for zero incremental unique bugs.
- No arm produced a property that failed on a corrected control. The narrow old upper-bound
  heuristic found no held-out bug.

Held-out equal-search results are below. The equal-wall-time view has the same outcomes because no
charged comparison reached the frozen 300-second cap. Calls and evaluations are logically charged;
physical reuse is separately recorded in the aggregate and raw records.

| Configuration | Arm | Syntax-valid model calls | Supported properties | Targets with executable proposal | Confirmed bugs | Incremental unique over baseline | False controls | Replay successes | Charged calls | Charged evaluations | Median charged ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| current-main | SLM | 8/8 | 0/8 | 0/8 | 0 | 0 | 0 | 0 | 8 | 0 | 26,875.5 |
| current-main | baseline | n/a | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 0 | 14,260 | 1,119.4 |
| current-main | combined | 8/8 | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 8 | 14,260 | 28,260.7 |
| A | SLM | 8/8 | 0/8 | 0/8 | 0 | 0 | 0 | 0 | 8 | 0 | 23,936.0 |
| A | baseline | n/a | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 0 | 14,260 | 1,119.4 |
| A | combined | 8/8 | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 8 | 14,260 | 25,153.6 |
| A+B | SLM | 6/10 | 6/7 | 6/8 | 2 | 0 | 0 | 25 | 10 | 7,791 | 32,900.5 |
| A+B | baseline | n/a | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 0 | 14,260 | 1,119.4 |
| A+B | combined | 6/10 | 17/17 | 8/8 | 3 | 0 | 0 | 35 | 10 | 22,051 | 32,220.3 |
| A+B+C | SLM | 7/11 | 6/7 | 6/8 | 2 | 0 | 0 | 25 | 11 | 7,791 | 32,021.4 |
| A+B+C | baseline | n/a | 11/11 | 8/8 | 3 | 0 | 0 | 35 | 0 | 14,260 | 1,119.4 |
| A+B+C | combined | 7/11 | 17/17 | 8/8 | 3 | 0 | 0 | 35 | 11 | 22,051 | 31,954.4 |
| all | old heuristic ablation | n/a | 0/0 | 0/8 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 |

The paired bug-level bootstrap interval for the held-out SLM-minus-baseline discovery-rate
difference was `[-0.75, -0.125]` for current-main and A, and `[-0.375, 0.0]` for A+B and A+B+C.
Combined-minus-baseline was `[0.0, 0.0]`. These descriptive intervals resample only eight bug
pairs and are not stable population estimates. The five search seeds are repeated searches, not
independent model samples.

## Findings and failure modes

The transparent baseline found the historical Roman-empty, merge-sort, and heap-sort defects. The
SLM with few-shots found merge-sort and heap-sort; these were not incremental. The historical
comb-sort pair was a miss under the frozen domains and budgets.

Four synthetic held-out violations remain `pending_adjudication` and are not counted as confirmed
bugs. The baseline found all four; A+B/A+B+C SLM found three. No builder review is described as an
independent review.

The remaining model failures were semantic or bounded environment/model outcomes rather than
verifier weakening:

- current-main and A emitted schema-valid but semantically unsupported properties on every held-out
  target;
- A+B and A+B+C each had two target-level model errors where the 2,048-token output ended with
  incomplete JSON after the one permitted repair call;
- A+B had one semantically unsupported property among seven validated proposals;
- A+B+C made one exact raw-property duplicate across its initial/retry trace and did not search it
  twice;
- token and memory telemetry were unavailable and remain `null`; they were not estimated.

Development run 1 was invalidated before any held-out exposure because strategy discriminators
were not required in the specialized model-facing schema and charged reuse was absent from the
aggregate. Its raw output and invalidation record are preserved. Development run 2 froze the
prompt/configuration hashes. No proposal code changed before the single held-out run.

## Reproduction

The locked model is Qwen2.5-Coder-1.5B-Instruct Q4_K_M, SHA-256
`cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046`, using
`llama-completion` 0.7.0 build 11669 (`620d2225c`) at temperature 0, 8,192 context, and 2,048 output
tokens. Target code ran only in locked image `faultmesh-sandbox:0.1.0`, image ID
`sha256:57e6feb9c91db0a36510f75e4b181ebdea9cb387837a3df2e2cee89b6562cbe0`.

Run development first, freeze `benchmarks/phase2-prompt-lock.json`, then run held-out once:

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
  --split development \
  --model-path /absolute/path/to/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf \
  --raw-out .faultmesh/benchmarks/phase-2-development.ndjson

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
  --split heldout \
  --model-path /absolute/path/to/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf \
  --raw-out .faultmesh/benchmarks/phase-2-heldout.ndjson
```

Machine-readable artifacts:

- `benchmarks/results/phase2-development.ndjson` and `.summary.json`
- `benchmarks/results/phase2-heldout.ndjson` and `.summary.json`
- `benchmarks/results/development-run-1-invalidated.ndjson.gz` and its invalidation record

The next decision is whether the zero incremental held-out gain justifies more work on this 1.5B
model. Larger models and fine-tuning remain separate user decisions.
