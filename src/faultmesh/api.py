"""Public orchestration API for the Milestone 1 vertical slice."""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field
from pathlib import Path

from faultmesh.agents import ProposalConfiguration, ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.config import FaultMeshConfig
from faultmesh.evidence import EvidenceStore
from faultmesh.inference import (
    HeuristicBackend,
    InferenceBackend,
    InferenceClient,
    LlamaCppCliBackend,
    LlamaCppServerBackend,
)
from faultmesh.proposal_quality import ProposalGenerator, canonical_property_key
from faultmesh.reproduction import ArtifactWriter
from faultmesh.sandbox import DockerSandbox, LocalSubprocessSandbox, SandboxRunner
from faultmesh.schemas import (
    ExperimentOutcome,
    ExperimentResult,
    HypothesisRecord,
    Incident,
    InferenceMetadata,
    ProjectIndex,
    ProposedHypothesis,
    ReplayManifest,
    VerificationManifest,
    VerificationStatus,
)
from faultmesh.telemetry import log_event


@dataclass(frozen=True)
class AnalysisOptions:
    focus: Path | None = None
    model: str | None = None
    allow_local_execution: bool = False
    llama_endpoint: str | None = None
    llama_model: str | None = None
    llama_cli: str | None = None
    model_path: Path | None = None
    artifact_directory: Path | None = None
    max_functions: int = 50
    proposal_configuration: ProposalConfiguration = ProposalConfiguration.ABC
    max_model_calls: int = 2
    max_repair_attempts: int = 2
    inference_backend: InferenceBackend | None = None


@dataclass(frozen=True)
class AnalysisSummary:
    investigation_id: str
    project_index: ProjectIndex
    hypothesis_ids: list[str] = field(default_factory=list)
    incidents: list[Incident] = field(default_factory=list)
    inference: list[InferenceMetadata] = field(default_factory=list)
    evidence_database: Path = Path("evidence.sqlite3")
    sandbox: str = ""


def _backend(config: FaultMeshConfig, options: AnalysisOptions) -> InferenceBackend:
    if options.inference_backend is not None:
        return options.inference_backend
    model = options.model or config.model
    if model == "heuristic":
        return HeuristicBackend()
    if model == "llama-server":
        return LlamaCppServerBackend(
            options.llama_endpoint or config.llama_endpoint,
            options.llama_model or config.llama_model,
            timeout_seconds=max(config.timeout_seconds, 120),
        )
    if model == "llama-cli":
        model_path = options.model_path or config.model_path
        if model_path is None:
            raise ValueError("llama-cli requires --model-path or faultmesh.model_path")
        return LlamaCppCliBackend(
            options.llama_cli or config.llama_cli,
            model_path,
            timeout_seconds=max(config.timeout_seconds, 120),
        )
    raise ValueError(f"unknown inference backend: {model}")


def _sandbox(config: FaultMeshConfig, allow_local_execution: bool) -> SandboxRunner:
    if allow_local_execution:
        return LocalSubprocessSandbox(timeout_seconds=config.timeout_seconds)
    return DockerSandbox(image=config.docker_image, timeout_seconds=config.timeout_seconds)


