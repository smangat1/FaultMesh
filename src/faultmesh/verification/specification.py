"""Semantic validation for the closed executable property language."""

from __future__ import annotations

import re

from faultmesh.schemas import (
    FunctionMetadata,
    IntegerListStrategy,
    IntegerStrategy,
    NoExceptionOracle,
    ProjectIndex,
    PropertySpec,
    ResultBetweenOracle,
    ResultBoundOracle,
    ResultLengthOracle,
    ResultListNondecreasingOracle,
    ResultListPreservesMultisetOracle,
    TextStrategy,
)


class SpecificationError(ValueError):
    pass


def _normalized_contract(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _strategy_annotation(strategy: IntegerStrategy | TextStrategy | IntegerListStrategy) -> str:
    if isinstance(strategy, IntegerStrategy):
        return "int"
    if isinstance(strategy, TextStrategy):
        return "str"
    return "list[int]"


class SpecificationValidator:
    def validate(self, specification: PropertySpec, project: ProjectIndex) -> FunctionMetadata:
        matches = [
            function
            for function in project.functions
            if function.reference.path == specification.target.path
            and function.qualified_name == specification.qualified_name
        ]
        if len(matches) != 1:
            raise SpecificationError(
                "property target does not uniquely identify an indexed function"
            )
        function = matches[0]
        if function.is_method or "." in function.qualified_name:
            raise SpecificationError("only top-level functions are supported")
        if function.is_async:
            raise SpecificationError("async functions are unsupported")
        if function.is_generator:
            raise SpecificationError("generator functions are unsupported")
        if specification.target.content_hash != function.reference.content_hash:
            raise SpecificationError("property target hash does not match the scanned source")
        if specification.target.start_line != function.reference.start_line:
            raise SpecificationError("property target line does not match the indexed function")

        parameters = {
            parameter.name: parameter
            for parameter in function.parameters
            if parameter.kind in {"positional", "keyword_only"}
        }
        unsupported = [
            parameter.name
            for parameter in function.parameters
            if parameter.kind in {"var_positional", "var_keyword"}
        ]
        if unsupported:
            raise SpecificationError(f"variadic parameters are unsupported: {unsupported}")
        argument_names = {argument.name for argument in specification.arguments}
        required = {name for name, parameter in parameters.items() if not parameter.has_default}
        if not required.issubset(argument_names) or not argument_names.issubset(parameters):
            raise SpecificationError(
                f"property arguments {sorted(argument_names)} do not match function parameters "
                f"{sorted(parameters)}"
            )

        strategies = {argument.name: argument.strategy for argument in specification.arguments}
        for argument in specification.arguments:
            annotation = parameters[argument.name].annotation
            expected = _strategy_annotation(argument.strategy)
            if isinstance(argument.strategy, IntegerStrategy) and annotation is None:
                continue  # schema 1.0 compatibility for historically unannotated integers
            if annotation != expected:
                raise SpecificationError(
                    f"{argument.strategy.kind} strategy requires annotation {expected!r} for "
                    f"{argument.name}; found {annotation!r}"
                )

        for constraint in specification.constraints:
            for operand in (constraint.left, constraint.right):
                if isinstance(operand, str) and operand not in argument_names:
                    raise SpecificationError(f"constraint references unknown argument: {operand}")
                if isinstance(operand, str) and not isinstance(
                    strategies[operand], IntegerStrategy
                ):
                    raise SpecificationError("comparisons are restricted to integer operands")

        oracle = specification.oracle
        if isinstance(oracle, ResultBoundOracle) and oracle.argument not in argument_names:
            raise SpecificationError(f"oracle references unknown argument: {oracle.argument}")
        if isinstance(oracle, ResultBetweenOracle) and (
            oracle.lower_argument not in argument_names
            or oracle.upper_argument not in argument_names
        ):
            raise SpecificationError("between oracle references an unknown argument")
        if isinstance(
            oracle, (ResultLengthOracle, ResultListPreservesMultisetOracle)
        ) and oracle.argument not in argument_names:
            raise SpecificationError(f"oracle references unknown argument: {oracle.argument}")

        expected_return: str | None
        if isinstance(oracle, (ResultBoundOracle, ResultBetweenOracle)):
            expected_return = "int"
        elif isinstance(oracle, ResultLengthOracle):
            expected_return = _strategy_annotation(strategies[oracle.argument])
        elif isinstance(
            oracle, (ResultListNondecreasingOracle, ResultListPreservesMultisetOracle)
        ):
            expected_return = "list[int]"
        elif isinstance(oracle, NoExceptionOracle):
            expected_return = None
        else:  # pragma: no cover - the discriminated schema keeps this exhaustive
            raise SpecificationError("unsupported oracle")
        legacy_unannotated_integer = (
            specification.schema_version == "1.0"
            and expected_return == "int"
            and function.return_annotation is None
        )
        if (
            expected_return is not None
            and function.return_annotation != expected_return
            and not legacy_unannotated_integer
        ):
            raise SpecificationError(
                f"oracle requires return annotation {expected_return!r}; found "
                f"{function.return_annotation!r}"
            )

        if specification.schema_version == "1.1":
            citation = _normalized_contract(specification.contract_citation or "")
            docstring = _normalized_contract(function.docstring or "")
            if citation not in docstring:
                raise SpecificationError(
                    "contract citation is not present in the target function docstring"
                )

        for evidence in specification.evidence:
            known = [
                candidate
                for candidate in project.functions
                if candidate.reference.path == evidence.path
                and candidate.reference.start_line == evidence.start_line
            ]
            if not known or evidence.content_hash != known[0].reference.content_hash:
                raise SpecificationError(
                    "property evidence is stale or not present in the project index"
                )
        return function
