from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from faultmesh.analysis import ProjectAnalyzer
from faultmesh.schemas import (
    ArgumentSpec,
    ExperimentOutcome,
    IntegerListStrategy,
    IntegerStrategy,
    NoExceptionOracle,
    PropertySpec,
    ResultBoundOracle,
    ResultLengthOracle,
    ResultListNondecreasingOracle,
    ResultListPreservesMultisetOracle,
    SourceReference,
    TextStrategy,
    VerificationManifest,
)
from faultmesh.verification import SpecificationError, SpecificationValidator
from faultmesh.verification.worker import execute


def _reference(repository: Path, source: str) -> SourceReference:
    (repository / "target.py").write_text(source, encoding="utf-8")
    return SourceReference(
        path="target.py",
        start_line=1,
        end_line=len(source.splitlines()),
        content_hash=hashlib.sha256(source.encode()).hexdigest(),
    )


def _typed_spec(
    repository: Path,
    source: str,
    *,
    strategy: TextStrategy | IntegerListStrategy,
    oracle: Any,
    citation: str,
    name: str = "target",
) -> PropertySpec:
    reference = _reference(repository, source)
    return PropertySpec(
        schema_version="1.1",
        target=reference,
        qualified_name=name,
        arguments=[ArgumentSpec(name="value", strategy=strategy)],
        oracle=oracle,
        oracle_explanation=citation,
        contract_citation=citation,
        evidence=[reference],
        max_examples=100,
        seed=7,
    )


def _run(
    repository: Path,
    specification: PropertySpec,
    *,
    mode: str = "search",
    counterexample: dict[str, object] | None = None,
) -> Any:
    return execute(
        repository,
        VerificationManifest(
            hypothesis_id="hyp-typed-unit",
            property_spec=specification,
            confirmation_runs=2,
            mode=mode,
            counterexample=counterexample,
        ),
    )


def test_old_integer_manifest_round_trips_without_new_fields() -> None:
    payload = {
        "schema_version": "1.0",
        "target": {
            "path": "target.py",
            "start_line": 1,
            "end_line": 2,
            "content_hash": "abc",
        },
        "qualified_name": "bounded",
        "arguments": [
            {
                "name": "value",
                "strategy": {"kind": "integers", "minimum": 0, "maximum": 10},
            }
        ],
        "constraints": [],
        "oracle": {"kind": "result_le_arg", "argument": "value"},
        "oracle_explanation": "result does not exceed value",
        "evidence": [
            {
                "path": "target.py",
                "start_line": 1,
                "end_line": 2,
                "content_hash": "abc",
            }
        ],
        "max_examples": 200,
        "seed": 1,
    }

    restored = PropertySpec.model_validate_json(json.dumps(payload))

    assert restored.model_dump(mode="json") == payload

    manifest_payload = {
        "schema_version": "1.0",
        "hypothesis_id": "hyp-old-integer",
        "property_spec": payload,
        "confirmation_runs": 3,
        "mode": "replay",
        "counterexample": {"value": 0},
    }
    manifest = VerificationManifest.model_validate_json(json.dumps(manifest_payload))
    assert manifest.model_dump(mode="json") == manifest_payload


@pytest.mark.parametrize(
    ("factory", "match"),
    [
        (lambda: TextStrategy(alphabet="aa"), "unique"),
        (
            lambda: TextStrategy(alphabet="a", minimum_length=2, maximum_length=1),
            "maximum_length",
        ),
        (
            lambda: IntegerListStrategy(element_minimum=2, element_maximum=1),
            "element_maximum",
        ),
        (
            lambda: IntegerListStrategy(minimum_length=2, maximum_length=1),
            "maximum_length",
        ),
    ],
)
def test_typed_strategy_bounds_are_strict(factory: Any, match: str) -> None:
    with pytest.raises(ValidationError, match=match):
        factory()


def test_unknown_fields_and_invalid_oracle_strategy_pairs_are_rejected() -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        TextStrategy.model_validate({"kind": "text", "alphabet": "ab", "unknown": 1})

    reference = SourceReference(path="target.py", start_line=1, end_line=2, content_hash="x")
    with pytest.raises(ValidationError, match="result-length oracle"):
        PropertySpec(
            schema_version="1.1",
            target=reference,
            qualified_name="target",
            arguments=[ArgumentSpec(name="value", strategy=IntegerStrategy())],
            oracle=ResultLengthOracle(kind="result_length_le_arg", argument="value"),
            oracle_explanation="length contract",
            contract_citation="length contract",
            evidence=[reference],
        )
    with pytest.raises(ValidationError, match="integer-list argument"):
        PropertySpec(
            schema_version="1.1",
            target=reference,
            qualified_name="target",
            arguments=[ArgumentSpec(name="value", strategy=TextStrategy(alphabet="ab"))],
            oracle=ResultListPreservesMultisetOracle(argument="value"),
            oracle_explanation="multiset contract",
            contract_citation="multiset contract",
            evidence=[reference],
        )


