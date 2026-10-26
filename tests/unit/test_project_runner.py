from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from faultmesh.project_runner.config import load_run_config
from faultmesh.project_runner.models import ProjectRunConfig, RunOutcome, RunTermination
from faultmesh.project_runner.runner import (
    ContainerExecution,
    DockerClient,
    ProjectRunnerError,
    ProjectTestRunner,
    _BoundedBuffer,
    parse_pytest_report,
)
from faultmesh.project_runner.store import RunStore

BASE_IMAGE = (
    "python:3.11-slim@sha256:"
    "b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377"
)


def _repository(root: Path) -> str:
    root.mkdir()
    (root / "sample.py").write_text("VALUE = 1\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "sample.py"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
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
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _config(tmp_path: Path) -> Path:
    revision = _repository(tmp_path / "target")
    path = tmp_path / "run.toml"
    path.write_text(
        "\n".join(
            [
                "[project_run]",
                'schema_version = "1.0"',
                'target_root = "target"',
                f'revision = "{revision}"',
                'artifact_root = "artifacts"',
                "",
                "[project_run.environment]",
                f'base_image = "{BASE_IMAGE}"',
                'dependency_pins = ["pytest==8.3.5", "pytest-json-report==1.5.0"]',
                "",
                "[project_run.test]",
                'argv = ["python", "-m", "pytest", "-q"]',
                'working_directory = "."',
                'pythonpath = ["src"]',
                "",
                "[project_run.limits]",
                "timeout_seconds = 30",
                'memory = "256m"',
                "cpus = 1.0",
                "pids = 64",
                "max_output_bytes = 4096",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


class FakeDocker(DockerClient):
    def preflight(self) -> str:
        return "test-daemon"

    def prepare_image(self, environment: object, run_dir: Path) -> str:
        del environment, run_dir
        return "sha256:local-image"

    def run(
        self,
        resolved: object,
        run_id: str,
        image_id: str,
        run_dir: Path,
    ) -> ContainerExecution:
        del resolved, run_id, image_id
        (run_dir / "pytest-report.json").write_text(
            json.dumps(
                {
                    "exitcode": 0,
                    "summary": {"passed": 2, "total": 2, "collected": 2},
                }
            ),
            encoding="utf-8",
        )
        return ContainerExecution(
            exit_code=0,
            termination=RunTermination.EXITED,
            stdout="two passed",
            stderr="",
            stdout_truncated=False,
            stderr_truncated=False,
        )


class BrokenDocker(FakeDocker):
    def preflight(self) -> str:
        raise ProjectRunnerError("daemon unavailable")


class TimeoutDocker(FakeDocker):
    def run(
        self,
        resolved: object,
        run_id: str,
        image_id: str,
        run_dir: Path,
    ) -> ContainerExecution:
        del resolved, run_id, image_id, run_dir
        return ContainerExecution(
            exit_code=None,
            termination=RunTermination.TIMEOUT,
            stdout="partial",
            stderr="",
            stdout_truncated=True,
            stderr_truncated=False,
        )


class MissingReportDocker(FakeDocker):
    def run(
        self,
        resolved: object,
        run_id: str,
        image_id: str,
        run_dir: Path,
    ) -> ContainerExecution:
        del resolved, run_id, image_id, run_dir
        return ContainerExecution(
            exit_code=0,
            termination=RunTermination.EXITED,
            stdout="looks green but has no report",
            stderr="",
            stdout_truncated=False,
            stderr_truncated=False,
        )


def test_config_rejects_unpinned_or_unsafe_values() -> None:
    base = {
        "target_root": "target",
        "revision": "a" * 40,
        "artifact_root": "artifacts",
        "environment": {
            "base_image": BASE_IMAGE,
            "dependency_pins": ["pytest==8.3.5"],
        },
        "test": {"argv": ["python", "-m", "pytest"]},
    }
    ProjectRunConfig.model_validate(base)

    with pytest.raises(ValidationError, match="sha256"):
        ProjectRunConfig.model_validate(
            {**base, "environment": {"base_image": "python:3.11", "dependency_pins": []}}
        )
    with pytest.raises(ValidationError, match="name==version"):
        ProjectRunConfig.model_validate(
            {
                **base,
                "environment": {
                    "base_image": BASE_IMAGE,
                    "dependency_pins": ["-r requirements.txt"],
                },
            }
        )
    with pytest.raises(ValidationError, match="python -m pytest"):
        ProjectRunConfig.model_validate(
            {**base, "test": {"argv": ["sh", "-c", "pytest"]}}
        )
    with pytest.raises(ValidationError, match="without '..'"):
        ProjectRunConfig.model_validate({**base, "target_root": "../target"})


def test_config_resolves_separate_target_and_output(tmp_path: Path) -> None:
    path = _config(tmp_path)
    resolved = load_run_config(path)
    assert resolved.target_root == tmp_path / "target"
    assert resolved.artifact_root == tmp_path / "artifacts"


def test_docker_command_has_runtime_isolation_and_no_host_fallback(tmp_path: Path) -> None:
    resolved = load_run_config(_config(tmp_path))
    run_dir = tmp_path / "artifacts" / "runs" / "run-test"
    run_dir.mkdir(parents=True)
    command = DockerClient.run_command(
        resolved, "run-test", "sha256:local-image", run_dir
    )

    expected_pairs = {
        "--network": "none",
        "--cap-drop": "ALL",
        "--security-opt": "no-new-privileges",
        "--pids-limit": "64",
        "--memory": "256m",
        "--cpus": "1.0",
    }
    for option, expected in expected_pairs.items():
        assert command[command.index(option) + 1] == expected
    assert "--read-only" in command
    assert f"{resolved.target_root}:/workspace:ro" in command
    assert f"{run_dir}:/output:rw" in command
    assert "PYTHONPATH=/workspace/src" in command
    assert "/var/run/docker.sock" not in " ".join(command)
    assert str(Path.home()) not in " ".join(command)


def test_bounded_output_discloses_truncation() -> None:
    buffer = _BoundedBuffer(4)
    buffer.read(io.BytesIO(b"abcdefgh"))
    assert buffer.text() == "abcd"
    assert buffer.truncated is True


def test_report_parser_validates_counts_and_process_status(tmp_path: Path) -> None:
    report = tmp_path / "report.json"
    report.write_text(
        json.dumps(
            {"exitcode": 1, "summary": {"passed": 2, "failed": 1, "total": 3}}
        ),
        encoding="utf-8",
    )
    summary, outcome = parse_pytest_report(report, 1)
    assert outcome == RunOutcome.FAILED
    assert summary.collected == 3
    assert summary.failed == 1

    with pytest.raises(ProjectRunnerError, match="does not match"):
        parse_pytest_report(report, 0)


def test_successful_runs_are_independent_and_persisted(tmp_path: Path) -> None:
    config = _config(tmp_path)
    runner = ProjectTestRunner(FakeDocker())
    first = runner.run(config)
    second = runner.run(config)

    assert first.outcome == RunOutcome.PASSED
    assert first.summary is not None and first.summary.collected == 2
    assert second.id != first.id
    with RunStore(tmp_path / "artifacts" / "runs.sqlite3") as store:
        assert [run.id for run in store.list()] == [first.id, second.id]
        assert store.get(first.id) == first


@pytest.mark.parametrize(
    ("docker", "outcome", "termination"),
    [
        (BrokenDocker(), RunOutcome.INFRASTRUCTURE_ERROR, RunTermination.INFRASTRUCTURE),
        (TimeoutDocker(), RunOutcome.TIMEOUT, RunTermination.TIMEOUT),
        (MissingReportDocker(), RunOutcome.MALFORMED_REPORT, RunTermination.EXITED),
    ],
)
def test_infrastructure_and_timeout_are_not_test_failures(
    tmp_path: Path,
    docker: DockerClient,
    outcome: RunOutcome,
    termination: RunTermination,
) -> None:
    run = ProjectTestRunner(docker).run(_config(tmp_path))
    assert run.outcome == outcome
    assert run.termination == termination
    assert run.summary is None
    with RunStore(tmp_path / "artifacts" / "runs.sqlite3") as store:
        assert store.get(run.id).outcome == outcome
