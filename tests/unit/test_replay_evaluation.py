from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.evaluation import (
    EvaluationInput,
    EvaluationReport,
    evaluate,
    verify_protocol_lock,
)


def _paths() -> tuple[Path, Path]:
    root = Path(__file__).parents[2]
    return root, root / "benchmarks" / "replay" / "development-observations-v1.json"


def test_frozen_protocol_hashes_and_preliminary_synthetic_metrics() -> None:
    root, input_path = _paths()
    data = EvaluationInput.model_validate_json(input_path.read_text(encoding="utf-8"))
    assert data.protocol_lock_sha256 == verify_protocol_lock(root / "benchmarks" / "replay")
    report = evaluate(data)
    by_id = {item.run_id: item for item in report.run_metrics}
    assert by_id["synthetic-raw-slm"].false_claims_accepted == 2
    assert by_id["synthetic-slm-checker"].false_claims_accepted == 0
    assert by_id["synthetic-slm-checker"].false_claims_contradicted == 1
    assert by_id["synthetic-slm-checker"].false_claims_routed_unknown == 1
    assert report.status == "PRELIMINARY/UNVALIDATED"
    assert report.decision == "NO-GO: experimental/default-off"
    assert all(item.status == "pending" for item in report.gates)


def test_zero_accepted_precision_is_undefined_not_perfect() -> None:
    _root, input_path = _paths()
    data = EvaluationInput.model_validate_json(input_path.read_text(encoding="utf-8"))
    run = data.runs[2]
    steps = [
        step.model_copy(
            update={
                "claims": [claim.model_copy(update={"accepted": False}) for claim in step.claims]
            }
        )
        for step in run.steps
    ]
    isolated = data.model_copy(update={"runs": [run.model_copy(update={"steps": steps})]})
    metric = evaluate(isolated).run_metrics[0]
    assert metric.accepted_true_precision.denominator == 0
    assert metric.accepted_true_precision.value is None
    assert metric.zero_accepted_steps == 1


def test_changed_packet_order_or_budget_is_rejected() -> None:
    _root, input_path = _paths()
    value = json.loads(input_path.read_text(encoding="utf-8"))
    value["runs"][1]["output_budget"] = 2048
    with pytest.raises(ValidationError, match="changed packet order"):
        EvaluationInput.model_validate(value)


def test_offline_cli_writes_schema_checked_report(tmp_path: Path) -> None:
    _root, input_path = _paths()
    output = tmp_path / "report.json"
    result = CliRunner().invoke(
        app, ["replay-evaluate", str(input_path), "--out", str(output)]
    )
    assert result.exit_code == 0, result.output
    report = EvaluationReport.model_validate_json(output.read_text(encoding="utf-8"))
    assert report.status == "PRELIMINARY/UNVALIDATED"
    assert report.decision == "NO-GO: experimental/default-off"
