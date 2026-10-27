from __future__ import annotations

import pytest

from faultmesh.schemas import (
    ArgumentSpec,
    ConstraintSpec,
    IntegerStrategy,
    PropertySpec,
    ResultBoundOracle,
    ResultLengthOracle,
    SourceReference,
    TextStrategy,
)
from faultmesh.verification import PreconditionCompilationError, PreconditionCompiler


def _property_spec(*, minimum: int = 0, maximum: int = 100) -> PropertySpec:
    reference = SourceReference(
        path="src/example.py",
        start_line=1,
        end_line=3,
        content_hash="abc123",
    )
    return PropertySpec(
        target=reference,
        qualified_name="example.clamp",
        arguments=[
            ArgumentSpec(
                name=name,
                strategy=IntegerStrategy(minimum=minimum, maximum=maximum),
            )
            for name in ("value", "maximum")
        ],
        oracle=ResultBoundOracle(kind="result_le_arg", argument="maximum"),
        oracle_explanation="The result must not exceed maximum.",
        evidence=[reference],
    )


def test_compiles_chained_comparisons_and_skips_strategy_implied_bounds() -> None:
    specification = _property_spec()

    constraints = PreconditionCompiler().compile(
        ["0 <= value <= maximum", "maximum >= 0"], specification
    )

    assert constraints == [ConstraintSpec(kind="le", left="value", right="maximum")]
    assert specification.constraints == constraints


def test_compiles_model_range_sentence_without_duplicate_bounds() -> None:
    specification = _property_spec()

    constraints = PreconditionCompiler().compile(
        ["All arguments are integers in [0, 100]", "value <= maximum"],
        specification,
    )

    assert constraints == [ConstraintSpec(kind="le", left="value", right="maximum")]


@pytest.mark.parametrize(
    "declaration",
    [
        "maximum must be nonnegative",
        "unknown <= maximum",
        "__import__('os').system('touch /tmp/should-not-exist')",
    ],
)
def test_rejects_unsupported_or_non_declarative_preconditions(declaration: str) -> None:
    with pytest.raises(PreconditionCompilationError):
        PreconditionCompiler().compile([declaration], _property_spec())


@pytest.mark.parametrize(
    "declaration",
    [
        "All arguments are integers in [0, 100]",
        "len(value) <= 10",
        "value must use ASCII",
    ],
)
def test_typed_domains_reject_prose_or_integer_only_preconditions(
    declaration: str,
) -> None:
    reference = SourceReference(
        path="src/example.py",
        start_line=1,
        end_line=3,
        content_hash="abc123",
    )
    specification = PropertySpec(
        schema_version="1.1",
        target=reference,
        qualified_name="normalize",
        arguments=[
            ArgumentSpec(
                name="value",
                strategy=TextStrategy(
                    alphabet="ab",
                    minimum_length=0,
                    maximum_length=10,
                ),
            )
        ],
        oracle=ResultLengthOracle(kind="result_length_le_arg", argument="value"),
        oracle_explanation="Result length does not exceed input length.",
        contract_citation="Result length does not exceed input length.",
        evidence=[reference],
    )

    with pytest.raises(PreconditionCompilationError):
        PreconditionCompiler().compile([declaration], specification)