@pytest.mark.parametrize(
    "counterexample",
    [
        {},
        {"value": "", "extra": ""},
        {"value": 1},
        {"value": "x"},
        {"value": "aaa"},
    ],
)
def test_text_replay_uses_exact_declared_domain(
    tmp_path: Path, counterexample: dict[str, object]
) -> None:
    citation = "Return text with the same length."
    specification = _typed_spec(
        tmp_path,
        f'def target(value: str) -> str:\n    """{citation}"""\n    return value\n',
        strategy=TextStrategy(
            alphabet="a🙂",
            minimum_length=0,
            maximum_length=2,
        ),
        oracle=ResultLengthOracle(kind="result_length_eq_arg", argument="value"),
        citation=citation,
    )

    result = _run(tmp_path, specification, mode="replay", counterexample=counterexample)

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "declared property input domain" in result.observed


@pytest.mark.parametrize("counterexample", [{"value": ""}, {"value": "a🙂"}])
def test_text_replay_accepts_empty_and_unicode_boundary_values(
    tmp_path: Path, counterexample: dict[str, object]
) -> None:
    citation = "Return text with the same length."
    specification = _typed_spec(
        tmp_path,
        f'def target(value: str) -> str:\n    """{citation}"""\n    return value\n',
        strategy=TextStrategy(alphabet="a🙂", minimum_length=0, maximum_length=2),
        oracle=ResultLengthOracle(kind="result_length_eq_arg", argument="value"),
        citation=citation,
    )

    result = _run(tmp_path, specification, mode="replay", counterexample=counterexample)

    assert result.outcome == ExperimentOutcome.NO_VIOLATION


@pytest.mark.parametrize(
    "counterexample",
    [
        {"value": [True]},
        {"value": [3]},
        {"value": [0, 0, 0, 0]},
        {"value": "not-a-list"},
    ],
)
def test_integer_list_replay_rejects_wrong_types_and_bounds(
    tmp_path: Path, counterexample: dict[str, object]
) -> None:
    citation = "Return values in nondecreasing order."
    specification = _typed_spec(
        tmp_path,
        (
            f'def target(value: list[int]) -> list[int]:\n    """{citation}"""\n'
            "    return sorted(value)\n"
        ),
        strategy=IntegerListStrategy(
            element_minimum=-2,
            element_maximum=2,
            minimum_length=0,
            maximum_length=3,
        ),
        oracle=ResultListNondecreasingOracle(),
        citation=citation,
    )

    result = _run(tmp_path, specification, mode="replay", counterexample=counterexample)

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "declared property input domain" in result.observed


def test_text_search_shrinks_and_replays_off_by_one_violation(tmp_path: Path) -> None:
    citation = "Return text with at most the original input length."
    specification = _typed_spec(
        tmp_path,
        (
            f'def target(value: str) -> str:\n    """{citation}"""\n'
            '    return value + "#"\n'
        ),
        strategy=TextStrategy(alphabet="a🙂#", minimum_length=0, maximum_length=4),
        oracle=ResultLengthOracle(kind="result_length_le_arg", argument="value"),
        citation=citation,
    )

    searched = _run(tmp_path, specification)
    replayed = _run(
        tmp_path,
        specification,
        mode="replay",
        counterexample=searched.counterexample,
    )

    assert searched.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert searched.counterexample == {"value": ""}
    assert replayed.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replayed.failure_fingerprint == searched.failure_fingerprint


def test_list_multiset_search_preserves_duplicate_semantics(tmp_path: Path) -> None:
    citation = "Preserve every input item, including duplicates."
    specification = _typed_spec(
        tmp_path,
        (
            f'def target(value: list[int]) -> list[int]:\n    """{citation}"""\n'
            "    return sorted(set(value))\n"
        ),
        strategy=IntegerListStrategy(
            element_minimum=0,
            element_maximum=1,
            minimum_length=0,
            maximum_length=4,
        ),
        oracle=ResultListPreservesMultisetOracle(argument="value"),
        citation=citation,
    )

    searched = _run(tmp_path, specification)
    replayed = _run(
        tmp_path,
        specification,
        mode="replay",
        counterexample=searched.counterexample,
    )

    assert searched.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert searched.counterexample == {"value": [0, 0]}
    assert replayed.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert replayed.failure_fingerprint == searched.failure_fingerprint


