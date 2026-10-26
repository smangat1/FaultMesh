from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from faultmesh.project_runner import (
    ObservationStatus,
    ReplayComparison,
    RunOutcome,
    RunStore,
    replay_failed_test,
    run_project_tests,
)
from faultmesh.project_runner.config import load_run_config

BASE_IMAGE = (
    "python:3.11-slim@sha256:"
    "b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377"
)


@pytest.fixture
def docker_shared_tmp_path() -> Iterator[Path]:
    # Colima shares /Users, but not macOS's /private pytest temp folder.
    parent = Path.home() if sys.platform == "darwin" else None
    with tempfile.TemporaryDirectory(prefix="faultmesh-container-", dir=parent) as path:
        yield Path(path)


@pytest.mark.container
@pytest.mark.skipif(
    os.environ.get("FAULTMESH_RUN_CONTAINER_TESTS") != "1",
    reason="set FAULTMESH_RUN_CONTAINER_TESTS=1 for the real Docker regression",
)
@pytest.mark.parametrize("observe", [False, True])
def test_real_container_runs_pytest_without_changing_target(
    docker_shared_tmp_path: Path,
    observe: bool,
) -> None:
    if shutil.which("docker") is None:
        pytest.fail("Docker CLI is required when container tests are enabled")
    target = docker_shared_tmp_path / "target"
    target.mkdir()
    (target / "test_sample.py").write_text(
        "def test_sample() -> None:\n    assert 2 + 2 == 4\n", encoding="utf-8"
    )
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "add", "test_sample.py"], check=True)
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
    before = subprocess.run(
        ["git", "-C", str(target), "status", "--porcelain=v1"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    config = docker_shared_tmp_path / "run.toml"
    config.write_text(
        f"""[project_run]
schema_version = "2.0"
target_root = "target"
revision = "{revision}"
artifact_root = "artifacts"

[project_run.environment]
base_image = "{BASE_IMAGE}"
dependency_pins = ["pytest==8.3.5", "pytest-json-report==1.5.0"]

[project_run.test]
argv = ["python", "-m", "pytest", "-q"]
working_directory = "."

[project_run.limits]
timeout_seconds = 120
memory = "256m"
cpus = 1.0
pids = 64
max_output_bytes = 65536
""",
        encoding="utf-8",
    )

    run = run_project_tests(config, observe=observe)

    assert run.outcome == RunOutcome.PASSED
    assert run.summary is not None and run.summary.collected == 1
    expected_status = ObservationStatus.COMPLETE if observe else ObservationStatus.NOT_REQUESTED
    assert run.observation_status == expected_status, run.model_dump_json(indent=2)
    if observe:
        resolved = load_run_config(config)
        with RunStore(resolved.artifact_root / "runs.sqlite3") as store:
            test = store.get_test(run.id, "test_sample.py::test_sample")
        assert test.observation is not None
        assert any(symbol.qualified_name == "test_sample" for symbol in test.observation.symbols)
    after = subprocess.run(
        ["git", "-C", str(target), "status", "--porcelain=v1"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert after == before


@pytest.mark.container
@pytest.mark.skipif(
    os.environ.get("FAULTMESH_RUN_CONTAINER_TESTS") != "1",
    reason="set FAULTMESH_RUN_CONTAINER_TESTS=1 for the real Docker regression",
)
def test_real_container_replays_one_parameterized_failure(
    docker_shared_tmp_path: Path,
) -> None:
    target = docker_shared_tmp_path / "target"
    target.mkdir()
    (target / "test_sample.py").write_text(
        "import pytest\n\n"
        "@pytest.mark.parametrize('value', [1, 2])\n"
        "def test_value(value: int) -> None:\n"
        "    assert value == 1\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "add", "test_sample.py"], check=True)
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
    config = docker_shared_tmp_path / "run.toml"
    config.write_text(
        f"""[project_run]
schema_version = "2.0"
target_root = "target"
revision = "{revision}"
artifact_root = "artifacts"

[project_run.environment]
base_image = "{BASE_IMAGE}"
dependency_pins = ["pytest==8.3.5", "pytest-json-report==1.5.0"]

[project_run.test]
argv = ["python", "-m", "pytest", "-q"]
working_directory = "."

[project_run.limits]
timeout_seconds = 120
memory = "256m"
cpus = 1.0
pids = 64
max_output_bytes = 65536
""",
        encoding="utf-8",
    )
    parent = run_project_tests(config, observe=True)
    node_id = "test_sample.py::test_value[2]"
    replay = replay_failed_test(config, parent.id, node_id)

    assert parent.outcome == RunOutcome.FAILED
    assert replay.id != parent.id
    assert replay.test_case_count == 1
    assert replay.replay is not None
    assert replay.replay.parent_run_id == parent.id
    assert replay.replay.parent_test_id == node_id
    assert replay.replay.comparison == ReplayComparison.SAME_FAILURE
