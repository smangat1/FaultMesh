# Benchmarks

The Milestone 1 end-to-end fixture under `examples/buggy_python_project` is an acceptance test, not
evidence of comparative performance.

The bounded phase 2 proposal-quality pilot is implemented by `faultmesh benchmark phase2-pilot`.
The corpus and budgets are locked in `phase-2-pilot.lock.toml`; prompt-generating file hashes are
frozen in `phase2-prompt-lock.json`. The concise result and exact commands are in
[`phase2-report.md`](phase2-report.md), with schema-validated raw records and aggregates under
[`results/`](results/).

The preregistration rules remain in [`phase-2-design.md`](phase-2-design.md). Development and
held-out results are separate, invalidated development evidence is preserved, synthetic cases
without independent adjudication are not counted as confirmed bugs, and missing telemetry is
`null` rather than estimated.