def analyze_repository(
    repository: Path | str, options: AnalysisOptions | None = None
) -> AnalysisSummary:
    options = options or AnalysisOptions()
    repository = Path(repository).resolve()
    config = FaultMeshConfig.load(repository)
    artifact_root = (
        options.artifact_directory.resolve()
        if options.artifact_directory
        else (repository / config.artifact_directory).resolve()
    )
    artifact_root.mkdir(parents=True, exist_ok=True)
    evidence_path = artifact_root / "evidence.sqlite3"
    log_event("analysis.started", "analysis started", repository=str(repository))
    index = ProjectAnalyzer().analyze(repository, focus=options.focus)
    log_event(
        "analysis.indexed",
        "static indexing completed",
        modules=len(index.modules),
        functions=len(index.functions),
        documentation=len(index.documentation),
    )
    backend = _backend(config, options)
    scout = ScoutAgent(
        InferenceClient(backend, max_repair_attempts=options.max_repair_attempts),
        ContextBuilder(max_characters=config.max_context_characters),
    )
    proposal_generator = ProposalGenerator(
        scout,
        max_model_calls=options.max_model_calls,
    )
    sandbox = _sandbox(config, options.allow_local_execution)
    hypotheses: list[str] = []
    incidents: list[Incident] = []
    inference_metadata: list[InferenceMetadata] = []

    with EvidenceStore(evidence_path) as store:
        investigation_id = store.create_investigation(
            index, focus=str(options.focus) if options.focus else None
        )
        functions = [
            function
            for function in index.functions
            if not function.is_method
            and not function.is_async
            and not function.is_generator
            and not function.name.startswith("_")
        ][: options.max_functions]
        for function in functions:
            proposal_outcome = proposal_generator.generate(
                function,
                index,
                configuration=options.proposal_configuration,
            )
            assert proposal_outcome.metadata is not None
            log_event(
                "inference.completed",
                "function investigation completed",
                function=function.qualified_name,
                backend=proposal_outcome.metadata.backend,
                latency_ms=proposal_outcome.metadata.latency_ms,
                hypotheses=len(proposal_outcome.accepted),
                rejected=len(proposal_outcome.rejected),
                abstained=proposal_outcome.abstained,
            )
            inference_metadata.append(proposal_outcome.metadata)
            call_id = store.add_inference_call(
                investigation_id, function.qualified_name, proposal_outcome.metadata
            )
            persisted_rejections: set[tuple[str, str]] = set()
            for rejection in proposal_outcome.rejected:
                rejection_key = (
                    canonical_property_key(rejection.proposal),
                    rejection.reason,
                )
                if rejection_key in persisted_rejections:
                    continue
                persisted_rejections.add(rejection_key)
                hypothesis = _hypothesis_record(
                    investigation_id,
                    rejection.proposal,
                    config.max_examples,
                )
                store.add_hypothesis(hypothesis)
                store.add_edge(call_id, hypothesis.id, "PROPOSED")
                hypotheses.append(hypothesis.id)
                store.transition(
                    hypothesis.id,
                    VerificationStatus.UNSUPPORTED,
                    actor="proposal-validator",
                    reason=rejection.reason,
                )
            for proposed in proposal_outcome.accepted:
                proposed.property_spec.max_examples = config.max_examples
                hypothesis = _hypothesis_record(
                    investigation_id,
                    proposed,
                    config.max_examples,
                )
                store.add_hypothesis(hypothesis)
                store.add_edge(call_id, hypothesis.id, "PROPOSED")
                hypotheses.append(hypothesis.id)
                store.transition(
                    hypothesis.id,
                    VerificationStatus.TESTABLE,
                    actor="specification-validator",
                    reason="closed property specification validated against AST index",
                )
                result = sandbox.run(
                    repository,
                    VerificationManifest(
                        hypothesis_id=hypothesis.id,
                        property_spec=hypothesis.property_spec,
                        confirmation_runs=config.confirmation_runs,
                    ),
                )
                log_event(
                    "verification.completed",
                    "property verification completed",
                    hypothesis_id=hypothesis.id,
                    outcome=result.outcome.value,
                    duration_ms=result.duration_ms,
                    reproduction_rate=result.reproduction_rate,
                    sandbox=sandbox.name,
                )
                store.add_experiment(result)
                if result.outcome in {
                    ExperimentOutcome.PROPERTY_VIOLATION,
                    ExperimentOutcome.TARGET_EXCEPTION,
                }:
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.TESTED,
                        actor="verification-runner",
                        reason=f"observed {result.outcome.value}",
                    )
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.REPRODUCED,
                        actor="reproduction-engine",
                        reason=(
                            f"matching fingerprint in {result.confirming_failures}/"
                            f"{result.confirmation_runs} confirmation runs"
                        ),
                    )
                    verified = store.transition(
                        hypothesis.id,
                        VerificationStatus.VERIFIED,
                        actor="deterministic-verifier",
                        reason="stable explicit property violation",
                    )
                    incident = _incident(repository, artifact_root, verified, result)
                    store.add_incident(incident)
                    ArtifactWriter(artifact_root).write(repository, incident, verified)
                    store.update_incident(incident)
                    incidents.append(incident)
                elif result.outcome == ExperimentOutcome.NO_VIOLATION:
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.TESTED,
                        actor="verification-runner",
                        reason=result.observed,
                    )
                elif result.outcome == ExperimentOutcome.FLAKY:
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.TESTED,
                        actor="verification-runner",
                        reason="a violation was observed but did not reproduce consistently",
                    )
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.FLAKY,
                        actor="reproduction-engine",
                        reason=f"failure rate {result.reproduction_rate:.1%}",
                    )
                else:
                    store.transition(
                        hypothesis.id,
                        VerificationStatus.INCONCLUSIVE,
                        actor="verification-runner",
                        reason=f"{result.outcome.value}: {result.observed}",
                    )
    summary = AnalysisSummary(
        investigation_id=investigation_id,
        project_index=index,
        hypothesis_ids=hypotheses,
        incidents=incidents,
        inference=inference_metadata,
        evidence_database=evidence_path,
        sandbox=sandbox.name,
    )
    log_event(
        "analysis.completed",
        "analysis completed",
        investigation_id=summary.investigation_id,
        hypotheses=len(summary.hypothesis_ids),
        incidents=len(summary.incidents),
    )
    return summary


