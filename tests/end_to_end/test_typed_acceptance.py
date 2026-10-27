from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from faultmesh.analysis import ProjectAnalyzer
from faultmesh.api import AnalysisOptions, analyze_repository, reproduce_incident
from faultmesh.evidence import EvidenceStore
from faultmesh.inference.backends import BackendResult
from faultmesh.schemas import (
    ArgumentSpec,
    ExperimentOutcome,
    FunctionMetadata,
    IntegerListStrategy,
    PropertySpec,
    ResultLengthOracle,
    ResultListNondecreasingOracle,
    ResultListPreservesMultisetOracle,
    TextStrategy,
    VerificationManifest,
    VerificationStatus,
)
from faultmesh.verification import SpecificationValidator
from faultmesh.verification.worker import execute

FIXTURES = Path(__file__).parents[2] / "examples" / "typed_acceptance"


@dataclass
class InjectedProposalBackend:
    function: FunctionMetadata
    strategy: dict[str, Any]
    oracle: dict[str, Any]
    citation: str

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del json_schema
        lowered = prompt.casefold()
        for hidden in ("corrected", "evaluator assertion", "defect label", "pytest"):
            assert hidden not in lowered
        assert 'property_spec.schema_version to exactly "1.1"' in prompt
        reference = self.function.reference.model_dump(mode="json")
        payload = {
            "schema_version": "1.0",
            "hypotheses": [
                {
                    "description": "The documented result property may be violated.",
                    "source_references": [reference],
                    "preconditions": [],
                    "expected_behavior": self.citation,
                    "violation_condition": "The closed declarative oracle returns false.",
                    "confidence": 0.75,
                    "property_spec": {
                        "schema_version": "1.1",
                        "target": reference,
                        "qualified_name": self.function.qualified_name,
                        "arguments": [{"name": "value", "strategy": self.strategy}],
                        "constraints": [],
                        "oracle": self.oracle,
                        "oracle_explanation": self.citation,
                        "contract_citation": self.citation,
                        "evidence": [reference],
                        "max_examples": 100,
                        "seed": 19,
                    },
                }
            ],
        }
        return BackendResult(
            text=json.dumps(payload),
            backend="deterministic-injected-proposal",
            model="typed-acceptance-proposal-v1",
            hardware="test",
            latency_ms=0.0,
        )


def _function(repository: Path) -> FunctionMetadata:
    functions = ProjectAnalyzer().analyze(repository).functions
    assert len(functions) == 1
    return functions[0]


def _specification(
    function: FunctionMetadata,
    strategy: TextStrategy | IntegerListStrategy,
    oracle: Any,
    citation: str,
) -> PropertySpec:
    return PropertySpec(
        schema_version="1.1",
        target=function.reference,
        qualified_name=function.qualified_name,
        arguments=[ArgumentSpec(name="value", strategy=strategy)],
        oracle=oracle,
        oracle_explanation=citation,
        contract_citation=citation,
        evidence=[function.reference],
        max_examples=100,
        seed=19,
    )


SCENARIOS = [
    (
        "text_length",
        TextStrategy(alphabet="ab#🙂", minimum_length=0, maximum_length=4),
        ResultLengthOracle(kind="result_length_le_arg", argument="value"),
        "Return text with at most the original input length.",
    ),
    (
        "list_multiset",
        IntegerListStrategy(
            element_minimum=-2,
            element_maximum=2,
            minimum_length=0,
            maximum_length=4,
        ),
        ResultListPreservesMultisetOracle(argument="value"),
        "Return nondecreasing values while preserving every input item, including duplicates.",
    ),
    (
        "list_order",
        IntegerListStrategy(
            element_minimum=-2,
            element_maximum=2,
            minimum_length=0,
            maximum_length=4,
        ),
        ResultListNondecreasingOracle(),
        "Return the input values in nondecreasing order.",
    ),
]


