# Phase 2 proposal-quality pilot

Split executed: `heldout`. This bounded pilot does not measure arbitrary Python.

| Budget view | Split | Configuration | Arm | Proposal valid | UNSUPPORTED | Bugs | Increment vs baseline (95% paired bootstrap) | False controls | Replay | Calls physical/charged | Evaluations physical/charged | Median ms |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| equal-search | heldout | a | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-search | heldout | a | combined | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/8 | 0/14260 | 25153.6 |
| equal-search | heldout | a | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-search | heldout | a | slm-only | 0/8 | 8/8 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 8/8 | 0/0 | 23936.0 |
| equal-search | heldout | ab | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-search | heldout | ab | combined | 17/17 | 0/17 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/10 | 19368/22051 | 32220.3 |
| equal-search | heldout | ab | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-search | heldout | ab | slm-only | 6/7 | 1/7 | 2 | 0 (-0.38, 0.00) | 0 | 25 | 10/10 | 7791/7791 | 32900.5 |
| equal-search | heldout | abc | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-search | heldout | abc | combined | 17/17 | 0/17 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/11 | 0/22051 | 31954.4 |
| equal-search | heldout | abc | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-search | heldout | abc | slm-only | 6/7 | 1/7 | 2 | 0 (-0.38, 0.00) | 0 | 25 | 11/11 | 0/7791 | 32021.4 |
| equal-search | heldout | current-main | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 14260/14260 | 1119.4 |
| equal-search | heldout | current-main | combined | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/8 | 0/14260 | 28260.7 |
| equal-search | heldout | current-main | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-search | heldout | current-main | slm-only | 0/8 | 8/8 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 8/8 | 0/0 | 26875.5 |
| equal-wall-time | heldout | a | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-wall-time | heldout | a | combined | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/8 | 0/14260 | 25153.6 |
| equal-wall-time | heldout | a | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-wall-time | heldout | a | slm-only | 0/8 | 8/8 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 8/8 | 0/0 | 23936.0 |
| equal-wall-time | heldout | ab | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-wall-time | heldout | ab | combined | 17/17 | 0/17 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/10 | 19368/22051 | 32220.3 |
| equal-wall-time | heldout | ab | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-wall-time | heldout | ab | slm-only | 6/7 | 1/7 | 2 | 0 (-0.38, 0.00) | 0 | 25 | 10/10 | 7791/7791 | 32900.5 |
| equal-wall-time | heldout | abc | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 0/14260 | 1119.4 |
| equal-wall-time | heldout | abc | combined | 17/17 | 0/17 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/11 | 0/22051 | 31954.4 |
| equal-wall-time | heldout | abc | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-wall-time | heldout | abc | slm-only | 6/7 | 1/7 | 2 | 0 (-0.38, 0.00) | 0 | 25 | 11/11 | 0/7791 | 32021.4 |
| equal-wall-time | heldout | current-main | baseline-only | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/0 | 14260/14260 | 1119.4 |
| equal-wall-time | heldout | current-main | combined | 11/11 | 0/11 | 3 | 0 (0.00, 0.00) | 0 | 35 | 0/8 | 0/14260 | 28260.7 |
| equal-wall-time | heldout | current-main | heuristic-ablation | 0/0 | 0/0 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 0/0 | 0/0 | 0.0 |
| equal-wall-time | heldout | current-main | slm-only | 0/8 | 8/8 | 0 | 0 (-0.75, -0.12) | 0 | 0 | 8/8 | 0/0 | 26875.5 |

## Interpretation limits

- Development and held-out records remain separate.
- Verified violations pending independent review are not adjudicated bugs.
- The equal-wall-time view reuses the same bounded runs and charges cached inference; it is not another sample.
- Missing token and memory telemetry is recorded as null, not estimated.
- Timeout, harness, environment, model-error, flaky, miss, pending-adjudication, and duplicate counts remain separate in the JSON aggregate.
