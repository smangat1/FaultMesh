"""Compile a deliberately small natural precondition subset into executable constraints."""

from __future__ import annotations

import ast
import re
from typing import Literal, TypeAlias

from faultmesh.schemas import ConstraintSpec, PropertySpec


class PreconditionCompilationError(ValueError):
    pass


_RANGE_SENTENCE = re.compile(
    r"^all arguments are integers in\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$",
    re.IGNORECASE,
)

ConstraintKind: TypeAlias = Literal["le", "lt", "ge", "gt", "eq", "ne"]


class PreconditionCompiler:
    """Translate explicit integer comparisons without evaluating model-authored code."""

    _operators: dict[type[ast.cmpop], ConstraintKind] = {
        ast.LtE: "le",
        ast.Lt: "lt",
        ast.GtE: "ge",
        ast.Gt: "gt",
        ast.Eq: "eq",
        ast.NotEq: "ne",
    }

    def compile(self, declarations: list[str], specification: PropertySpec) -> list[ConstraintSpec]:
        compiled: list[ConstraintSpec] = []
        for declaration in declarations:
            text = declaration.strip().strip("`").replace("≤", "<=").replace("≥", ">=")
            range_match = _RANGE_SENTENCE.fullmatch(text)
            if range_match:
                minimum, maximum = (int(value) for value in range_match.groups())
                if maximum < minimum:
                    raise PreconditionCompilationError(f"invalid declared range: {declaration}")
                for argument in specification.arguments:
                    compiled.extend(
                        [
                            ConstraintSpec(kind="ge", left=argument.name, right=minimum),
                            ConstraintSpec(kind="le", left=argument.name, right=maximum),
                        ]
                    )
                continue
            try:
                expression = ast.parse(text, mode="eval").body
            except SyntaxError as exc:
                raise PreconditionCompilationError(
                    f"precondition is not a supported integer comparison: {declaration}"
                ) from exc
            compiled.extend(self._expression(expression, specification, declaration))

        existing = list(specification.constraints)
        for constraint in compiled:
            if not self._covered(constraint, specification, existing):
                existing.append(constraint)
        specification.constraints = existing
        return existing

    def _expression(
        self, node: ast.expr, specification: PropertySpec, declaration: str
    ) -> list[ConstraintSpec]:
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            return [
                constraint
                for value in node.values
                for constraint in self._expression(value, specification, declaration)
            ]
        if not isinstance(node, ast.Compare):
            raise PreconditionCompilationError(
                f"precondition is not a comparison: {declaration}"
            )
        operands = [node.left, *node.comparators]
        result: list[ConstraintSpec] = []
        for left_node, operator, right_node in zip(
            operands[:-1], node.ops, operands[1:], strict=True
        ):
            kind = self._operators.get(type(operator))
            if kind is None:
                raise PreconditionCompilationError(
                    f"unsupported comparison operator in: {declaration}"
                )
            result.append(
                ConstraintSpec(
                    kind=kind,
                    left=self._operand(left_node, specification, declaration),
                    right=self._operand(right_node, specification, declaration),
                )
            )
        return result

    @staticmethod
    def _operand(node: ast.expr, specification: PropertySpec, declaration: str) -> str | int:
        names = {argument.name for argument in specification.arguments}
        if isinstance(node, ast.Name) and node.id in names:
            return node.id
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if (
            isinstance(node, ast.UnaryOp)
            and isinstance(node.op, ast.USub)
            and isinstance(node.operand, ast.Constant)
            and isinstance(node.operand.value, int)
        ):
            return -node.operand.value
        raise PreconditionCompilationError(
            f"precondition contains an unknown name or non-integer operand: {declaration}"
        )

    @staticmethod
    def _covered(
        constraint: ConstraintSpec,
        specification: PropertySpec,
        existing: list[ConstraintSpec],
    ) -> bool:
        if constraint in existing:
            return True
        strategies = {argument.name: argument.strategy for argument in specification.arguments}
        left, right, kind = constraint.left, constraint.right, constraint.kind
        if isinstance(left, str) and isinstance(right, int):
            strategy = strategies[left]
            if kind == "ge":
                return strategy.minimum >= right
            if kind == "gt":
                return strategy.minimum > right
            if kind == "le":
                return strategy.maximum <= right
            if kind == "lt":
                return strategy.maximum < right
        if isinstance(left, int) and isinstance(right, str):
            strategy = strategies[right]
            if kind == "le":
                return strategy.minimum >= left
            if kind == "lt":
                return strategy.minimum > left
            if kind == "ge":
                return strategy.maximum <= left
            if kind == "gt":
                return strategy.maximum < left
        return False
