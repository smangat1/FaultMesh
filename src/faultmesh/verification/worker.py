"""Isolated Hypothesis search worker.

This module is invoked in a subprocess or container. It accepts only a validated declarative
manifest and prints one ExperimentResult JSON object.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import platform
import random
import sys
import time
import traceback
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from hypothesis import HealthCheck, find, settings
from hypothesis import strategies as st
from hypothesis.errors import NoSuchExample, Unsatisfiable

from faultmesh.schemas import (
    MAX_INTEGER_LIST_LENGTH,
    MAX_SERIALIZED_INPUT_BYTES,
    MAX_TEXT_LENGTH,
    ExperimentOutcome,
    ExperimentResult,
    IntegerListStrategy,
    IntegerStrategy,
    PropertySpec,
    ResultBetweenOracle,
    ResultBoundOracle,
    ResultLengthOracle,
    ResultListNondecreasingOracle,
    ResultListPreservesMultisetOracle,
    TextStrategy,
    VerificationManifest,
)


def _safe_target(repository: Path, relative: str) -> Path:
    root = repository.resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("target source escapes repository") from exc
    if not target.is_file():
        raise FileNotFoundError(f"target source does not exist: {relative}")
    return target


def _load_function(
    repository: Path, specification: PropertySpec
) -> tuple[Callable[..., Any], str, str]:
    target = _safe_target(repository, specification.target.path)
    expected_hash = specification.target.content_hash
    if expected_hash is None:
        raise ValueError("target source reference has no content hash")
    actual_hash = hashlib.sha256(target.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError("target source content hash changed after static analysis")
    import_roots = [repository.resolve(), repository.resolve() / "src", target.parent]
    for import_root in reversed(import_roots):
        if import_root.is_dir() and str(import_root) not in sys.path:
            sys.path.insert(0, str(import_root))
    output, errors = io.StringIO(), io.StringIO()
    module_name = f"_faultmesh_target_{hashlib.sha256(str(target).encode()).hexdigest()[:12]}"
    module_spec = importlib.util.spec_from_file_location(module_name, target)
    if module_spec is None or module_spec.loader is None:
        raise ImportError(f"could not create import spec for {target}")
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[module_name] = module
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            module_spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    function: Any = module
    for part in specification.qualified_name.split("."):
        function = getattr(function, part)
    if not callable(function):
        raise TypeError(f"target is not callable: {specification.qualified_name}")
    return function, output.getvalue(), errors.getvalue()


def _operand(value: str | int, arguments: dict[str, Any]) -> Any:
    return arguments[value] if isinstance(value, str) else value


def _preconditions(specification: PropertySpec, arguments: dict[str, Any]) -> bool:
    operations = {
        "le": lambda left, right: left <= right,
        "lt": lambda left, right: left < right,
        "ge": lambda left, right: left >= right,
        "gt": lambda left, right: left > right,
        "eq": lambda left, right: left == right,
        "ne": lambda left, right: left != right,
    }
    return all(
        operations[constraint.kind](
            _operand(constraint.left, arguments), _operand(constraint.right, arguments)
        )
        for constraint in specification.constraints
    )


def _serialized_size(arguments: dict[str, Any]) -> int:
    return len(
        json.dumps(arguments, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _value_in_strategy(value: Any, strategy: object) -> bool:
    if isinstance(strategy, IntegerStrategy):
        return type(value) is int and strategy.minimum <= value <= strategy.maximum
    if isinstance(strategy, TextStrategy):
        return (
            type(value) is str
            and strategy.minimum_length <= len(value) <= strategy.maximum_length
            and all(character in strategy.alphabet for character in value)
        )
    if isinstance(strategy, IntegerListStrategy):
        return (
            type(value) is list
            and strategy.minimum_length <= len(value) <= strategy.maximum_length
            and all(
                type(item) is int
                and strategy.element_minimum <= item <= strategy.element_maximum
                for item in value
            )
        )
    return False


def _in_domain(specification: PropertySpec, arguments: dict[str, Any]) -> bool:
    if set(arguments) != {argument.name for argument in specification.arguments}:
        return False
    if _serialized_size(arguments) > MAX_SERIALIZED_INPUT_BYTES:
        return False
    for argument in specification.arguments:
        if not _value_in_strategy(arguments[argument.name], argument.strategy):
            return False
    return _preconditions(specification, arguments)


def _bounded_repr(value: Any, *, limit: int = 2_000) -> str:
    rendered = repr(value)
    return rendered if len(rendered) <= limit else rendered[:limit] + "…"


def _supported_integer_list(value: Any) -> bool:
    return (
        type(value) is list
        and len(value) <= MAX_INTEGER_LIST_LENGTH
        and all(type(item) is int for item in value)
        and len(json.dumps(value, separators=(",", ":")).encode("utf-8"))
        <= MAX_SERIALIZED_INPUT_BYTES
    )


def _supported_general_result(value: Any) -> bool:
    if value is None or type(value) is int:
        return True
    if type(value) is str:
        return len(value) <= MAX_TEXT_LENGTH
    return _supported_integer_list(value)


def _harness_diagnostic(
    result: Any, expected_type: str
) -> tuple[bool, ExperimentOutcome, str, str]:
    return (
        False,
        ExperimentOutcome.HARNESS_ERROR,
        f"unsupported oracle/return-type combination: expected {expected_type}, got "
        f"{type(result).__name__}",
        "",
    )


def _evaluate(
    function: Callable[..., Any], specification: PropertySpec, arguments: dict[str, Any]
) -> tuple[bool, ExperimentOutcome, str, str]:
    output, errors = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            result = function(**arguments)
    except Exception as exc:  # target repository exceptions are data here
        observed = f"{type(exc).__name__}: {exc}"
        trace = traceback.format_exc()
        return True, ExperimentOutcome.TARGET_EXCEPTION, observed, trace
    oracle = specification.oracle
    if oracle.kind == "no_exception":
        if not _supported_general_result(result):
            return _harness_diagnostic(result, "None, int, bounded str, or bounded list[int]")
        violated = False
        expected = "call completes without an exception"
    elif isinstance(oracle, ResultBoundOracle):
        if type(result) is not int:
            return _harness_diagnostic(result, "int")
        if oracle.kind == "result_le_arg":
            violated = not (result <= arguments[oracle.argument])
            expected = f"result <= {oracle.argument} ({arguments[oracle.argument]!r})"
        else:
            violated = not (result >= arguments[oracle.argument])
            expected = f"result >= {oracle.argument} ({arguments[oracle.argument]!r})"
    elif isinstance(oracle, ResultBetweenOracle):
        if type(result) is not int:
            return _harness_diagnostic(result, "int")
        lower = arguments[oracle.lower_argument]
        upper = arguments[oracle.upper_argument]
        if oracle.inclusive:
            violated = not (lower <= result <= upper)
            expected = f"{lower!r} <= result <= {upper!r}"
        else:
            violated = not (lower < result < upper)
            expected = f"{lower!r} < result < {upper!r}"
    elif isinstance(oracle, ResultLengthOracle):
        argument = arguments[oracle.argument]
        if type(argument) is str:
            if type(result) is not str or len(result) > MAX_TEXT_LENGTH:
                return _harness_diagnostic(result, "bounded str matching the input strategy")
        elif type(argument) is list:
            if not _supported_integer_list(result):
                return _harness_diagnostic(
                    result, "bounded list[int] matching the input strategy"
                )
        else:  # the schema prevents this; retain a worker-side guard
            return _harness_diagnostic(result, "length-compatible result")
        if oracle.kind == "result_length_le_arg":
            violated = not (len(result) <= len(argument))
            expected = f"len(result) <= len({oracle.argument}) ({len(argument)!r})"
        else:
            violated = len(result) != len(argument)
            expected = f"len(result) == len({oracle.argument}) ({len(argument)!r})"
    elif isinstance(oracle, ResultListNondecreasingOracle):
        if not _supported_integer_list(result):
            return _harness_diagnostic(result, "bounded list[int]")
        violated = any(left > right for left, right in zip(result, result[1:], strict=False))
        expected = "result list is nondecreasing"
    elif isinstance(oracle, ResultListPreservesMultisetOracle):
        if not _supported_integer_list(result):
            return _harness_diagnostic(result, "bounded list[int]")
        violated = Counter(result) != Counter(arguments[oracle.argument])
        expected = f"result preserves the multiset of {oracle.argument}, including duplicates"
    else:  # pragma: no cover - Pydantic's discriminated union is exhaustive
        return _harness_diagnostic(result, "supported oracle result")
    observed = f"returned {_bounded_repr(result)}; expected {expected}"
    trace = errors.getvalue() + output.getvalue()
    return violated, ExperimentOutcome.PROPERTY_VIOLATION, observed, trace


def _fingerprint(outcome: ExperimentOutcome, observed: str, specification: PropertySpec) -> str:
    if outcome == ExperimentOutcome.TARGET_EXCEPTION:
        stable_observed = observed.split(":", 1)[0]
    else:
        stable_observed = specification.oracle.kind
    value = (
        f"{specification.target.path}|{specification.qualified_name}|"
        f"{outcome}|{stable_observed}"
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def _argument_strategy(argument: Any) -> st.SearchStrategy[Any]:
    strategy = argument.strategy
    if isinstance(strategy, IntegerStrategy):
        return st.integers(min_value=strategy.minimum, max_value=strategy.maximum)
    if isinstance(strategy, TextStrategy):
        return st.text(
            alphabet=list(strategy.alphabet),
            min_size=strategy.minimum_length,
            max_size=strategy.maximum_length,
        )
    if isinstance(strategy, IntegerListStrategy):
        return st.lists(
            st.integers(
                min_value=strategy.element_minimum,
                max_value=strategy.element_maximum,
            ),
            min_size=strategy.minimum_length,
            max_size=strategy.maximum_length,
        )
    raise TypeError(f"unsupported strategy: {type(strategy).__name__}")


def _strategy(specification: PropertySpec) -> st.SearchStrategy[dict[str, Any]]:
    fields = {
        argument.name: _argument_strategy(argument) for argument in specification.arguments
    }
    return st.fixed_dictionaries(fields).filter(
        lambda values: _in_domain(specification, values)
    )


def execute(repository: Path, manifest: VerificationManifest) -> ExperimentResult:
    started = time.perf_counter()
    captured_stdout = ""
    captured_stderr = ""
    diagnostic: tuple[bool, ExperimentOutcome, str, str] | None = None
    try:
        function, import_stdout, import_stderr = _load_function(repository, manifest.property_spec)
        captured_stdout += import_stdout
        captured_stderr += import_stderr
        if manifest.mode == "search":
            def violates(values: dict[str, Any]) -> bool:
                nonlocal diagnostic
                evaluated = _evaluate(function, manifest.property_spec, values)
                if evaluated[1] == ExperimentOutcome.HARNESS_ERROR and diagnostic is None:
                    diagnostic = evaluated
                return evaluated[0]

            candidate = find(
                _strategy(manifest.property_spec),
                violates,
                settings=settings(
                    max_examples=manifest.property_spec.max_examples,
                    database=None,
                    deadline=None,
                    suppress_health_check=[HealthCheck.filter_too_much],
                ),
                random=random.Random(manifest.property_spec.seed),
            )
        else:
            candidate = manifest.counterexample or {}
            if not _in_domain(manifest.property_spec, candidate):
                raise ValueError("replay input does not satisfy the declared property input domain")
        violated, outcome, observed, trace = _evaluate(
            function, manifest.property_spec, candidate
        )
        captured_stderr += trace
        if outcome == ExperimentOutcome.HARNESS_ERROR:
            return ExperimentResult(
                hypothesis_id=manifest.hypothesis_id,
                outcome=ExperimentOutcome.HARNESS_ERROR,
                counterexample=None,
                observed=observed,
                expected=manifest.property_spec.oracle_explanation,
                stdout=captured_stdout,
                stderr=captured_stderr,
                duration_ms=(time.perf_counter() - started) * 1000,
                seed=manifest.property_spec.seed,
                environment={
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                },
            )
        if not violated:
            return ExperimentResult(
                hypothesis_id=manifest.hypothesis_id,
                outcome=ExperimentOutcome.NO_VIOLATION,
                counterexample=None,
                observed="saved input did not violate the property",
                expected=manifest.property_spec.oracle_explanation,
                confirmation_runs=manifest.confirmation_runs,
                confirming_failures=0,
                reproduction_rate=0,
                stdout=captured_stdout,
                stderr=captured_stderr,
                duration_ms=(time.perf_counter() - started) * 1000,
                seed=manifest.property_spec.seed,
                environment={"python": platform.python_version(), "platform": platform.platform()},
            )
        fingerprint = _fingerprint(outcome, observed, manifest.property_spec)
        confirming = 0
        for _ in range(manifest.confirmation_runs):
            repeated, repeated_outcome, repeated_observed, repeated_trace = _evaluate(
                function, manifest.property_spec, candidate
            )
            repeated_fingerprint = _fingerprint(
                repeated_outcome, repeated_observed, manifest.property_spec
            )
            captured_stderr += repeated_trace
            if repeated and repeated_fingerprint == fingerprint:
                confirming += 1
        result_outcome = (
            outcome if confirming == manifest.confirmation_runs else ExperimentOutcome.FLAKY
        )
        return ExperimentResult(
            hypothesis_id=manifest.hypothesis_id,
            outcome=result_outcome,
            counterexample=candidate,
            observed=observed,
            expected=manifest.property_spec.oracle_explanation,
            failure_fingerprint=fingerprint,
            confirmation_runs=manifest.confirmation_runs,
            confirming_failures=confirming,
            reproduction_rate=confirming / manifest.confirmation_runs,
            stdout=captured_stdout,
            stderr=captured_stderr,
            duration_ms=(time.perf_counter() - started) * 1000,
            seed=manifest.property_spec.seed,
            environment={"python": platform.python_version(), "platform": platform.platform()},
        )
    except (NoSuchExample, Unsatisfiable):
        if diagnostic is not None:
            return ExperimentResult(
                hypothesis_id=manifest.hypothesis_id,
                outcome=ExperimentOutcome.HARNESS_ERROR,
                observed=diagnostic[2],
                expected=manifest.property_spec.oracle_explanation,
                stdout=captured_stdout,
                stderr=captured_stderr + diagnostic[3],
                duration_ms=(time.perf_counter() - started) * 1000,
                seed=manifest.property_spec.seed,
                environment={
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                },
            )
        return ExperimentResult(
            hypothesis_id=manifest.hypothesis_id,
            outcome=ExperimentOutcome.NO_VIOLATION,
            observed=(
                f"No violating input found within {manifest.property_spec.max_examples} examples; "
                "this is not a proof of correctness."
            ),
            expected=manifest.property_spec.oracle_explanation,
            stdout=captured_stdout,
            stderr=captured_stderr,
            duration_ms=(time.perf_counter() - started) * 1000,
            seed=manifest.property_spec.seed,
            environment={"python": platform.python_version(), "platform": platform.platform()},
        )
    except Exception as exc:
        return ExperimentResult(
            hypothesis_id=manifest.hypothesis_id,
            outcome=ExperimentOutcome.HARNESS_ERROR,
            observed=f"{type(exc).__name__}: {exc}",
            expected=manifest.property_spec.oracle_explanation,
            stdout=captured_stdout,
            stderr=captured_stderr + traceback.format_exc(),
            duration_ms=(time.perf_counter() - started) * 1000,
            seed=manifest.property_spec.seed,
            environment={"python": platform.python_version(), "platform": platform.platform()},
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    manifest = VerificationManifest.model_validate_json(args.manifest.read_text(encoding="utf-8"))
    print(execute(args.repository, manifest).model_dump_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())

