from __future__ import annotations

import json
import subprocess
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
from faultmesh.structure.models import (
    ChangeStatus,
    EdgeKind,
    FileChangeKind,
    StructureExport,
)


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _commit(root: Path, message: str) -> str:
    _git(root, "add", "-A")
    _git(
        root,
        "-c",
        "user.name=FaultMesh Test",
        "-c",
        "user.email=faultmesh@example.invalid",
        "commit",
        "-q",
        "-m",
        message,
    )
    return _git(root, "rev-parse", "HEAD")


def _assert_endpoints_resolve(exported: StructureExport) -> None:
    node_ids = {item.id for item in exported.files} | {item.id for item in exported.symbols}
    assert all(item.parent_id in node_ids for item in exported.symbols)
    assert all(edge.source_id in node_ids for edge in exported.edges)
    assert all(edge.target_id is None or edge.target_id in node_ids for edge in exported.edges)


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


def test_deleted_file_keeps_base_file_class_method_and_edges(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q")
    deleted = tmp_path / "deleted.py"
    deleted.write_text(
        "class Gone:\n    def method(self):\n        return 1\n", encoding="utf-8"
    )
    base = _commit(tmp_path, "base")
    deleted.unlink()

    exported = build_structure_export(tmp_path, base=base)

    ghost_file = next(item for item in exported.files if item.path == "deleted.py")
    assert ghost_file.removed is True
    assert ghost_file.revision_side == "base"
    ghosts = {item.id: item for item in exported.symbols if item.removed}
    assert set(ghosts) == {
        "symbol:deleted.py:Gone",
        "symbol:deleted.py:Gone.method",
    }
    assert all(item.revision_side == "base" for item in ghosts.values())
    assert ghosts["symbol:deleted.py:Gone"].parent_id == ghost_file.id
    assert ghosts["symbol:deleted.py:Gone.method"].parent_id == "symbol:deleted.py:Gone"
    ghost_edges = [edge for edge in exported.edges if edge.removed]
    assert {edge.kind for edge in ghost_edges} == {EdgeKind.DEFINES, EdgeKind.CONTAINS}
    assert all(edge.revision_side == "base" for edge in ghost_edges)
    _assert_endpoints_resolve(exported)


def test_removed_nested_hierarchy_and_mixed_counts_are_explicit(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q")
    target = tmp_path / "mixed.py"
    target.write_text(
        """def current():
    def removed_nested():
        return 1
    return 2

class Removed:
    def method(self):
        return 3
""",
        encoding="utf-8",
    )
    base = _commit(tmp_path, "base")
    target.write_text(
        """def current():
    return 2

def added():
    return 4
""",
        encoding="utf-8",
    )

    exported = build_structure_export(tmp_path, base=base)

    ghosts = {item.id: item for item in exported.symbols if item.removed}
    assert {
        "symbol:mixed.py:current.removed_nested",
        "symbol:mixed.py:Removed",
        "symbol:mixed.py:Removed.method",
    } <= set(ghosts)
    assert ghosts["symbol:mixed.py:current.removed_nested"].parent_id == (
        "symbol:mixed.py:current"
    )
    assert exported.counts.current_files == 1
    assert exported.counts.ghost_files == 0
    assert exported.counts.current_symbols == 2
    assert exported.counts.ghost_symbols == 3
    statuses = {item.symbol_id: item.status for item in exported.git.symbols}
    assert statuses["symbol:mixed.py:added"] == ChangeStatus.ADDED
    assert statuses["symbol:mixed.py:Removed"] == ChangeStatus.REMOVED
    _assert_endpoints_resolve(exported)


def test_rename_with_removed_symbol_attaches_to_current_file(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q")
    old = tmp_path / "old.py"
    kept = "def kept():\n" + "    value = 1\n" * 8 + "    return value\n"
    old.write_text(
        kept + "\ndef removed():\n    return 2\n",
        encoding="utf-8",
    )
    base = _commit(tmp_path, "base")
    _git(tmp_path, "mv", "old.py", "new.py")
    (tmp_path / "new.py").write_text(kept, encoding="utf-8")

    exported = build_structure_export(tmp_path, base=base)

    renamed = next(item for item in exported.git.files if item.status == FileChangeKind.RENAMED)
    assert renamed.old_path == "old.py"
    ghost = next(item for item in exported.symbols if item.qualified_name == "removed")
    assert ghost.removed is True
    assert ghost.revision_side == "base"
    assert ghost.parent_id == "file:new.py"
    assert all(not (item.path == "old.py" and item.removed) for item in exported.files)
    _assert_endpoints_resolve(exported)
