import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from faultmesh.api import AnalysisOptions, analyze_repository
from faultmesh.sandbox import DockerSandbox, SandboxError
from faultmesh.schemas import (
    ArgumentSpec,
    ExperimentOutcome,
    ExperimentResult,
    IntegerStrategy,
    PropertySpec,
    ResultBoundOracle,
    SourceReference,
    VerificationManifest,
)

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def test_analysis_refuses_implicit_host_execution_without_docker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = tmp_path / "project"
    shutil.copytree(EXAMPLE, repository, ignore=shutil.ignore_patterns(".faultmesh"))
    monkeypatch.setattr(DockerSandbox, "available", staticmethod(lambda: False))
    with pytest.raises(SandboxError, match="allow-local-execution"):
        analyze_repository(repository, AnalysisOptions(model="heuristic"))


def test_docker_runner_uses_production_isolation_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = tmp_path / "project"
    repository.mkdir()
    reference = SourceReference(path="target.py", start_line=1, end_line=2, content_hash="abc")
    manifest = VerificationManifest(
        hypothesis_id="hyp-sandbox-policy",
        property_spec=PropertySpec(
            target=reference,
            qualified_name="bounded",
            arguments=[
                ArgumentSpec(
                    name="maximum",
                    strategy=IntegerStrategy(minimum=0, maximum=10),
                )
            ],
            oracle=ResultBoundOracle(kind="result_le_arg", argument="maximum"),
            oracle_explanation="Result must not exceed maximum.",
            evidence=[reference],
        ),
    )
    result = ExperimentResult(
        hypothesis_id=manifest.hypothesis_id,
        outcome=ExperimentOutcome.NO_VIOLATION,
        observed="no violation found",
        expected=manifest.property_spec.oracle_explanation,
        seed=manifest.property_spec.seed,
    )
    observed_command: list[str] = []

    def completed(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        del kwargs
        observed_command.extend(args[0])
        return subprocess.CompletedProcess(args[0], 0, result.model_dump_json(), "")

    monkeypatch.setattr(DockerSandbox, "available", staticmethod(lambda: True))
    monkeypatch.setattr(subprocess, "run", completed)

    actual = DockerSandbox().run(repository, manifest)

    assert actual.outcome == ExperimentOutcome.NO_VIOLATION
    expected_pairs = {
        "--network": "none",
        "--cap-drop": "ALL",
        "--security-opt": "no-new-privileges",
        "--pids-limit": "64",
        "--memory": "512m",
        "--cpus": "1.0",
        "--user": "65534:65534",
        "--tmpfs": "/tmp:rw,noexec,nosuid,size=64m",
        "--workdir": "/workspace",
    }
    for option, value in expected_pairs.items():
        position = observed_command.index(option)
        assert observed_command[position + 1] == value
    assert "--rm" in observed_command
    assert "--read-only" in observed_command
    repository_mount = f"{repository.resolve()}:/workspace:ro"
    assert repository_mount in observed_command
    manifest_mount = next(
        item for item in observed_command if item.endswith(":/job/manifest.json:ro")
    )
    assert manifest_mount.startswith(str(repository.resolve() / ".faultmesh"))

