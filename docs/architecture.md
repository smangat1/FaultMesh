# Milestone 1 architecture specification

## Scope and trust boundaries

Milestone 1 is a single-investigator vertical slice for Python 3.11+ repositories. Static scanning,
model inference, verification, persistence, reproduction, and reporting are separate modules. Source
repositories and generated input are untrusted. Scanning never imports target code. Verification is
the only component allowed to import it and normally runs in a locked-down Docker container.

The current property language is intentionally small. It supports integer inputs, named comparison
preconditions, and four explicit oracles: no exception, result no greater than an argument, result
no less than an argument, and result between two arguments. There is no `eval`, arbitrary generated
Python, or model-supplied shell command.

## Complete data flow

1. `ProjectAnalyzer` walks a bounded set of Python and Markdown files without importing them. It
   parses Python ASTs and records source hashes and structural metadata.
2. `ContextBuilder` selects one function at a time and emits bounded source, signature, docstring,
   and structural context.
3. A configured `InferenceBackend` receives the Scout contract and JSON schema. `InferenceClient`
   validates the response and performs bounded repair attempts. The heuristic backend is a real,
   deterministic test substitute; it is not evidence that llama.cpp works.
4. `SpecificationValidator` rejects references to unknown files, functions, arguments, unsupported
   strategies, unsupported constraints, and ambiguous oracles.
5. `EvidenceStore` creates an investigation and persists entities, hypotheses, revision records, and
   evidence edges. Confidence and verification status are separate fields.
6. The status advances `PROPOSED -> TESTABLE`. `VerificationRunner` serializes a declarative
   manifest and delegates it to a sandbox.
7. Inside the sandbox, `verification.worker` verifies the referenced file still matches its
   scan-time content hash before importing it, constructs allowlisted Hypothesis strategies,
   applies named constraints, and uses `hypothesis.find` to shrink a violating input. Replay inputs
   must independently match the exact declared names, integer types, bounds, and constraints. The
   candidate is rerun to estimate stability.
8. The worker returns structured JSON. FaultMesh records the experiment, logs, exit status, failure
   kind, and normalized fingerprint. No failure yields `TESTED`; harness/environment failures yield
   `INCONCLUSIVE`; unstable failures yield `FLAKY`.
9. A stable violation advances through `TESTED -> REPRODUCED -> VERIFIED`. FaultMesh saves a replay
   manifest and concrete pytest regression test.
10. `ReportComposer` renders only persisted/validated facts into incident JSON and Markdown. Root
    cause remains explicitly suspected unless independently proven.
11. `faultmesh reproduce` reloads the manifest, reruns the concrete counterexample in the selected
    sandbox, compares the failure fingerprint, and records a new experiment.

## Module boundaries and dependency contracts

| Module | Owns | Depends on | Must not do |
|---|---|---|---|
| `analysis` | AST index and bounded context | stdlib, schemas | Import target code |
| `agents` | Scout prompts and orchestration | analysis, inference, schemas | Declare verification |
| `inference` | Backend protocol, llama adapters, validation/repair | schemas | Execute target code |
| `evidence` | SQLite schema, transitions, traversal | schemas | Infer findings |
| `verification` | Spec validation and trusted worker logic | schemas, Hypothesis | Accept arbitrary code |
| `sandbox` | Process/container policy and limits | verification manifest | Interpret a property |
| `reproduction` | fingerprints, replay, pytest artifacts | sandbox, evidence | Claim global minimality |
| `reporting` | deterministic JSON/Markdown | evidence, schemas | Invent facts |
| `cli` | configuration and user control | public service API | Bypass execution consent |

The versioned public Python API is exported from `faultmesh.__init__`: `analyze_repository`,
`reproduce_incident`, `AnalysisOptions`, and the stable schema objects.

## Core schema summary

- `SourceReference`: normalized project-relative path and 1-based line range.
- `FunctionMetadata` / `ProjectIndex`: hashes, signatures, annotations, calls, control structures.
- `HypothesisRecord`: description, evidence, preconditions, expected behavior, violation, origin,
  confidence, independent verification status, experiment IDs, and revision history.
- `PropertySpec`: target function, typed arguments, named constraints, explicit oracle, search budget.
- `ExperimentResult`: outcome classification, counterexample, repeated-run count/rate, fingerprint,
  logs, timing, and environment.
- `Incident`: verified hypothesis, reproduction artifacts, observed/expected behavior, limitations.
- `InferenceMetadata`: backend/model/hardware, latency, token counts, and repair attempts.

The exact machine-readable definitions live in `src/faultmesh/schemas.py` and are included in prompts
through Pydantic's JSON schema.

## Scoped implementation plan

1. Establish schemas, AST analysis, and storage with deterministic unit tests.
2. Add bounded inference adapters and a heuristic backend for reliable integration tests.
3. Validate the declarative property language and implement isolated Hypothesis search.
4. Persist experiments and implement status transitions and stable failure classification.
5. Generate replay, pytest, JSON, and Markdown artifacts.
6. Expose the service through a Typer CLI and validate the deliberately buggy example end to end.

## Biggest engineering risks and mitigations

- **Invalid model oracles:** require explicit source evidence, a closed property language, schema
  validation, and a Skeptic role in Milestone 2. Confidence never implies verification.
- **Executing hostile code:** default to Docker with network off, non-root UID, read-only root, PID,
  memory, CPU, and timeout limits. The local runner is opt-in and loudly labeled unsafe.
- **False bug classification:** distinguish property violation, target exception, harness error,
  environment error, no counterexample, and flaky reproduction. Reports preserve assumptions.
- **Import ambiguity:** execute by source path and qualified function name; reject methods and dynamic
  dispatch for now instead of guessing.
- **Nondeterminism:** persist seeds, manifests, environment metadata, logs, repeated-run statistics,
  and normalized fingerprints.
- **Tiny-model JSON quality:** constrain context, include schema, validate with Pydantic, return terse
  validation feedback, and cap repair retries.
- **Dependency-heavy repositories:** the Docker image contract is configurable; dependency building
  and reusable environments are post-Milestone-1 work.
- **Benchmark overclaiming:** record raw counts/timings only. Real-model and Docker metrics stay
  unreported until those paths run in a controlled benchmark.

## Acceptance tests defining completion

Milestone 1 is complete when automated tests prove all of the following:

1. AST scanning finds functions and structural metadata without importing target modules.
2. Malformed model responses and unsupported/orphaned property references are rejected.
3. Evidence statuses cannot skip required states and revisions/edges remain queryable after reopen.
4. The example's unspecified boundary bug yields a concrete, Hypothesis-shrunk counterexample.
5. The counterexample violates the accepted explicit oracle in every configured confirmation trial.
6. A replay manifest reproduces the same normalized failure fingerprint.
7. The emitted pytest file fails against the buggy example and passes after applying the documented
   one-line correction in a temporary copy.
8. Incident JSON validates against `Incident`; Markdown names evidence, commands, environment,
   repeat rate, suspected cause, limitations, and never labels the suspicion as confirmed cause.
9. CLI analysis refuses host execution without explicit consent when Docker is unavailable.
10. The full end-to-end test is deterministic and works with no model weights or internet access.

