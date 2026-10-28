"""Preregistered phase-2 proposal-quality pilot."""

from __future__ import annotations

import hashlib
import json
import platform
import shutil
import statistics
import subprocess
import tempfile
import time
import tomllib
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import Field

from faultmesh.agents import ProposalConfiguration, ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.inference import HeuristicBackend, InferenceClient, LlamaCppCliBackend
from faultmesh.inference.client import InferenceValidationError
from faultmesh.proposal_quality import (
    DocumentedContractProposer,
    ProposalGenerator,
    ProposalOutcome,
    canonical_property_key,
    deduplicate_proposals,
)
from faultmesh.sandbox import DockerSandbox
from faultmesh.schemas import (
    ExperimentOutcome,
    ExperimentResult,
    InferenceAttempt,
    ProposedHypothesis,
    StrictModel,
    VerificationManifest,
)

SCHEMA_VERSION = "phase2-pilot-1.0"
Arm = Literal["slm-only", "baseline-only", "combined", "heuristic-ablation"]
Split = Literal["development", "heldout"]
Variant = Literal["buggy", "corrected"]


class PilotBudgets(StrictModel):
    properties: Annotated[int, Field(ge=1)]
    examples_per_property: Annotated[int, Field(ge=1)]
    confirmation_runs: Annotated[int, Field(ge=1)]
    model_calls: Annotated[int, Field(ge=1)]
    repairs: Annotated[int, Field(ge=0)]
    verifier_timeout_seconds: Annotated[int, Field(ge=1)]
    inference_timeout_seconds: Annotated[int, Field(ge=1)]
    end_to_end_wall_time_seconds: Annotated[int, Field(ge=1)]


class ActualUse(StrictModel):
    properties: Annotated[int, Field(ge=0)] = 0
    evaluations: Annotated[int, Field(ge=0)] = 0
    model_calls: Annotated[int, Field(ge=0)] = 0
    repairs: Annotated[int, Field(ge=0)] = 0
    timeouts: Annotated[int, Field(ge=0)] = 0
    unused_properties: Annotated[int, Field(ge=0)] = 0
    unused_examples: Annotated[int, Field(ge=0)] = 0
    unused_model_calls: Annotated[int, Field(ge=0)] = 0
    charged_properties: Annotated[int, Field(ge=0)] = 0
    charged_evaluations: Annotated[int, Field(ge=0)] = 0
    charged_model_calls: Annotated[int, Field(ge=0)] = 0
    charged_repairs: Annotated[int, Field(ge=0)] = 0


class Timing(StrictModel):
    inference: float | None = Field(default=None, ge=0)
    verification: float | None = Field(default=None, ge=0)
    end_to_end: float | None = Field(default=None, ge=0)
    charged_end_to_end: float | None = Field(default=None, ge=0)


class TokenUse(StrictModel):
    prompt: int | None = Field(default=None, ge=0)
    completion: int | None = Field(default=None, ge=0)


class RuntimeEvidence(StrictModel):
    model_file: str | None = None
    model_sha256: str | None = None
    quantization: str | None = None
    hardware: str
    memory_bytes: int | None = Field(default=None, ge=0)
    llama_cpp_version: str | None = None
    llama_cpp_build: int | None = Field(default=None, ge=0)
    llama_cpp_commit: str | None = None
    faultmesh_commit: str
    docker_image: str
    docker_image_id: str
    context_size: int
    temperature: float
    completion_token_cap: int
    prompt_sha256: str | None = None
    configuration_sha256: str


class ProposalTrace(StrictModel):
    generation_id: str | None = None
    generation_reused_from: str | None = None
    attempts: list[InferenceAttempt] = Field(default_factory=list)
    rejected: list[str] = Field(default_factory=list)
    accepted_property_keys: list[str] = Field(default_factory=list)
    abstained: bool = False
    model_error: str | None = None


class EvaluationEvidence(StrictModel):
    property_key: str
    outcome: str
    counterexample: dict[str, Any] | None = None
    failure_fingerprint: str | None = None
    confirmation_runs: int
    confirming_failures: int
    replay_outcome: str | None = None
    replay_fingerprint_matched: bool | None = None
    duration_ms: float
    evaluations: int