def _hypothesis_record(
    investigation_id: str,
    proposed: ProposedHypothesis,
    max_examples: int,
) -> HypothesisRecord:
    specification = proposed.property_spec.model_copy(deep=True)
    specification.max_examples = max_examples
    return HypothesisRecord(
        investigation_id=investigation_id,
        description=proposed.description,
        source_references=proposed.source_references,
        preconditions=proposed.preconditions,
        expected_behavior=proposed.expected_behavior,
        violation_condition=proposed.violation_condition,
        originating_agent="code-scout",
        confidence=proposed.confidence,
        property_spec=specification,
    )


def _incident(
    repository: Path,
    artifact_root: Path,
    hypothesis: HypothesisRecord,
    result: ExperimentResult,
) -> Incident:
    assert result.counterexample is not None
    assert result.failure_fingerprint is not None
    placeholder_test = artifact_root / "incidents" / "INCIDENT_ID" / "test_INCIDENT_ID.py"
    command = (
        f"FAULTMESH_REPOSITORY={shlex.quote(str(repository))} "
        f"pytest {shlex.quote(str(placeholder_test))}"
    )
    incident = Incident(
        investigation_id=hypothesis.investigation_id,
        hypothesis_id=hypothesis.id,
        title=f"{hypothesis.property_spec.qualified_name} violates its documented property",
        affected_references=hypothesis.source_references,
        affected_function=hypothesis.property_spec.qualified_name,
        observed_behavior=result.observed,
        expected_behavior=hypothesis.expected_behavior,
        expectation_evidence=hypothesis.property_spec.evidence,
        verification_status=VerificationStatus.VERIFIED,
        counterexample=result.counterexample,
        exact_command=command,
        required_environment={
            "python": ">=3.11",
            "pytest": ">=8.3",
            "repository": str(repository),
        },
        seed=result.seed,
        confirmation_runs=result.confirmation_runs,
        confirming_failures=result.confirming_failures,
        reproduction_rate=result.reproduction_rate,
        failure_fingerprint=result.failure_fingerprint,
        stack_trace=result.stderr,
        suspected_cause=(
            f"Behavior near {hypothesis.property_spec.target.path}:"
            f"{hypothesis.property_spec.target.start_line} may conflict with the cited contract."
        ),
        unresolved_assumptions=[
            "The function docstring is the intended public contract.",
            "The supplied preconditions describe valid caller inputs.",
        ],
        confidence=hypothesis.confidence,
        limitations=[
            "Hypothesis found a minimized reproduction; global minimality is not claimed.",
            "The suspected root cause was not independently verified.",
            "Only the declared input domain and search budget were exercised.",
        ],
    )
    assert incident.artifacts is None
    test_name = f"test_{incident.id.replace('-', '_')}.py"
    actual_test = artifact_root / "incidents" / incident.id / test_name
    incident.exact_command = (
        f"FAULTMESH_REPOSITORY={shlex.quote(str(repository))} "
        f"pytest {shlex.quote(str(actual_test))}"
    )
    return incident


def reproduce_incident(
    repository: Path | str,
    incident_id: str,
    *,
    allow_local_execution: bool = False,
) -> ExperimentResult:
    repository = Path(repository).resolve()
    config = FaultMeshConfig.load(repository)
    evidence_path = (repository / config.artifact_directory / "evidence.sqlite3").resolve()
    with EvidenceStore(evidence_path) as store:
        incident = store.get_incident(incident_id)
        if incident.artifacts is None:
            raise RuntimeError(f"incident has no replay artifact: {incident_id}")
        replay_path = Path(incident.artifacts.replay_manifest)
        replay = ReplayManifest.model_validate_json(replay_path.read_text(encoding="utf-8"))
        result = _sandbox(config, allow_local_execution).run(
            repository,
            VerificationManifest(
                hypothesis_id=replay.hypothesis_id,
                property_spec=replay.property_spec,
                confirmation_runs=replay.confirmation_runs,
                mode="replay",
                counterexample=replay.counterexample,
            ),
        )
        result.expected_fingerprint = replay.expected_fingerprint
        result.fingerprint_matched = result.failure_fingerprint == replay.expected_fingerprint
        store.add_experiment(result)
        return result

