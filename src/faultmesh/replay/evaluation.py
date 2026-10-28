"""Frozen, offline replay-narration comparison metrics and gate reporting."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EVALUATION_INPUT_VERSION = "replay-evaluation-input-1.0"
EVALUATION_REPORT_VERSION = "replay-evaluation-report-1.0"
FROZEN_PROTOCOL_VERSION = "replay-evaluation-protocol-1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MetricRate(StrictModel):
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    value: float | None


def rate(numerator: int, denominator: int) -> MetricRate:
    return MetricRate(
        numerator=numerator,
        denominator=denominator,
        value=numerator / denominator if denominator else None,
    )


class LabeledClaim(StrictModel):
    canonical_key: str
    truth: Literal["true", "false", "unknowable"]
    relevant: bool = False
    accepted: bool = False
    checker_verdict: Literal[
        "supported", "contradicted", "unsupported_or_unknown", "not_checked"
    ]
    output_stage: Literal["first", "repaired", "template"]
    error_source: Literal["natural", "injected", "none"] = "none"


class StepObservation(StrictModel):
    packet_id: str
    relevant_reference_facts: list[str] = Field(default_factory=list)
    claims: list[LabeledClaim] = Field(default_factory=list)
    invalid_output: bool = False
    abstained: bool = False
    retries: int = Field(default=0, ge=0)


class PerformanceObservation(StrictModel):
    cold_load_ms: float | None = Field(default=None, ge=0)
    warm_step_latencies_ms: list[float] = Field(default_factory=list)
    chapter_latencies_ms: list[float] = Field(default_factory=list)
    peak_process_bytes: int | None = Field(default=None, ge=0)
    memory_pressure_method: str | None = None
    recording_stalls: int | None = Field(default=None, ge=0)
    recording_minutes: float | None = Field(default=None, ge=0)


class EvaluationRun(StrictModel):
    id: str
    comparison_group: str
    arm: Literal["deterministic_templates", "raw_slm", "slm_checker"]
    split: Literal["development", "held_out"]
    data_kind: Literal["real_agent", "handcrafted_fixture", "injected_adversarial"]
    model_id: str | None = None
    model_sha256: str | None = None
    quantization: str | None = None
    backend_build: str | None = None
    hardware: str | None = None
    config_sha256: str
    context_budget: int = Field(ge=1)
    output_budget: int = Field(ge=1)
    steps: list[StepObservation]
    performance: PerformanceObservation | None = None


class EvaluationInput(StrictModel):
    schema_version: Literal["replay-evaluation-input-1.0"] = (
        "replay-evaluation-input-1.0"
    )
    protocol_version: Literal["replay-evaluation-protocol-1.0"] = (
        "replay-evaluation-protocol-1.0"
    )
    protocol_lock_sha256: str
    labels_human_reviewed: bool
    reviewer_count: int = Field(default=0, ge=0)
    reviewer_disagreements: int | None = Field(default=None, ge=0)
    runs: list[EvaluationRun]

    @model_validator(mode="after")
    def fair_comparison(self) -> EvaluationInput:
        groups: dict[str, list[EvaluationRun]] = {}
        for run in self.runs:
            groups.setdefault(run.comparison_group, []).append(run)
        for name, runs in groups.items():
            expected = (
                [step.packet_id for step in runs[0].steps],
                runs[0].context_budget,
                runs[0].output_budget,
                runs[0].split,
            )
            for run in runs[1:]:
                actual = (
                    [step.packet_id for step in run.steps],
                    run.context_budget,
                    run.output_budget,
                    run.split,
                )
                if actual != expected:
                    raise ValueError(
                        f"comparison group {name} changed packet order, split, or budgets"
                    )
        return self


class RunMetrics(StrictModel):
    run_id: str
    arm: str
    split: str
    data_kind: str
    generated_claims: int
    raw_true_checkable: MetricRate
    unknown_truth_claims: int
    unsupported_claims: int
    invalid_output_steps: int
    abstention_steps: int
    accepted_generated: MetricRate
    accepted_true_precision: MetricRate
    relevant_fact_coverage: MetricRate
    zero_accepted_steps: int
    true_claims_falsely_rejected_or_contradicted: int
    false_claims_accepted: int
    false_claims_contradicted: int
    false_claims_routed_unknown: int
    first_output_claims: int
    repaired_output_claims: int
    retries: int
    retry_steps: int


class GateResult(StrictModel):
    name: str
    status: Literal["passed", "failed", "pending"]
    measured: str
    target: str


class EvaluationReport(StrictModel):
    schema_version: Literal["replay-evaluation-report-1.0"] = (
        "replay-evaluation-report-1.0"
    )
    status: Literal["VALIDATED", "PRELIMINARY/UNVALIDATED"]
    protocol_version: str
    run_metrics: list[RunMetrics]
    strata_counts: dict[str, int]
    gates: list[GateResult]
    decision: Literal[
        "GO",
        "NO-GO: experimental/default-off",
    ]
    implemented: list[str]
    measured: list[str]
    pending: list[str]
    proposed: list[str]
    limitations: list[str]


def verify_protocol_lock(directory: Path) -> str:
    lock_path = directory / "freeze-lock-v1.json"
    raw = lock_path.read_bytes()
    lock = json.loads(raw)
    for name, expected in lock["files"].items():
        actual = hashlib.sha256((directory / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"frozen evaluation file hash mismatch: {name}")
    return hashlib.sha256(raw).hexdigest()


def _run_metrics(run: EvaluationRun) -> RunMetrics:
    claims = [claim for step in run.steps for claim in step.claims]
    checkable = [claim for claim in claims if claim.truth in {"true", "false"}]
    accepted = [claim for claim in claims if claim.accepted]
    accepted_true = [claim for claim in accepted if claim.truth == "true"]
    relevant = {
        key for step in run.steps for key in step.relevant_reference_facts
    }
    covered = {claim.canonical_key for claim in accepted_true} & relevant
    retry_steps = sum(step.retries > 0 for step in run.steps)
    return RunMetrics(
        run_id=run.id,
        arm=run.arm,
        split=run.split,
        data_kind=run.data_kind,
        generated_claims=len(claims),
        raw_true_checkable=rate(
            sum(claim.truth == "true" for claim in checkable), len(checkable)
        ),
        unknown_truth_claims=sum(claim.truth == "unknowable" for claim in claims),
        unsupported_claims=sum(
            claim.checker_verdict == "unsupported_or_unknown" for claim in claims
        ),
        invalid_output_steps=sum(step.invalid_output for step in run.steps),
        abstention_steps=sum(step.abstained for step in run.steps),
        accepted_generated=rate(len(accepted), len(claims)),
        accepted_true_precision=rate(len(accepted_true), len(accepted)),
        relevant_fact_coverage=rate(len(covered), len(relevant)),
        zero_accepted_steps=sum(
            not any(claim.accepted for claim in step.claims) for step in run.steps
        ),
        true_claims_falsely_rejected_or_contradicted=sum(
            claim.truth == "true"
            and not claim.accepted
            and claim.checker_verdict in {"contradicted", "unsupported_or_unknown"}
            for claim in claims
        ),
        false_claims_accepted=sum(
            claim.truth == "false" and claim.accepted for claim in claims
        ),
        false_claims_contradicted=sum(
            claim.truth == "false" and claim.checker_verdict == "contradicted"
            for claim in claims
        ),
        false_claims_routed_unknown=sum(
            claim.truth == "false"
            and claim.checker_verdict == "unsupported_or_unknown"
            for claim in claims
        ),
        first_output_claims=sum(claim.output_stage == "first" for claim in claims),
        repaired_output_claims=sum(claim.output_stage == "repaired" for claim in claims),
        retries=sum(step.retries for step in run.steps),
        retry_steps=retry_steps,
    )


def _percentile_95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def evaluate(data: EvaluationInput) -> EvaluationReport:
    metrics = [_run_metrics(run) for run in data.runs]
    strata = Counter(run.data_kind for run in data.runs)
    held_out = [
        (run, metric)
        for run, metric in zip(data.runs, metrics, strict=True)
        if run.split == "held_out" and run.arm == "slm_checker"
    ]
    held_out_claims = sum(metric.generated_claims for _run, metric in held_out)
    false_supported = sum(metric.false_claims_accepted for _run, metric in held_out)
    coverage_numerator = sum(
        metric.relevant_fact_coverage.numerator for _run, metric in held_out
    )
    coverage_denominator = sum(
        metric.relevant_fact_coverage.denominator for _run, metric in held_out
    )
    performance = [
        run.performance for run in data.runs if run.performance is not None
    ]
    warm_latencies = [
        value for item in performance for value in item.warm_step_latencies_ms
    ]
    p95 = _percentile_95(warm_latencies)
    stalls = [item.recording_stalls for item in performance if item.recording_stalls is not None]
    durations = [
        item.recording_minutes for item in performance if item.recording_minutes is not None
    ]
    gates = [
        GateResult(
            name="zero false-supported held-out claims",
            status=(
                "pending"
                if not held_out or not data.labels_human_reviewed
                else ("passed" if false_supported == 0 else "failed")
            ),
            measured=f"{false_supported}/{held_out_claims}" if held_out else "no held-out sample",
            target="0 false-supported claims",
        ),
        GateResult(
            name="held-out relevant-fact coverage",
            status=(
                "pending"
                if coverage_denominator == 0 or not data.labels_human_reviewed
                else (
                    "passed"
                    if coverage_numerator / coverage_denominator >= 0.8
                    else "failed"
                )
            ),
            measured=(
                f"{coverage_numerator}/{coverage_denominator}"
                if coverage_denominator
                else "no held-out reference facts"
            ),
            target=">=80%",
        ),
        GateResult(
            name="model-induced recording stalls",
            status=(
                "pending" if not stalls else ("passed" if sum(stalls) == 0 else "failed")
            ),
            measured=str(sum(stalls)) if stalls else "not measured",
            target="0",
        ),
        GateResult(
            name="bounded warm p95 narration",
            status=(
                "pending"
                if p95 is None
                else ("passed" if p95 <= 10_000 else "failed")
            ),
            measured=f"{p95} ms" if p95 is not None else "not measured",
            target="<=10000 ms",
        ),
        GateResult(
            name="30-minute recording/load stability",
            status=(
                "pending"
                if not durations
                else ("passed" if max(durations) >= 30 else "failed")
            ),
            measured=f"{max(durations)} minutes" if durations else "not measured",
            target=">=30 minutes without crash or sustained pressure",
        ),
        GateResult(
            name="chapter human outcome improves over baseline",
            status="pending",
            measured="no preregistered human comparison",
            target="measurable improvement",
        ),
    ]
    validated = data.labels_human_reviewed and bool(held_out)
    passed = all(gate.status == "passed" for gate in gates)
    return EvaluationReport(
        status="VALIDATED" if validated else "PRELIMINARY/UNVALIDATED",
        protocol_version=data.protocol_version,
        run_metrics=metrics,
        strata_counts={str(name): count for name, count in strata.items()},
        gates=gates,
        decision="GO" if validated and passed else "NO-GO: experimental/default-off",
        implemented=[
            "versioned input/report schemas",
            "fair packet/order/budget validation",
            "one-to-one canonical fact coverage",
            "first/repaired and natural/injected stratification",
            "offline comparison and frozen gate calculation",
        ],
        measured=[
            f"{len(data.runs)} supplied offline run(s)",
            f"{sum(len(run.steps) for run in data.runs)} supplied step(s)",
        ],
        pending=[
            "real held-out agent runs",
            "independent human labels and disagreement report",
            "1.5B/3B/7B local model comparisons",
            "M2 8GB latency, memory pressure and 30-minute load run",
            "reason relevance/plausibility and chapter usefulness ratings",
        ],
        proposed=[
            "20 short runs, 200 atomic claims and three Python projects",
            "zero false-supported, >=80% coverage, <=10s warm p95",
        ],
        limitations=[
            "Synthetic oracle cases validate metric/checker code, not natural SLM quality.",
            "No observed error count establishes universal soundness.",
            "Undefined precision is reported as null when no claim is accepted.",
        ],
    )


def evaluate_file(input_path: Path, output_path: Path) -> EvaluationReport:
    data = EvaluationInput.model_validate_json(input_path.read_text(encoding="utf-8"))
    protocol_directory = Path(__file__).parents[3] / "benchmarks" / "replay"
    actual_lock = verify_protocol_lock(protocol_directory)
    if data.protocol_lock_sha256 != actual_lock:
        raise ValueError("evaluation input does not reference the current frozen protocol lock")
    report = evaluate(data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return EvaluationReport.model_validate_json(output_path.read_text(encoding="utf-8"))
