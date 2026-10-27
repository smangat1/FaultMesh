# Phase 2 locked corpus and adjudication

The versioned lock is `phase-2-pilot.lock.toml`. It freezes four development and eight held-out
buggy/corrected pairs before proposal tuning. Development reuses the phase 1 acceptance patterns;
held-out contains four synthetic pairs and four adaptations of documented MIT-licensed fixes.

The benchmark runner must copy exactly one source variant to a new neutral temporary root. It must
not copy this document, the lock, the sibling variant, or anything under `phase2_corpus/private`.
The private file contains an isolation canary and expected-oracle/adjudication data. Proposal code
and selection code may not read it; only post-execution aggregation may.

Historical adaptation is deliberately narrow and recorded per case in the lock. The original
repository, pre-fix commit, fix commit, license, and path are explicit. The adapted docstring/type
surface makes each function fit the already closed DSL; no hidden evaluator assertion is added to
Scout context.

Synthetic cases are author-reviewed fixtures, not blinded independent ground truth. Their
adjudication state is `pending_independent_review`, so a stable buggy-only violation may be reported
as a verified violation but is not counted as an independently adjudicated unique bug. Historical
cases marked `confirmed_source_fix` may count only when the proposed property is contract-grounded,
fails the buggy adaptation, passes its corrected control, and replays with a stable fingerprint.

The total model-call budget is two calls per target/configuration: the initial generation plus at
most one JSON repair or semantic-feedback retry. `max_repairs = 2` is only a ceiling; it cannot
override the total-call limit. Inference has a separate 120-second per-call timeout, verification a
30-second per-run timeout, and the equal-wall-time view admits at most 300 seconds per target/arm.
The five paired seeds repeat search, not model sampling; temperature-zero proposal output is cached
and identified rather than regenerated for every seed.