def test_oracle_return_type_mismatch_is_a_harness_diagnostic(tmp_path: Path) -> None:
    citation = "Return values in nondecreasing order."
    specification = _typed_spec(
        tmp_path,
        f'def target(value: list[int]) -> list[int]:\n    """{citation}"""\n    return "bad"\n',
        strategy=IntegerListStrategy(maximum_length=2),
        oracle=ResultListNondecreasingOracle(),
        citation=citation,
    )

    result = _run(tmp_path, specification)

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "return-type combination" in result.observed


def test_target_exception_classification_is_preserved_for_typed_inputs(tmp_path: Path) -> None:
    citation = "The call completes without an exception."
    specification = _typed_spec(
        tmp_path,
        (
            f'def target(value: str) -> str:\n    """{citation}"""\n'
            '    raise ValueError("boom")\n'
        ),
        strategy=TextStrategy(alphabet="a", maximum_length=1),
        oracle=NoExceptionOracle(),
        citation=citation,
    )

    result = _run(tmp_path, specification)

    assert result.outcome == ExperimentOutcome.TARGET_EXCEPTION
    assert result.observed == "ValueError: boom"


def test_serialized_list_input_size_is_bounded(tmp_path: Path) -> None:
    citation = "Return values in nondecreasing order."
    huge = 10**500
    specification = _typed_spec(
        tmp_path,
        (
            f'def target(value: list[int]) -> list[int]:\n    """{citation}"""\n'
            "    return sorted(value)\n"
        ),
        strategy=IntegerListStrategy(
            element_minimum=-huge,
            element_maximum=huge,
            minimum_length=0,
            maximum_length=64,
        ),
        oracle=ResultListNondecreasingOracle(),
        citation=citation,
    )

    result = _run(
        tmp_path,
        specification,
        mode="replay",
        counterexample={"value": [huge] * 40},
    )

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "declared property input domain" in result.observed


@pytest.mark.parametrize("annotation", ["list", "tuple[int, ...]", "typing.List[int]"])
def test_annotation_validation_is_structural_and_narrow(
    tmp_path: Path, annotation: str
) -> None:
    citation = "Return values in nondecreasing order."
    source = (
        f"def target(value: {annotation}) -> list[int]:\n"
        f'    """{citation}"""\n'
        "    return sorted(value)\n"
    )
    specification = _typed_spec(
        tmp_path,
        source,
        strategy=IntegerListStrategy(maximum_length=2),
        oracle=ResultListNondecreasingOracle(),
        citation=citation,
    )
    project = ProjectAnalyzer().analyze(tmp_path)

    with pytest.raises(SpecificationError, match=r"requires annotation 'list\[int\]'"):
        SpecificationValidator().validate(specification, project)


def test_generator_and_uncited_contracts_are_rejected(tmp_path: Path) -> None:
    citation = "Return values in nondecreasing order."
    generator_source = (
        "def target(value: list[int]) -> list[int]:\n"
        f'    """{citation}"""\n'
        "    yield from value\n"
    )
    generator_spec = _typed_spec(
        tmp_path,
        generator_source,
        strategy=IntegerListStrategy(maximum_length=2),
        oracle=ResultListNondecreasingOracle(),
        citation=citation,
    )
    with pytest.raises(SpecificationError, match="generator"):
        SpecificationValidator().validate(generator_spec, ProjectAnalyzer().analyze(tmp_path))

    ordinary_source = (
        "def target(value: list[int]) -> list[int]:\n"
        '    """Return the values."""\n'
        "    return sorted(value)\n"
    )
    uncited_spec = _typed_spec(
        tmp_path,
        ordinary_source,
        strategy=IntegerListStrategy(maximum_length=2),
        oracle=ResultListNondecreasingOracle(),
        citation="Return values in nondecreasing order.",
    )
    with pytest.raises(SpecificationError, match="citation"):
        SpecificationValidator().validate(uncited_spec, ProjectAnalyzer().analyze(tmp_path))


def test_integer_oracle_keeps_strict_bool_return_rejection(tmp_path: Path) -> None:
    source = (
        "def target(value: int) -> int:\n"
        '    """Return a value no greater than the input."""\n'
        "    return True\n"
    )
    reference = _reference(tmp_path, source)
    specification = PropertySpec(
        schema_version="1.0",
        target=reference,
        qualified_name="target",
        arguments=[
            ArgumentSpec(name="value", strategy=IntegerStrategy(minimum=0, maximum=1))
        ],
        oracle=ResultBoundOracle(kind="result_le_arg", argument="value"),
        oracle_explanation="integer result",
        evidence=[reference],
    )

    result = _run(tmp_path, specification, mode="replay", counterexample={"value": 0})

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "expected int, got bool" in result.observed
