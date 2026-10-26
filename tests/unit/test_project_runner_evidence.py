from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from faultmesh.project_runner.evidence import bound_text, failure_fingerprint
from faultmesh.project_runner.models import (
    EnvironmentIdentity,
    ObservationStatus,
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
    TestOutcome as CaseOutcome,
)
from faultmesh.project_runner.models import (
    TestPhase as Phase,
)
from faultmesh.project_runner.models import (
    TestPhaseResult as PhaseResult,
)
from faultmesh.project_runner.store import RunStore, RunStoreError


def _run(run_id: str, count: int) -> ProjectTestRun:
    now = datetime.now(UTC)
    return ProjectTestRun(
        id=run_id,
        config_version="2.0",
        target=TargetIdentity(
            root_name="target",
            revision="a" * 40,
            dirty=False,
            content_sha256="b" * 64,
        ),
        command=["python", "-m", "pytest"],
        working_directory=".",
        limits=RunLimits(),
        environment=EnvironmentIdentity(
            base_image=f"python@sha256:{'c' * 64}", dependency_pins=["pytest==9.0.3"]
        ),
        started_at=now,
        finished_at=now,
        duration_ms=1,
        exit_code=1,
        termination=RunTermination.EXITED,
        outcome=RunOutcome.FAILED,
        artifacts=RunArtifacts(
            directory=f"runs/{run_id}",
            run_record=f"runs/{run_id}/run.json",
            config=f"runs/{run_id}/config.json",
            stdout=f"runs/{run_id}/stdout.txt",
            stderr=f"runs/{run_id}/stderr.txt",
            dockerfile=f"runs/{run_id}/Dockerfile",
        ),
        observation_requested=True,
        observation_status=ObservationStatus.COMPLETE,
        test_case_count=count,
    )


def _case(run_id: str, node_id: str) -> CaseRecord:
    return CaseRecord(
        run_id=run_id,
        node_id=node_id,
        outcome=CaseOutcome.FAILED,
        phases=[
            PhaseResult(
                phase=Phase.CALL,
                outcome=CaseOutcome.FAILED,
                duration_ms=1,
                failure_text="assert 1 == 2",
            )
        ],
        duration_ms=1,
        failure_text="assert 1 == 2",
        failure_fingerprint="d" * 64,
    )


def test_test_cases_are_scoped_to_run_and_exact_parameter_id(tmp_path: Path) -> None:
    first = _run("run-first", 2)
    second = _run("run-second", 1)
    first_cases = [
        _case(first.id, "tests/test_math.py::test_value[hello world]"),
        _case(first.id, "tests/test_math.py::test_value[a/b::c]"),
    ]
    second_cases = [_case(second.id, first_cases[0].node_id)]

    with RunStore(tmp_path / "runs.sqlite3") as store:
        store.add(first, first_cases)
        store.add(second, second_cases)
        assert store.get_test(first.id, first_cases[0].node_id) == first_cases[0]
        assert store.get_test(second.id, first_cases[0].node_id) == second_cases[0]
        assert store.list_tests(first.id) == sorted(first_cases, key=lambda case: case.node_id)
        exported = RunEvidenceExport(run=first, tests=store.list_tests(first.id))
        assert exported.schema_version == "2.0"


def test_store_rejects_mixed_or_duplicate_test_ownership(tmp_path: Path) -> None:
    with RunStore(tmp_path / "runs.sqlite3") as store:
        with pytest.raises(RunStoreError, match="different run"):
            store.add(_run("run-a", 1), [_case("run-b", "tests/test_a.py::test_a")])
        duplicate = _case("run-a", "tests/test_a.py::test_a")
        with pytest.raises(RunStoreError, match="unique"):
            store.add(_run("run-a", 2), [duplicate, duplicate])


def test_v1_store_is_rejected_without_modification(tmp_path: Path) -> None:
    path = tmp_path / "runs.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE schema_metadata (version INTEGER NOT NULL)")
    connection.execute("CREATE TABLE runs (id TEXT PRIMARY KEY, created_at TEXT, record_json TEXT)")
    connection.execute("INSERT INTO schema_metadata VALUES (1)")
    connection.commit()
    connection.close()
    before = path.read_bytes()

    with pytest.raises(RunStoreError, match="fresh V2 artifact_root"):
        RunStore(path)

    assert path.read_bytes() == before


def test_failure_fingerprint_normalizes_only_documented_noise() -> None:
    first = "<Thing at 0x123abc>\n/workspace/pkg/code.py:9 took 1.2s\n"
    second = "<Thing at 0x999fff>\r\n/workspace/pkg/code.py:9 took 8s"
    assert failure_fingerprint("tests/test_a.py::test_a", Phase.CALL, first) == (
        failure_fingerprint("tests/test_a.py::test_a", Phase.CALL, second)
    )
    assert failure_fingerprint("tests/test_a.py::test_b", Phase.CALL, first) != (
        failure_fingerprint("tests/test_a.py::test_a", Phase.CALL, first)
    )
    text, truncated = bound_text("é" * 10, 5)
    assert text == "éé" and truncated is True
