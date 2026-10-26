from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from faultmesh.project_runner import RunOutcome, run_project_tests

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
def test_real_container_runs_pytest_without_changing_target(
    docker_shared_tmp_path: Path,
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
schema_version = "1.0"
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

    run = run_project_tests(config)

    assert run.outcome == RunOutcome.PASSED
    assert run.summary is not None and run.summary.collected == 1
    after = subprocess.run(
        ["git", "-C", str(target), "status", "--porcelain=v1"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert after == before
