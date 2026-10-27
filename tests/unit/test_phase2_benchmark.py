from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.benchmark.phase2 import (
    ActualUse,
    Phase2PilotOptions,
    Phase2Record,
    PilotBudgets,
    ProposalTrace,
    RuntimeEvidence,
    Timing,
    TokenUse,
    _load_and_validate_lock,
    aggregate_records,
)
from faultmesh.cli.app import app


ROOT = Path(__file__).parents[2]
LOCK = ROOT / "benchmarks/phase-2-pilot.lock.toml"


def _options(*, max_properties: int = 4) -> Phase2PilotOptions:
    return Phase2PilotOptions(
        manifest=LOCK,
        raw_out=ROOT / ".faultmesh/test-phase2.ndjson",
        arms=("slm-only", "baseline-only", "combined", "heuristic-ablation"),
        seeds=(11, 23, 37, 53, 71),
        max_properties=max_properties,
        max_examples=200,
        confirmation_runs=3,
        max_model_calls=2,
        max_repairs=2,
        timeout_seconds=30,
    )


def _record(run_id: str, *, seed: int, found: bool) -> Phase2Record:
    return Phase2Record(
        run_id=run_id,
        bug_id="historical-one",
        variant="buggy",
        split="heldout",
        provenance={"kind": "historical"},
        proposal_configuration="abc",
        arm="slm-only",
        paired_seed=seed,
        budget_view="equal-search",
        source_sha256="a" * 64,
        budgets=PilotBudgets(
            properties=4,
            examples_per_property=200,
            confirmation_runs=3,
            model_calls=2,
            repairs=2,
            verifier_timeout_seconds=30,
            inference_timeout_seconds=120,
            end_to_end_wall_time_seconds=300,
        ),
        actual=ActualUse(),
        classification="adjudicated_bug" if found else "miss_or_control_pass",
        unique_bug_found=found,
        adjudication="confirmed_source_fix",
        replay=True if found else None,
        timing_ms=Timing(charged_end_to_end=10),
        tokens=TokenUse(),
        runtime=RuntimeEvidence(
            hardware="test",
            faultmesh_commit="b" * 40,
            docker_image="faultmesh-sandbox:0.1.0",
            docker_image_id="sha256:" + "c" * 64,
            context_size=8192,
            temperature=0,
            completion_token_cap=2048,
            configuration_sha256="d" * 64,
        ),
        proposal_trace=ProposalTrace(),
    )


def test_lock_rejects_budget_drift_before_execution() -> None:
    with pytest.raises(ValueError, match="max_properties"):
        _load_and_validate_lock(_options(max_properties=5))


def test_raw_schema_round_trips_and_counts_unique_bug_ids_not_seeds() -> None:
    first = _record("run-one", seed=11, found=True)
    second = _record("run-two", seed=23, found=True)

    restored = Phase2Record.model_validate_json(first.model_dump_json())
    aggregate = aggregate_records([first, second])

    assert restored == first
    assert aggregate["rows"][0]["unique_adjudicated_bugs"] == 1
    assert aggregate["uncertainty"]["unit"] == "bug-pair"


def test_cli_requires_explicit_locked_budget_options() -> None:
    result = CliRunner().invoke(
        app,
        ["benchmark", "phase2-pilot", "--manifest", str(LOCK)],
    )

    assert result.exit_code == 2
    assert "Missing option" in result.output
