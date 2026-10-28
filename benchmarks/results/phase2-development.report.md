# Phase 2 proposal-quality pilot

Split executed: `development`. This bounded pilot does not measure arbitrary Python.

| Budget view | Split | Configuration | Arm | Proposal valid | UNSUPPORTED | Bugs | Increment vs baseline (95% paired bootstrap) | False controls | Replay | Calls physical/charged | Evaluations physical/charged | Median ms |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| equal-search | development | a | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-search | development | a | combined | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 0/6428 | 23095.8 |
| equal-search | development | a | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-search | development | a | slm-only | 0/4 | 4/4 | 0 | 0 (0.00, 0.00) | 0 | 0 | 4/4 | 0/0 | 22188.9 |
| equal-search | development | ab | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-search | development | ab | combined | 7/7 | 0/7 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 4712/8916 | 27706.4 |
| equal-search | development | ab | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-search | development | ab | slm-only | 2/4 | 2/4 | 0 | 0 (0.00, 0.00) | 0 | 10 | 4/4 | 2488/2488 | 26926.8 |
| equal-search | development | abc | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-search | development | abc | combined | 7/7 | 0/7 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/6 | 0/8916 | 35159.2 |
| equal-search | development | abc | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-search | development | abc | slm-only | 2/6 | 4/6 | 0 | 0 (0.00, 0.00) | 0 | 10 | 6/6 | 0/2488 | 34539.0 |
| equal-search | development | current-main | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 6428/6428 | 984.3 |
| equal-search | development | current-main | combined | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 0/6428 | 26254.3 |
| equal-search | development | current-main | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 1109/1109 | 0.0 |
| equal-search | development | current-main | slm-only | 0/4 | 4/4 | 0 | 0 (0.00, 0.00) | 0 | 0 | 4/4 | 0/0 | 25032.6 |
| equal-wall-time | development | a | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-wall-time | development | a | combined | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 0/6428 | 23095.8 |
| equal-wall-time | development | a | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-wall-time | development | a | slm-only | 0/4 | 4/4 | 0 | 0 (0.00, 0.00) | 0 | 0 | 4/4 | 0/0 | 22188.9 |
| equal-wall-time | development | ab | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-wall-time | development | ab | combined | 7/7 | 0/7 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 4712/8916 | 27706.4 |
| equal-wall-time | development | ab | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-wall-time | development | ab | slm-only | 2/4 | 2/4 | 0 | 0 (0.00, 0.00) | 0 | 10 | 4/4 | 2488/2488 | 26926.8 |
| equal-wall-time | development | abc | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 0/6428 | 984.3 |
| equal-wall-time | development | abc | combined | 7/7 | 0/7 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/6 | 0/8916 | 35159.2 |
| equal-wall-time | development | abc | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 0/1109 | 0.0 |
| equal-wall-time | development | abc | slm-only | 2/6 | 4/6 | 0 | 0 (0.00, 0.00) | 0 | 10 | 6/6 | 0/2488 | 34539.0 |
| equal-wall-time | development | current-main | baseline-only | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/0 | 6428/6428 | 984.3 |
| equal-wall-time | development | current-main | combined | 5/5 | 0/5 | 0 | 0 (0.00, 0.00) | 0 | 20 | 0/4 | 0/6428 | 26254.3 |
| equal-wall-time | development | current-main | heuristic-ablation | 1/1 | 0/1 | 0 | 0 (0.00, 0.00) | 0 | 5 | 0/0 | 1109/1109 | 0.0 |
| equal-wall-time | development | current-main | slm-only | 0/4 | 4/4 | 0 | 0 (0.00, 0.00) | 0 | 0 | 4/4 | 0/0 | 25032.6 |

## Interpretation limits

- Development and held-out records remain separate.
- Verified violations pending independent review are not adjudicated bugs.
- The equal-wall-time view reuses the same bounded runs and charges cached inference; it is not another sample.
- Missing token and memory telemetry is recorded as null, not estimated.
- Timeout, harness, environment, model-error, flaky, miss, pending-adjudication, and duplicate counts remain separate in the JSON aggregate.
