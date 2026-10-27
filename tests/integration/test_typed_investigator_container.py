from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from faultmesh.sandbox import DockerSandbox
from faultmesh.schemas import (
    ArgumentSpec,
    ExperimentOutcome,
    IntegerListStrategy,
    PropertySpec,
    ResultLengthOracle,
    ResultListPreservesMultisetOracle,
    SourceReference,
    TextStrategy,
    VerificationManifest,
)

FIXTURES = Path(__file__).parents[2] / "examples" / "typed_acceptance"


@pytest.fixture
def docker_shared_tmp_path() -> Iterator[Path]:
    parent = Path.home() if sys.platform == "darwin" else None
    with tempfile.TemporaryDirectory(prefix="faultmesh-typed-container-", dir=parent) as path:
        yield Path(path)


@pytest.mark.container
@pytest.mark.skipif(
    os.environ.get("FAULTMESH_RUN_CONTAINER_TESTS") != "1",
    reason="set FAULTMESH_RUN_CONTAINER_TESTS=1 for the real Docker regression",
)
@pytest.mark.parametrize(
    ("scenario", "relative_path", "qualified_name", "strategy", "oracle", "citation"),
    [
        (
            "text_length",
            "src/typed_acceptance/text_contract.py",
            "remove_terminal_marker",
            TextStrategy(alphabet="ab#🙂", maximum_length=8),
            ResultLengthOracle(kind="result_length_le_arg", argument="value"),
            "Return text with at most the original input length.",
        ),
        (
            "list_multiset",
            "src/typed_acceptance/list_contract.py",
            "sort_preserving_values",
            IntegerListStrategy(
                element_minimum=-3,
                element_maximum=3,
                maximum_length=8,
            ),
            ResultListPreservesMultisetOracle(argument="value"),
            "Return nondecreasing values while preserving every input item, including duplicates.",
        ),
    ],
)
def test_typed_search_and_replay_in_locked_docker_worker(
    docker_shared_tmp_path: Path,
    scenario: str,
    relative_path: str,
    qualified_name: str,
    strategy: TextStrategy | IntegerListStrategy,
    oracle: Any,
    citation: str,
) -> None:
    if shutil.which("docker") is None:
        pytest.fail("Docker CLI is required when container tests are enabled")
    repository = docker_shared_tmp_path / scenario
    shutil.copytree(FIXTURES / scenario / "buggy", repository)
    source = (repository / relative_path).read_text(encoding="utf-8")
    reference = SourceReference(
        path=relative_path,
        start_line=1,
        end_line=len(source.splitlines()),
        content_hash=hashlib.sha256(source.encode()).hexdigest(),
    )
    specification = PropertySpec(
        schema_version="1.1",
        target=reference,
        qualified_name=qualified_name,
        arguments=[ArgumentSpec(name="value", strategy=strategy)],
        oracle=oracle,
        oracle_explanation=citation,
        contract_citation=citation,
        evidence=[reference],
        max_examples=100,
        seed=23,
    )
    sandbox = DockerSandbox(timeout_seconds=60)

    searched = sandbox.run(
        repository,
        VerificationManifest(
            hypothesis_id=f"docker-{scenario}",
            property_spec=specification,
            confirmation_runs=3,
        ),
    )
    replayed = sandbox.run(
        repository,
        VerificationManifest(
            hypothesis_id=f"docker-{scenario}",
            property_spec=specification,
            confirmation_runs=3,
            mode="replay",
            counterexample=searched.counterexample,
        ),
    )

    assert searched.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replayed.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replayed.counterexample == searched.counterexample
    assert replayed.failure_fingerprint == searched.failure_fingerprint
    assert replayed.confirming_failures == replayed.confirmation_runs == 3
