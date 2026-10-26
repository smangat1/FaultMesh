from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from faultmesh.api import AnalysisOptions, analyze_repository, reproduce_incident
from faultmesh.schemas import ExperimentOutcome, Incident, VerificationStatus

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def test_complete_vertical_slice_discovers_reports_replays_and_regresses(tmp_path: Path) -> None:
    repository = tmp_path / "project"
    shutil.copytree(EXAMPLE, repository, ignore=shutil.ignore_patterns(".faultmesh"))
    summary = analyze_repository(
        repository,
        AnalysisOptions(model="heuristic", allow_local_execution=True),
    )
    assert len(summary.incidents) == 1
    incident = summary.incidents[0]
    assert incident.verification_status == VerificationStatus.VERIFIED
    assert incident.counterexample == {"maximum": 0, "value": 0}
    assert incident.artifacts is not None
    parsed = Incident.model_validate_json(
        Path(incident.artifacts.incident_json).read_text(encoding="utf-8")
    )
    assert parsed.id == incident.id
    report = Path(incident.artifacts.markdown_report).read_text(encoding="utf-8")
    assert "Suspected cause (not independently verified)" in report
    assert "3/3" in report

    replay = reproduce_incident(repository, incident.id, allow_local_execution=True)
    assert replay.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replay.failure_fingerprint == incident.failure_fingerprint
    assert replay.fingerprint_matched is True

    environment = dict(os.environ)
    environment["FAULTMESH_REPOSITORY"] = str(repository)
    failed = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", incident.artifacts.regression_test],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    assert failed.returncode == 1, failed.stdout + failed.stderr

    source = repository / "src" / "buggy_python_project" / "bounds.py"
    source.write_text(
        source.read_text(encoding="utf-8").replace(
            "if value <= maximum:", "if value < maximum:"
        ),
        encoding="utf-8",
    )
    passed = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", incident.artifacts.regression_test],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    assert passed.returncode == 0, passed.stdout + passed.stderr

