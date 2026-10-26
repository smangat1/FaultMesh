from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.project_runner.models import (
    EnvironmentIdentity,
    ObservationStatus,
    ObservedSymbol,
    ProjectTestRun,
    RunArtifacts,
    RunEvidenceExport,
    RunLimits,
    RunOutcome,
    RunTermination,
    TargetIdentity,
)
from faultmesh.project_runner.models import (
    TestCaseRecord as CaseRecord,
)
from faultmesh.project_runner.models import (
    TestObservation as Observation,
)
from faultmesh.project_runner.models import (
    TestOutcome as CaseOutcome,
)
from faultmesh.project_runner.models import TestPhase as Phase
from faultmesh.structure import build_structure_export


def test_export_is_deterministic_and_never_executes_target(tmp_path: Path) -> None:
    marker = tmp_path / "marker"
    (tmp_path / "danger.py").write_text(
        f'from pathlib import Path\nPath({str(marker)!r}).write_text("bad")\nraise RuntimeError\n\n'
        "def safe_index_only():\n    return 1\n",
        encoding="utf-8",
    )

    first = build_structure_export(tmp_path)
    second = build_structure_export(tmp_path)

    assert first.envelope.content_sha256 == second.envelope.content_sha256
    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert not marker.exists()


def _v2_overlay(path_hash: str) -> RunEvidenceExport:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    run = ProjectTestRun(
        id="run-overlay",
        config_version="2.0",
        target=TargetIdentity(
            root_name="project",
            revision="a" * 40,
            dirty=False,
            content_sha256="b" * 64,
        ),
        command=["python", "-m", "pytest"],
        working_directory=".",
        limits=RunLimits(),
        environment=EnvironmentIdentity(
            base_image=f"image@sha256:{'c' * 64}", dependency_pins=[]
        ),
        started_at=now,
        finished_at=now,
        duration_ms=1,
        exit_code=0,
        termination=RunTermination.EXITED,
        outcome=RunOutcome.PASSED,
        artifacts=RunArtifacts(
            directory="runs/run-overlay",
            run_record="runs/run-overlay/run.json",
            config="runs/run-overlay/config.json",
            stdout="runs/run-overlay/stdout.txt",
            stderr="runs/run-overlay/stderr.txt",
            dockerfile="runs/run-overlay/Dockerfile",
        ),
        observation_requested=True,
        observation_status=ObservationStatus.COMPLETE,
        test_case_count=1,
    )
    case = CaseRecord(
        run_id=run.id,
        node_id="tests/test_value.py::test_value",
        outcome=CaseOutcome.PASSED,
        phases=[],
        observation=Observation(
            status=ObservationStatus.COMPLETE,
            instrumentation_version="coverage-contexts-1.0",
            source_revision="a" * 40,
            source_content_sha256="b" * 64,
            symbols=[
                ObservedSymbol(
                    path="value.py",
                    content_sha256=path_hash,
                    qualified_name="value",
                    start_line=1,
                    end_line=2,
                    executed_lines=[2],
                    phases=[Phase.CALL],
                ),
                ObservedSymbol(
                    path="missing.py",
                    content_sha256="d" * 64,
                    qualified_name="missing",
                    start_line=1,
                    end_line=1,
                    executed_lines=[1],
                    phases=[Phase.CALL],
                ),
            ],
        ),
    )
    return RunEvidenceExport(run=run, tests=[case])


def test_v2_overlay_joins_identity_and_marks_stale_and_unmatched(tmp_path: Path) -> None:
    (tmp_path / "value.py").write_text("def value():\n    return 1\n", encoding="utf-8")
    exported = build_structure_export(tmp_path, coverage=_v2_overlay("0" * 64))

    assert exported.coverage_overlay is not None
    assert exported.coverage_overlay.entries[0].structure_symbol_id == "symbol:value.py:value"
    assert exported.coverage_overlay.entries[0].stale is True
    assert exported.coverage_overlay.unmatched[0].qualified_name == "missing"
    assert all(edge.layer == "static" for edge in exported.edges)


def test_cli_writes_and_reads_export_without_project(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "value.py").write_text("def value():\n    return 1\n", encoding="utf-8")
    output = tmp_path / "structure.json"
    runner = CliRunner()

    built = runner.invoke(app, ["structure", str(project), "--out", str(output)])
    assert built.exit_code == 0, built.output
    summary = json.loads(built.stdout)
    assert summary["files"] == 1
    (project / "value.py").unlink()
    project.rmdir()

    read = runner.invoke(app, ["structure-summary", str(output)])
    assert read.exit_code == 0, read.output
    assert json.loads(read.stdout) == summary