@pytest.mark.parametrize(("scenario", "strategy", "oracle", "citation"), SCENARIOS)
def test_synthetic_typed_pairs_fail_replay_regress_and_pass_corrected(
    tmp_path: Path,
    scenario: str,
    strategy: TextStrategy | IntegerListStrategy,
    oracle: Any,
    citation: str,
) -> None:
    buggy = tmp_path / scenario / "buggy"
    corrected = tmp_path / scenario / "corrected"
    shutil.copytree(FIXTURES / scenario / "buggy", buggy)
    shutil.copytree(FIXTURES / scenario / "corrected", corrected)
    buggy_function = _function(buggy)
    backend = InjectedProposalBackend(
        function=buggy_function,
        strategy=strategy.model_dump(mode="json"),
        oracle=oracle.model_dump(mode="json"),
        citation=citation,
    )

    summary = analyze_repository(
        buggy,
        AnalysisOptions(
            allow_local_execution=True,
            inference_backend=backend,
            max_functions=1,
        ),
    )

    assert len(summary.incidents) == 1
    incident = summary.incidents[0]
    assert incident.artifacts is not None
    if scenario == "text_length":
        assert incident.counterexample == {"value": ""}
    elif scenario == "list_multiset":
        values = incident.counterexample["value"]
        assert isinstance(values, list)
        assert any(count > 1 for count in Counter(values).values())

    replayed = reproduce_incident(buggy, incident.id, allow_local_execution=True)
    assert replayed.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replayed.fingerprint_matched is True

    environment = dict(os.environ)
    environment["FAULTMESH_REPOSITORY"] = str(buggy)
    buggy_test = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", incident.artifacts.regression_test],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    assert buggy_test.returncode == 1, buggy_test.stdout + buggy_test.stderr
    environment["FAULTMESH_REPOSITORY"] = str(corrected)
    corrected_test = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", incident.artifacts.regression_test],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    assert corrected_test.returncode == 0, corrected_test.stdout + corrected_test.stderr

    corrected_function = _function(corrected)
    corrected_specification = _specification(
        corrected_function, strategy, oracle, citation
    )
    SpecificationValidator().validate(
        corrected_specification, ProjectAnalyzer().analyze(corrected)
    )
    corrected_search = execute(
        corrected,
        VerificationManifest(
            hypothesis_id=f"hyp-corrected-{scenario}",
            property_spec=corrected_specification,
            confirmation_runs=2,
        ),
    )
    corrected_replay = execute(
        corrected,
        VerificationManifest(
            hypothesis_id=f"hyp-corrected-replay-{scenario}",
            property_spec=corrected_specification,
            confirmation_runs=2,
            mode="replay",
            counterexample=incident.counterexample,
        ),
    )
    assert corrected_search.outcome == ExperimentOutcome.NO_VIOLATION
    assert corrected_replay.outcome == ExperimentOutcome.NO_VIOLATION


def test_invalid_property_against_correct_code_is_not_counted_as_a_bug(
    tmp_path: Path,
) -> None:
    corrected = tmp_path / "corrected"
    shutil.copytree(FIXTURES / "text_length" / "corrected", corrected)
    function = _function(corrected)
    unsupported_citation = "Return text with exactly the original input length."
    backend = InjectedProposalBackend(
        function=function,
        strategy=TextStrategy(
            alphabet="ab#🙂", minimum_length=0, maximum_length=4
        ).model_dump(mode="json"),
        oracle=ResultLengthOracle(
            kind="result_length_eq_arg", argument="value"
        ).model_dump(mode="json"),
        citation=unsupported_citation,
    )

    summary = analyze_repository(
        corrected,
        AnalysisOptions(
            allow_local_execution=True,
            inference_backend=backend,
            max_functions=1,
        ),
    )

    assert summary.incidents == []
    assert len(summary.hypothesis_ids) == 1
    with EvidenceStore(summary.evidence_database) as store:
        hypothesis = store.get_hypothesis(summary.hypothesis_ids[0])
    assert hypothesis.verification_status == VerificationStatus.UNSUPPORTED
    assert hypothesis.experiment_ids == []
