from __future__ import annotations

import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest

from faultmesh.project_runner.models import (
    EnvironmentIdentity,
    ObservationStatus,
    ProjectTestRun,
    ReplayComparison,
    ReplayProvenance,
    RunArtifacts,
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
from faultmesh.project_runner.replay import export_run, replay_argv, replay_failed_test
from faultmesh.project_runner.runner import (
    DockerClient,
    ProjectRunnerError,
    _compare_replay,
    _content_hash,
)
from faultmesh.project_runner.store import RunStore

BASE_IMAGE = f"python:3.11-slim@sha256:{'a' * 64}"


def _run(content_hash: str, count: int = 1) -> ProjectTestRun:
    now = datetime.now(UTC)
    return ProjectTestRun(
        id="run-parent",
        config_version="2.0",
        target=TargetIdentity(
            root_name="target",
            revision="b" * 40,
            dirty=False,
            content_sha256=content_hash,
        ),
        command=[
            "python",
            "-m",
            "pytest",
            "-q",
            "tests",
            "-p",
            "faultmesh_observer",
            "--json-report",
            "--json-report-file=/output/pytest-report.json",
        ],
        working_directory=".",
        limits=RunLimits(),
        environment=EnvironmentIdentity(
            base_image=BASE_IMAGE,
            resolved_image_id=f"sha256:{'c' * 64}",
            dependency_pins=[
                "pytest==9.0.3",
                "pytest-json-report==1.5.0",
                "coverage==7.10.7",
            ],
            installed_packages=["coverage==7.10.7", "pytest==9.0.3"],
        ),
        started_at=now,
        finished_at=now,
        duration_ms=1,
        exit_code=1,
        termination=RunTermination.EXITED,
        outcome=RunOutcome.FAILED,
        artifacts=RunArtifacts(
            directory="runs/run-parent",
            run_record="runs/run-parent/run.json",
            config="runs/run-parent/config.json",
            stdout="runs/run-parent/stdout.txt",
            stderr="runs/run-parent/stderr.txt",
            dockerfile="runs/run-parent/Dockerfile",
            tests="runs/run-parent/tests.json",
        ),
        observation_requested=True,
        observation_status=ObservationStatus.COMPLETE,
        test_case_count=count,
    )


def _case(outcome: CaseOutcome, fingerprint: str | None = "f" * 64) -> CaseRecord:
    return CaseRecord(
        run_id="run-parent",
        node_id="tests/test_value.py::test_value[a value with spaces]",
        outcome=outcome,
        phases=[],
        failure_text="failure" if fingerprint else None,
        failure_fingerprint=fingerprint,
        observation=Observation(
            status=ObservationStatus.COMPLETE,
            instrumentation_version="coverage-contexts-1.0",
            source_revision="b" * 40,
            source_content_sha256="d" * 64,
        ),
    )


def _provenance() -> ReplayProvenance:
    return ReplayProvenance(
        parent_run_id="run-parent",
        parent_test_id="tests/test_value.py::test_value[a value with spaces]",
        original_failure_fingerprint="f" * 64,
        original_installed_packages=["coverage==7.10.7", "pytest==9.0.3"],
    )


def test_replay_argv_replaces_suite_with_exact_parameterized_node() -> None:
    node_id = "tests/test_value.py::test_value[a value with spaces/and::colons]"
    assert replay_argv(_run("d" * 64).command, node_id) == [
        "python",
        "-m",
        "pytest",
        "-q",
        node_id,
    ]
    with pytest.raises(ProjectRunnerError, match="cannot be replayed safely"):
        replay_argv(["python", "-m", "pytest", "--lf", "tests"], node_id)


@pytest.mark.parametrize(
    ("case", "status", "packages", "expected"),
    [
        (
            _case(CaseOutcome.FAILED),
            ObservationStatus.COMPLETE,
            ["coverage==7.10.7", "pytest==9.0.3"],
            ReplayComparison.SAME_FAILURE,
        ),
        (
            _case(CaseOutcome.FAILED, "e" * 64),
            ObservationStatus.COMPLETE,
            ["coverage==7.10.7", "pytest==9.0.3"],
            ReplayComparison.DIFFERENT_FAILURE,
        ),
        (
            _case(CaseOutcome.PASSED, None),
            ObservationStatus.COMPLETE,
            ["coverage==7.10.7", "pytest==9.0.3"],
            ReplayComparison.PASSED_ON_REPLAY,
        ),
        (
            _case(CaseOutcome.FAILED),
            ObservationStatus.INCOMPLETE,
            ["coverage==7.10.7", "pytest==9.0.3"],
            ReplayComparison.INCONCLUSIVE,
        ),
    ],
)
def test_replay_comparison_is_fingerprint_and_evidence_aware(
    case: CaseRecord,
    status: ObservationStatus,
    packages: list[str],
    expected: ReplayComparison,
) -> None:
    compared = _compare_replay(_provenance(), [case], status, packages)
    assert compared.comparison == expected


def test_replay_comparison_marks_missing_test() -> None:
    compared = _compare_replay(
        _provenance(),
        [],
        ObservationStatus.COMPLETE,
        ["coverage==7.10.7", "pytest==9.0.3"],
    )
    assert compared.comparison == ReplayComparison.MISSING_OR_DESELECTED


def _config(tmp_path: Path, revision: str) -> Path:
    path = tmp_path / "run.toml"
    path.write_text(
        f"""[project_run]
schema_version = "2.0"
target_root = "target"
revision = "{revision}"
artifact_root = "artifacts"

[project_run.environment]
base_image = "{BASE_IMAGE}"
dependency_pins = ["pytest==9.0.3", "pytest-json-report==1.5.0"]

[project_run.test]
argv = ["python", "-m", "pytest", "-q", "tests"]
""",
        encoding="utf-8",
    )
    return path


def test_read_works_without_checkout_and_replay_refuses_changed_source(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    source = target / "value.py"
    source.write_text("VALUE = 1\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "add", "value.py"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(target),
            "-c",
            "user.name=FaultMesh Test",
            "-c",
            "user.email=faultmesh@example.invalid",
            "commit",
            "-q",
            "-m",
            "fixture",
        ],
        check=True,
    )
    revision = subprocess.run(
        ["git", "-C", str(target), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    config = _config(tmp_path, revision)
    run = _run(_content_hash(target))
    run.target.revision = revision
    case = _case(CaseOutcome.FAILED)
    with RunStore(tmp_path / "artifacts" / "runs.sqlite3") as store:
        store.add(run, [case])

    source.write_text("VALUE = 2\n", encoding="utf-8")
    with pytest.raises(ProjectRunnerError, match="content hash differs"):
        replay_failed_test(config, run.id, case.node_id)

    shutil.rmtree(target)
    exported = export_run(config, run.id)
    assert exported.run.id == run.id
    assert exported.tests == [case]


def test_replay_refuses_changed_environment(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "add", "value.py"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(target),
            "-c",
            "user.name=FaultMesh Test",
            "-c",
            "user.email=faultmesh@example.invalid",
            "commit",
            "-q",
            "-m",
            "fixture",
        ],
        check=True,
    )
    revision = subprocess.run(
        ["git", "-C", str(target), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    config = _config(tmp_path, revision)
    run = _run(_content_hash(target))
    run.target.revision = revision
    case = _case(CaseOutcome.FAILED)
    with RunStore(tmp_path / "artifacts" / "runs.sqlite3") as store:
        store.add(run, [case])

    changed = config.read_text().replace("pytest==9.0.3", "pytest==9.0.2")
    config.write_text(changed, encoding="utf-8")
    with pytest.raises(ProjectRunnerError, match="dependency inputs differ"):
        replay_failed_test(config, run.id, case.node_id)


def test_missing_recorded_image_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        del args, kwargs
        return subprocess.CompletedProcess([], 1, "", "not found")

    monkeypatch.setattr(subprocess, "run", missing)
    with pytest.raises(ProjectRunnerError, match="immutable container image is unavailable"):
        DockerClient().require_image(f"sha256:{'c' * 64}")