class Phase2Record(StrictModel):
    schema_version: Literal["phase2-pilot-1.0"] = SCHEMA_VERSION
    run_id: str
    bug_id: str
    variant: Variant
    split: Split
    provenance: dict[str, str | None]
    proposal_configuration: str
    arm: Arm
    paired_seed: int
    budget_view: Literal["equal-search", "equal-wall-time"]
    source_sha256: str
    budgets: PilotBudgets
    actual: ActualUse
    classification: str
    unique_bug_found: bool
    adjudication: str
    replay: bool | None
    timing_ms: Timing
    tokens: TokenUse
    runtime: RuntimeEvidence
    proposal_trace: ProposalTrace
    evaluations: list[EvaluationEvidence] = Field(default_factory=list)
    verification_reused_from: str | None = None


@dataclass(frozen=True)
class Phase2Case:
    bug_id: str
    split: Split
    target: str
    buggy_path: Path
    corrected_path: Path
    buggy_sha256: str
    corrected_sha256: str
    adjudication: str
    provenance: dict[str, str | None]


@dataclass(frozen=True)
class Phase2PilotOptions:
    manifest: Path
    raw_out: Path
    arms: tuple[Arm, ...]
    seeds: tuple[int, ...]
    max_properties: int
    max_examples: int
    confirmation_runs: int
    max_model_calls: int
    max_repairs: int
    timeout_seconds: int
    split: Literal["development", "heldout", "all"] = "all"
    model_path: Path | None = None
    llama_cli: str = "llama-completion"


@dataclass
class _VerificationCacheEntry:
    cache_id: str
    results: list[EvaluationEvidence]
    actual: ActualUse
    verification_ms: float
    classification: str
    replay: bool | None


