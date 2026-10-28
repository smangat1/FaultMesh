# Phase 2 proposal-quality pilot

Split executed: `development`. This bounded pilot does not measure arbitrary Python.

| Budget view | Split | Configuration | Arm | Proposal valid | UNSUPPORTED | Unique adjudicated bugs | False controls | Replay | Calls physical/charged | Evaluations physical/charged |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| equal-search | development | a | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-search | development | a | combined | 5/5 | 0/5 | 0 | 0 | 20 | 0/4 | 0/6428 |
| equal-search | development | a | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-search | development | a | slm-only | 0/4 | 4/4 | 0 | 0 | 0 | 4/4 | 0/0 |
| equal-search | development | ab | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-search | development | ab | combined | 7/7 | 0/7 | 0 | 0 | 20 | 0/4 | 4712/8916 |
| equal-search | development | ab | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-search | development | ab | slm-only | 2/4 | 2/4 | 0 | 0 | 10 | 4/4 | 2488/2488 |
| equal-search | development | abc | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-search | development | abc | combined | 7/7 | 0/7 | 0 | 0 | 20 | 0/6 | 0/8916 |
| equal-search | development | abc | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-search | development | abc | slm-only | 2/6 | 4/6 | 0 | 0 | 10 | 6/6 | 0/2488 |
| equal-search | development | current-main | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 6428/6428 |
| equal-search | development | current-main | combined | 5/5 | 0/5 | 0 | 0 | 20 | 0/4 | 0/6428 |
| equal-search | development | current-main | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 1109/1109 |
| equal-search | development | current-main | slm-only | 0/4 | 4/4 | 0 | 0 | 0 | 4/4 | 0/0 |
| equal-wall-time | development | a | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-wall-time | development | a | combined | 5/5 | 0/5 | 0 | 0 | 20 | 0/4 | 0/6428 |
| equal-wall-time | development | a | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-wall-time | development | a | slm-only | 0/4 | 4/4 | 0 | 0 | 0 | 4/4 | 0/0 |
| equal-wall-time | development | ab | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-wall-time | development | ab | combined | 7/7 | 0/7 | 0 | 0 | 20 | 0/4 | 4712/8916 |
| equal-wall-time | development | ab | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-wall-time | development | ab | slm-only | 2/4 | 2/4 | 0 | 0 | 10 | 4/4 | 2488/2488 |
| equal-wall-time | development | abc | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 0/6428 |
| equal-wall-time | development | abc | combined | 7/7 | 0/7 | 0 | 0 | 20 | 0/6 | 0/8916 |
| equal-wall-time | development | abc | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 0/1109 |
| equal-wall-time | development | abc | slm-only | 2/6 | 4/6 | 0 | 0 | 10 | 6/6 | 0/2488 |
| equal-wall-time | development | current-main | baseline-only | 5/5 | 0/5 | 0 | 0 | 20 | 0/0 | 6428/6428 |
| equal-wall-time | development | current-main | combined | 5/5 | 0/5 | 0 | 0 | 20 | 0/4 | 0/6428 |
| equal-wall-time | development | current-main | heuristic-ablation | 1/1 | 0/1 | 0 | 0 | 5 | 0/0 | 1109/1109 |
| equal-wall-time | development | current-main | slm-only | 0/4 | 4/4 | 0 | 0 | 0 | 4/4 | 0/0 |

## Interpretation limits

- Development and held-out records remain separate.
- Verified violations pending independent review are not adjudicated bugs.
- The equal-wall-time view reuses the same bounded runs and charges cached inference; it is not another sample.
- Missing token and memory telemetry is recorded as null, not estimated.