def run_phase2_pilot(options: Phase2PilotOptions) -> tuple[Path, Path]:
    lock, cases, budgets = _load_and_validate_lock(options)
    repository = options.manifest.resolve().parents[1]
    if options.split in {"heldout", "all"}:
        _validate_prompt_lock(repository)
    raw_out = options.raw_out.resolve()
    raw_out.parent.mkdir(parents=True, exist_ok=True)
    model_path = _resolve_model(options, repository, lock)
    runtime = _runtime_evidence(repository, lock, model_path, options.llama_cli)
    sandbox = DockerSandbox(
        image=str(lock["docker_image"]),
        timeout_seconds=options.timeout_seconds,
        faultmesh_source=repository / "src",
    )
    _verify_docker(runtime)
    selected_cases = [case for case in cases if options.split == "all" or case.split == options.split]
    if not selected_cases:
        raise ValueError(f"no corpus cases selected for split {options.split!r}")

    records: list[Phase2Record] = []
    verification_cache: dict[tuple[str, Variant, int, tuple[str, ...]], _VerificationCacheEntry] = {}
    with tempfile.TemporaryDirectory(prefix="phase2-", dir=raw_out.parent) as temporary:
        work_root = Path(temporary)
        for case in selected_cases:
            variants = {
                "buggy": _isolated_variant(work_root, case, "buggy"),
                "corrected": _isolated_variant(work_root, case, "corrected"),
            }
            buggy_index = ProjectAnalyzer().analyze(variants["buggy"])
            buggy_function = next(
                function for function in buggy_index.functions if function.name == case.target
            )
            baseline = DocumentedContractProposer().propose(buggy_function)
            heuristic = _heuristic_proposals(buggy_function, buggy_index)
            for configuration in ProposalConfiguration:
                generation_id = f"gen-{uuid4().hex[:12]}"
                slm_started = time.perf_counter()
                try:
                    slm_outcome = _slm_proposals(
                        buggy_function,
                        buggy_index,
                        configuration,
                        model_path,
                        options,
                        lock,
                    )
                    model_error = None
                except (InferenceValidationError, RuntimeError, OSError, ValueError) as exc:
                    slm_outcome = ProposalOutcome()
                    model_error = f"{type(exc).__name__}: {exc}"
                    if isinstance(exc, InferenceValidationError):
                        slm_attempts = exc.attempts
                    else:
                        slm_attempts = []
                else:
                    slm_attempts = (
                        slm_outcome.metadata.attempts if slm_outcome.metadata else []
                    )
                slm_ms = (time.perf_counter() - slm_started) * 1000
                prompt_sha = slm_attempts[0].prompt_sha256 if slm_attempts else None
                runtime_for_configuration = runtime.model_copy(
                    update={"prompt_sha256": prompt_sha}
                )
                proposals_by_arm: dict[Arm, list[ProposedHypothesis]] = {
                    "slm-only": deduplicate_proposals(
                        slm_outcome.accepted, max_properties=options.max_properties
                    ),
                    "baseline-only": deduplicate_proposals(
                        baseline, max_properties=options.max_properties
                    ),
                    "combined": _combined_union(
                        slm_outcome.accepted, baseline, options.max_properties
                    ),
                    "heuristic-ablation": deduplicate_proposals(
                        heuristic, max_properties=options.max_properties
                    ),
                }
                for arm in options.arms:
                    selected = proposals_by_arm[arm]
                    for seed in options.seeds:
                        for variant_name in ("buggy", "corrected"):
                            variant = _variant_literal(variant_name)
                            uses_slm = arm in {"slm-only", "combined"}
                            generation_owner = (
                                arm == "slm-only"
                                and seed == options.seeds[0]
                                and variant == "buggy"
                            )
                            rebound = [
                                _rebind_proposal(proposal, variants[variant], case.target)
                                for proposal in selected
                            ]
                            keys = tuple(canonical_property_key(item) for item in rebound)
                            cache_key = (case.bug_id, variant, seed, keys)
                            cached = verification_cache.get(cache_key)
                            if cached is None:
                                charged_inference = slm_ms if arm in {"slm-only", "combined"} else 0.0
                                cached = _verify_properties(
                                    variants[variant],
                                    rebound,
                                    seed,
                                    sandbox,
                                    budgets,
                                    charged_inference,
                                )
                                verification_cache[cache_key] = cached
                                reused_from = None
                            else:
                                reused_from = cached.cache_id
                            proposal_trace = ProposalTrace(
                                generation_id=generation_id if generation_owner else None,
                                generation_reused_from=(
                                    generation_id
                                    if uses_slm and not generation_owner
                                    else None
                                ),
                                attempts=slm_attempts if generation_owner else [],
                                rejected=[item.reason for item in slm_outcome.rejected]
                                if generation_owner
                                else [],
                                accepted_property_keys=list(keys),
                                abstained=(
                                    slm_outcome.abstained if uses_slm else not selected
                                ),
                                model_error=model_error if uses_slm else None,
                            )
                            actual = (
                                cached.actual.model_copy(deep=True)
                                if reused_from is None
                                else ActualUse(
                                    unused_properties=budgets.properties,
                                    unused_examples=(
                                        budgets.properties
                                        * budgets.examples_per_property
                                    ),
                                    unused_model_calls=budgets.model_calls,
                                )
                            )
                            if generation_owner:
                                actual.model_calls = len(slm_attempts)
                                actual.repairs = sum(
                                    attempt.phase == "json_repair"
                                    for attempt in slm_attempts
                                )
                                actual.unused_model_calls = max(
                                    0, options.max_model_calls - actual.model_calls
                                )
                            actual.charged_properties = cached.actual.properties
                            actual.charged_evaluations = cached.actual.evaluations
                            if (
                                uses_slm
                                and seed == options.seeds[0]
                                and variant == "buggy"
                            ):
                                actual.charged_model_calls = len(slm_attempts)
                                actual.charged_repairs = sum(
                                    attempt.phase == "json_repair"
                                    for attempt in slm_attempts
                                )
                            classification = (
                                "model_error"
                                if arm == "slm-only" and model_error
                                else cached.classification
                            )
                            record = Phase2Record(
                                run_id=f"run-{uuid4().hex[:12]}",
                                bug_id=case.bug_id,
                                variant=variant,
                                split=case.split,
                                provenance=case.provenance,
                                proposal_configuration=configuration.value,
                                arm=arm,
                                paired_seed=seed,
                                budget_view="equal-search",
                                source_sha256=(
                                    case.buggy_sha256
                                    if variant == "buggy"
                                    else case.corrected_sha256
                                ),
                                budgets=budgets,
                                actual=actual,
                                classification=classification,
                                unique_bug_found=False,
                                adjudication=case.adjudication,
                                replay=cached.replay,
                                timing_ms=Timing(
                                    inference=slm_ms if generation_owner else None,
                                    verification=(
                                        cached.verification_ms if reused_from is None else 0.0
                                    ),
                                    end_to_end=(
                                        slm_ms + cached.verification_ms
                                        if generation_owner
                                        else cached.verification_ms
                                    ),
                                    charged_end_to_end=(
                                        cached.verification_ms
                                        + (
                                            slm_ms
                                            if arm in {"slm-only", "combined"}
                                            else 0.0
                                        )
                                    ),
                                ),
                                tokens=TokenUse(
                                    prompt=(
                                        slm_outcome.metadata.prompt_tokens
                                        if generation_owner and slm_outcome.metadata
                                        else None
                                    ),
                                    completion=(
                                        slm_outcome.metadata.completion_tokens
                                        if generation_owner and slm_outcome.metadata
                                        else None
                                    ),
                                ),
                                runtime=runtime_for_configuration,
                                proposal_trace=proposal_trace,
                                evaluations=cached.results if reused_from is None else [],
                                verification_reused_from=reused_from,
                            )
                            records.append(record)
    _mark_pair_findings(records)
    _write_ndjson(raw_out, records)
    summary_path = raw_out.with_suffix(".summary.json")
    report_path = raw_out.with_suffix(".report.md")
    aggregate = aggregate_records(records)
    summary_path.write_text(
        json.dumps(aggregate, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    report_path.write_text(_render_report(aggregate, options), encoding="utf-8")
    return summary_path, report_path


def _load_and_validate_lock(
    options: Phase2PilotOptions,
) -> tuple[dict[str, Any], list[Phase2Case], PilotBudgets]:
    if not options.manifest.is_file():
        raise FileNotFoundError(f"lock manifest not found: {options.manifest}")
    with options.manifest.open("rb") as handle:
        lock = tomllib.load(handle)
    if lock.get("schema_version") != "phase2-lock-1.0":
        raise ValueError("unsupported phase-2 lock schema")
    locked = lock["budgets"]
    checks = {
        "arms": list(options.arms),
        "seeds": list(options.seeds),
        "max_properties": options.max_properties,
        "max_examples": options.max_examples,
        "confirmation_runs": options.confirmation_runs,
        "max_model_calls": options.max_model_calls,
        "max_repairs": options.max_repairs,
        "verifier_timeout_seconds": options.timeout_seconds,
    }
    for key, value in checks.items():
        if locked[key] != value:
            raise ValueError(f"command {key}={value!r} does not match locked value {locked[key]!r}")
    root = options.manifest.parent
    cases: list[Phase2Case] = []
    for payload in lock["cases"]:
        buggy = root / payload["buggy_path"]
        corrected = root / payload["corrected_path"]
        _verify_hash(buggy, payload["buggy_sha256"])
        _verify_hash(corrected, payload["corrected_sha256"])
        provenance = {
            "kind": payload["provenance_kind"],
            "repository_url": payload.get("repository_url"),
            "source_commit": payload.get("source_commit"),
            "fix_commit": payload.get("fix_commit"),
            "license": payload.get("license"),
            "original_path": payload.get("original_path"),
            "adaptation": payload.get("adaptation"),
        }
        cases.append(
            Phase2Case(
                bug_id=payload["bug_id"],
                split=payload["split"],
                target=payload["target"],
                buggy_path=buggy,
                corrected_path=corrected,
                buggy_sha256=payload["buggy_sha256"],
                corrected_sha256=payload["corrected_sha256"],
                adjudication=payload["adjudication"],
                provenance=provenance,
            )
        )
    budgets = PilotBudgets(
        properties=options.max_properties,
        examples_per_property=options.max_examples,
        confirmation_runs=options.confirmation_runs,
        model_calls=options.max_model_calls,
        repairs=options.max_repairs,
        verifier_timeout_seconds=options.timeout_seconds,
        inference_timeout_seconds=locked["inference_timeout_seconds"],
        end_to_end_wall_time_seconds=locked["end_to_end_wall_time_seconds"],
    )
    return lock, cases, budgets


def _resolve_model(options: Phase2PilotOptions, repository: Path, lock: dict[str, Any]) -> Path:
    candidates = [
        options.model_path,
        repository / ".faultmesh/models" / lock["model_filename"],
        Path.cwd() / ".faultmesh/models" / lock["model_filename"],
    ]
    model = next((path.resolve() for path in candidates if path and path.is_file()), None)
    if model is None:
        raise FileNotFoundError(
            "locked local GGUF is unavailable; pass --model-path without downloading a replacement"
        )
    _verify_hash(model, lock["model_sha256"])
    return model


def _runtime_evidence(
    repository: Path,
    lock: dict[str, Any],
    model: Path,
    llama_cli: str,
) -> RuntimeEvidence:
    executable = shutil.which(llama_cli)
    if executable is None:
        raise FileNotFoundError(f"llama.cpp executable not found: {llama_cli}")
    version = subprocess.run(
        [executable, "--version"], capture_output=True, text=True, timeout=10, check=False
    )
    version_text = (version.stdout + version.stderr).strip()
    for expected in (str(lock["llama_cpp_build"]), str(lock["llama_cpp_commit"])):
        if expected not in version_text:
            raise RuntimeError(
                f"llama.cpp runtime mismatch: expected {expected!r} in {version_text!r}"
            )
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    ).stdout.strip()
    configuration_hash = hashlib.sha256(
        json.dumps(lock, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return RuntimeEvidence(
        model_file=model.name,
        model_sha256=lock["model_sha256"],
        quantization=lock["model_quantization"],
        hardware=platform.platform(),
        memory_bytes=None,
        llama_cpp_version=lock["llama_cpp_version"],
        llama_cpp_build=lock["llama_cpp_build"],
        llama_cpp_commit=lock["llama_cpp_commit"],
        faultmesh_commit=commit,
        docker_image=lock["docker_image"],
        docker_image_id=lock["docker_image_id"],
        context_size=lock["context_size"],
        temperature=lock["temperature"],
        completion_token_cap=lock["completion_token_cap"],
        configuration_sha256=configuration_hash,
    )


def _verify_docker(runtime: RuntimeEvidence) -> None:
    inspected = subprocess.run(
        ["docker", "image", "inspect", runtime.docker_image, "--format", "{{.Id}}"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if inspected.returncode != 0:
        raise RuntimeError(
            f"locked Docker image is unavailable (no pull attempted): {inspected.stderr.strip()}"
        )
    if inspected.stdout.strip() != runtime.docker_image_id:
        raise RuntimeError(
            f"Docker image ID mismatch: {inspected.stdout.strip()} != {runtime.docker_image_id}"
        )


def _isolated_variant(
    work_root: Path, case: Phase2Case, variant: Variant
) -> Path:
    root = work_root / case.bug_id / variant
    root.mkdir(parents=True, exist_ok=False)
    source = case.buggy_path if variant == "buggy" else case.corrected_path
    (root / "target.py").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    return root


def _slm_proposals(
    function: Any,
    index: Any,
    configuration: ProposalConfiguration,
    model_path: Path,
    options: Phase2PilotOptions,
    lock: dict[str, Any],
) -> ProposalOutcome:
    backend = LlamaCppCliBackend(
        options.llama_cli,
        model_path,
        timeout_seconds=lock["budgets"]["inference_timeout_seconds"],
        context_size=lock["context_size"],
    )
    scout = ScoutAgent(
        InferenceClient(backend, max_repair_attempts=options.max_repairs), ContextBuilder()
    )
    return ProposalGenerator(scout, max_model_calls=options.max_model_calls).generate(
        function, index, configuration=configuration
    )


def _heuristic_proposals(function: Any, index: Any) -> list[ProposedHypothesis]:
    scout = ScoutAgent(InferenceClient(HeuristicBackend()), ContextBuilder())
    return ProposalGenerator(scout, max_model_calls=1).generate(
        function, index, configuration=ProposalConfiguration.CURRENT_MAIN
    ).accepted


def _combined_union(
    slm: list[ProposedHypothesis],
    baseline: list[ProposedHypothesis],
    maximum: int,
) -> list[ProposedHypothesis]:
    ordered: list[ProposedHypothesis] = []
    for position in range(max(len(slm), len(baseline))):
        if position < len(slm):
            ordered.append(slm[position])
        if position < len(baseline):
            ordered.append(baseline[position])
    return deduplicate_proposals(ordered, max_properties=maximum)


def _rebind_proposal(
    proposal: ProposedHypothesis, root: Path, target_name: str
) -> ProposedHypothesis:
    index = ProjectAnalyzer().analyze(root)
    function = next(item for item in index.functions if item.name == target_name)
    rebound = proposal.model_copy(deep=True)
    reference = function.reference.model_copy(deep=True)
    rebound.source_references = [reference]
    rebound.property_spec.target = reference.model_copy(deep=True)
    rebound.property_spec.evidence = [reference.model_copy(deep=True)]
    rebound.property_spec.qualified_name = function.qualified_name
    return rebound


def _verify_properties(
    root: Path,
    proposals: list[ProposedHypothesis],
    seed: int,
    sandbox: DockerSandbox,
    budgets: PilotBudgets,
    charged_inference_ms: float,
) -> _VerificationCacheEntry:
    started = time.perf_counter()
    results: list[EvaluationEvidence] = []
    actual = ActualUse(unused_model_calls=budgets.model_calls)
    cap_ms = budgets.end_to_end_wall_time_seconds * 1000
    for position, proposal in enumerate(proposals):
        elapsed_ms = (time.perf_counter() - started) * 1000 + charged_inference_ms
        if elapsed_ms >= cap_ms:
            break
        specification = proposal.property_spec.model_copy(deep=True)
        specification.seed = seed
        specification.max_examples = budgets.examples_per_property
        manifest = VerificationManifest(
            hypothesis_id=f"pilot-{position}",
            property_spec=specification,
            confirmation_runs=budgets.confirmation_runs,
        )
        result = sandbox.run(root, manifest)
        replay: ExperimentResult | None = None
        if result.outcome in {
            ExperimentOutcome.PROPERTY_VIOLATION,
            ExperimentOutcome.TARGET_EXCEPTION,
        } and result.counterexample is not None:
            replay = sandbox.run(
                root,
                VerificationManifest(
                    hypothesis_id=f"pilot-{position}-replay",
                    property_spec=specification,
                    confirmation_runs=budgets.confirmation_runs,
                    mode="replay",
                    counterexample=result.counterexample,
                ),
            )
        actual.properties += 1
        actual.evaluations += result.evaluations + (replay.evaluations if replay else 0)
        actual.timeouts += int(result.outcome == ExperimentOutcome.TIMEOUT)
        results.append(
            EvaluationEvidence(
                property_key=canonical_property_key(proposal),
                outcome=result.outcome.value,
                counterexample=result.counterexample,
                failure_fingerprint=result.failure_fingerprint,
                confirmation_runs=result.confirmation_runs,
                confirming_failures=result.confirming_failures,
                replay_outcome=replay.outcome.value if replay else None,
                replay_fingerprint_matched=(
                    replay.failure_fingerprint == result.failure_fingerprint
                    if replay and replay.failure_fingerprint and result.failure_fingerprint
                    else None
                ),
                duration_ms=result.duration_ms + (replay.duration_ms if replay else 0),
                evaluations=result.evaluations + (replay.evaluations if replay else 0),
            )
        )
    actual.unused_properties = max(0, budgets.properties - actual.properties)
    actual.unused_examples = max(
        0,
        budgets.properties * budgets.examples_per_property - actual.evaluations,
    )
    outcomes = {item.outcome for item in results}
    if not proposals:
        classification = "no_executable_proposal"
    elif "ENVIRONMENT_ERROR" in outcomes:
        classification = "environment_error"
    elif "HARNESS_ERROR" in outcomes:
        classification = "harness_error"
    elif "TIMEOUT" in outcomes:
        classification = "timeout"
    elif "FLAKY" in outcomes:
        classification = "flaky"
    elif outcomes & {"PROPERTY_VIOLATION", "TARGET_EXCEPTION"}:
        classification = "verified_violation"
    else:
        classification = "miss_or_control_pass"
    replay_values = [
        item.replay_fingerprint_matched
        for item in results
        if item.replay_fingerprint_matched is not None
    ]
    return _VerificationCacheEntry(
        cache_id=f"verify-{uuid4().hex[:12]}",
        results=results,
        actual=actual,
        verification_ms=(time.perf_counter() - started) * 1000,
        classification=classification,
        replay=all(replay_values) if replay_values else None,
    )


def _mark_pair_findings(records: list[Phase2Record]) -> None:
    by_key: dict[tuple[str, str, str, int, str], Phase2Record] = {}
    for record in records:
        by_key[
            (
                record.bug_id,
                record.proposal_configuration,
                record.arm,
                record.paired_seed,
                record.variant,
            )
        ] = record
    for record in records:
        if record.variant != "buggy" or record.classification != "verified_violation":
            continue
        control = by_key.get(
            (
                record.bug_id,
                record.proposal_configuration,
                record.arm,
                record.paired_seed,
                "corrected",
            )
        )
        if control is None:
            continue
        if control.classification == "verified_violation":
            control.classification = "false_property_on_control"
            continue
        if record.replay is not True:
            continue
        if record.adjudication == "confirmed_source_fix":
            record.unique_bug_found = True
            record.classification = "adjudicated_bug"
        else:
            record.classification = "pending_adjudication"


def aggregate_records(records: list[Phase2Record]) -> dict[str, Any]:
    groups: dict[tuple[str, str, str], list[Phase2Record]] = defaultdict(list)
    for record in records:
        groups[(record.split, record.proposal_configuration, record.arm)].append(record)
    rows: list[dict[str, Any]] = []
    for (split, configuration, arm), members in sorted(groups.items()):
        buggy = [item for item in members if item.variant == "buggy"]
        generation_records = [item for item in buggy if item.proposal_trace.generation_id]
        target_records = [
            item for item in buggy if item.paired_seed == min(member.paired_seed for member in buggy)
        ] if buggy else []
        model_attempts = [
            attempt
            for item in generation_records
            for attempt in item.proposal_trace.attempts
        ]
        final_targets = {
            item.bug_id: bool(item.proposal_trace.accepted_property_keys)
            for item in target_records
        }
        valid_attempts = sum(attempt.validation_error is None for attempt in model_attempts)
        unsupported = sum(len(item.proposal_trace.rejected) for item in generation_records)
        accepted = sum(
            len(item.proposal_trace.accepted_property_keys) for item in target_records
        )
        denominator = accepted + unsupported
        latencies = [
            item.timing_ms.charged_end_to_end
            for item in buggy
            if item.timing_ms.charged_end_to_end is not None
        ]
        rows.append(
            {
                "budget_view": "equal-search",
                "split": split,
                "configuration": configuration,
                "arm": arm,
                "model_attempt_syntax_valid": valid_attempts,
                "model_attempt_denominator": len(model_attempts),
                "proposal_valid_numerator": accepted,
                "proposal_valid_denominator": denominator,
                "unsupported_numerator": unsupported,
                "unsupported_denominator": denominator,
                "final_targets_with_executable_proposal": sum(final_targets.values()),
                "final_target_denominator": len(final_targets),
                "honest_abstentions": sum(
                    item.proposal_trace.abstained for item in target_records
                ),
                "unique_adjudicated_bugs": len(
                    {item.bug_id for item in buggy if item.unique_bug_found}
                ),
                "verified_violations": len(
                    {item.bug_id for item in buggy if item.classification in {"adjudicated_bug", "pending_adjudication"}}
                ),
                "false_properties_on_controls": sum(
                    item.classification == "false_property_on_control" for item in members
                ),
                "replay_successes": sum(item.replay is True for item in buggy),
                "actual_model_calls": sum(item.actual.model_calls for item in members),
                "actual_properties": sum(item.actual.properties for item in members),
                "actual_evaluations": sum(item.actual.evaluations for item in members),
                "charged_model_calls": sum(
                    item.actual.charged_model_calls for item in members
                ),
                "charged_properties": sum(
                    item.actual.charged_properties for item in members
                ),
                "charged_evaluations": sum(
                    item.actual.charged_evaluations for item in members
                ),
                "latency_ms": {
                    "median": statistics.median(latencies) if latencies else None,
                    "minimum": min(latencies) if latencies else None,
                    "maximum": max(latencies) if latencies else None,
                },
            }
        )
    rows.extend(
        {**row, "budget_view": "equal-wall-time", "reused_bounded_runs": True}
        for row in list(rows)
    )
    return {
        "schema_version": "phase2-pilot-aggregate-1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "record_count": len(records),
        "rows": rows,
        "uncertainty": {
            "unit": "bug-pair",
            "method": "descriptive paired counts only",
            "reason": "eight held-out pairs are too few for stable interval estimates",
        },
        "notes": [
            "Paired seeds are repeated search runs, not independent model samples.",
            "Temperature-zero proposal generations are cached once per target/configuration.",
            "Synthetic cases pending independent review are never counted as adjudicated bugs.",
            "Equal-wall-time is a charged view of the same runs, not an independent sample.",
        ],
    }


def _render_report(aggregate: dict[str, Any], options: Phase2PilotOptions) -> str:
    lines = [
        "# Phase 2 proposal-quality pilot",
        "",
        f"Split executed: `{options.split}`. This bounded pilot does not measure arbitrary Python.",
        "",
        "| Budget view | Split | Configuration | Arm | Proposal valid | UNSUPPORTED | Unique adjudicated bugs | False controls | Replay | Calls physical/charged | Evaluations physical/charged |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in aggregate["rows"]:
        lines.append(
            f"| {row['budget_view']} | {row['split']} | {row['configuration']} | {row['arm']} | "
            f"{row['proposal_valid_numerator']}/{row['proposal_valid_denominator']} | "
            f"{row['unsupported_numerator']}/{row['unsupported_denominator']} | "
            f"{row['unique_adjudicated_bugs']} | {row['false_properties_on_controls']} | "
            f"{row['replay_successes']} | {row['actual_model_calls']}/{row['charged_model_calls']} | "
            f"{row['actual_evaluations']}/{row['charged_evaluations']} |"
        )
    lines.extend(
        [
            "",
            "## Interpretation limits",
            "",
            "- Development and held-out records remain separate.",
            "- Verified violations pending independent review are not adjudicated bugs.",
            "- The equal-wall-time view reuses the same bounded runs and charges cached inference; it is not another sample.",
            "- Missing token and memory telemetry is recorded as null, not estimated.",
            "",
        ]
    )
    return "\n".join(lines)


def _write_ndjson(path: Path, records: list[Phase2Record]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(record.model_dump_json() + "\n")


def _verify_hash(path: Path, expected: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f"content hash mismatch for {path}: {actual} != {expected}")


def _validate_prompt_lock(repository: Path) -> None:
    path = repository / "benchmarks/phase2-prompt-lock.json"
    if not path.is_file():
        raise FileNotFoundError("held-out execution requires benchmarks/phase2-prompt-lock.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "phase2-prompt-lock-1.0":
        raise ValueError("unsupported phase-2 prompt lock")
    for relative, expected in payload["files"].items():
        _verify_hash(repository / relative, expected)


def _variant_literal(value: str) -> Variant:
    if value == "buggy":
        return "buggy"
    if value == "corrected":
        return "corrected"
    raise ValueError(value)
