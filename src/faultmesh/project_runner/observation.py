"""Build source snapshots and validate container observation output."""

from __future__ import annotations

import ast
import json
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.analysis import ProjectAnalyzer
from faultmesh.project_runner.models import (
    CollectionObservedFile,
    MappingStatus,
    ObservationStatus,
    ObservedFile,
    ObservedLine,
    ObservedSymbol,
    SourceFileSnapshot,
    SourceSnapshot,
    SourceSymbolSnapshot,
    TestCaseRecord,
    TestObservation,
    TestPhase,
)

INSTRUMENTATION_VERSION = "coverage-contexts-1.0"
COVERAGE_PIN = "coverage==7.10.7"


class ObservationError(RuntimeError):
    pass


class _RawContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str | None = None
    phase: Literal["collection", "setup", "call", "teardown"]
    lines: list[int] = Field(max_length=2_000_000)


class _RawFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    contexts: list[_RawContext] = Field(max_length=200_000)


class _RawReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"]
    instrumentation_version: Literal["coverage-contexts-1.0"]
    completed: bool
    files: list[_RawFile] = Field(max_length=200_000)
    installed_packages: list[str] = Field(max_length=20_000)
    errors: list[str] = Field(max_length=100)


class _LineCollector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.lines: set[int] = set()

    def generic_visit(self, node: ast.AST) -> None:
        line = getattr(node, "lineno", None)
        if isinstance(line, int):
            self.lines.add(line)
        super().generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        del node

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        del node

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        del node

    def visit_Lambda(self, node: ast.Lambda) -> None:
        del node


class _SymbolCollector(ast.NodeVisitor):
    def __init__(self, path: str) -> None:
        self.path = path
        self.scope: list[tuple[str, str]] = []
        self.symbols: list[SourceSymbolSnapshot] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope.append((node.name, "class"))
        self.generic_visit(node)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._function(node, is_async=True)

    def _function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef, *, is_async: bool
    ) -> None:
        qualified = ".".join([item[0] for item in self.scope] + [node.name])
        collector = _LineCollector()
        for statement in node.body:
            collector.visit(statement)
        is_method = any(kind == "class" for _, kind in self.scope)
        kind: Literal["function", "method", "async_function", "async_method"]
        if is_async:
            kind = "async_method" if is_method else "async_function"
        else:
            kind = "method" if is_method else "function"
        self.symbols.append(
            SourceSymbolSnapshot(
                path=self.path,
                qualified_name=qualified,
                kind=kind,
                start_line=node.lineno,
                end_line=node.end_lineno or node.lineno,
                executable_lines=sorted(collector.lines),
            )
        )
        self.scope.append((node.name, "function"))
        self.generic_visit(node)
        self.scope.pop()


def build_source_snapshot(
    root: Path, *, revision: str, content_sha256: str
) -> SourceSnapshot:
    index = ProjectAnalyzer().analyze(root)
    files: list[SourceFileSnapshot] = []
    for module in index.modules:
        path = root / module.path
        text = path.read_text(encoding="utf-8")
        symbols: list[SourceSymbolSnapshot] = []
        parse_error = module.parse_error
        if parse_error is None:
            tree = ast.parse(text, filename=module.path)
            collector = _SymbolCollector(module.path)
            collector.visit(tree)
            symbols = collector.symbols
        files.append(
            SourceFileSnapshot(
                path=module.path,
                content_sha256=module.content_hash,
                line_count=len(text.splitlines()),
                parse_error=parse_error,
                symbols=symbols,
            )
        )
    return SourceSnapshot(
        revision=revision,
        content_sha256=content_sha256,
        files=files,
    )


def read_json_artifact(path: Path, run_dir: Path, limit: int) -> object:
    if path.is_symlink():
        raise ObservationError(f"artifact is a symlink: {path.name}")
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ObservationError(f"artifact is missing: {path.name}") from exc
    if not resolved.is_relative_to(run_dir.resolve()) or not resolved.is_file():
        raise ObservationError(f"artifact escapes its run directory: {path.name}")
    if resolved.stat().st_size > limit:
        raise ObservationError(f"artifact exceeds {limit} bytes: {path.name}")
    try:
        return json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ObservationError(f"artifact is not valid JSON: {path.name}") from exc


def _relative_trace_path(value: str) -> str | None:
    path = PurePosixPath(value.replace("\\", "/"))
    workspace = PurePosixPath("/workspace")
    try:
        relative = path.relative_to(workspace)
    except ValueError:
        return None
    if not relative.parts or ".." in relative.parts:
        return None
    return relative.as_posix()


def apply_observations(
    raw: object,
    *,
    snapshot: SourceSnapshot,
    tests: list[TestCaseRecord],
) -> tuple[
    list[TestCaseRecord], ObservationStatus, list[CollectionObservedFile], list[str]
]:
    report = _RawReport.model_validate(raw)
    known_tests = {case.node_id: case for case in tests}
    files = {item.path: item for item in snapshot.files}
    per_test: dict[str, dict[str, dict[int, set[TestPhase]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(set))
    )
    collection: dict[str, set[int]] = defaultdict(set)
    outside: dict[str, int] = defaultdict(int)
    unknown: set[str] = set()
    invalid = False
    for raw_file in report.files:
        relative = _relative_trace_path(raw_file.path)
        for context in raw_file.contexts:
            if context.phase == "collection":
                if relative is not None:
                    collection[relative].update(context.lines)
                continue
            if context.node_id is None or context.node_id not in known_tests:
                unknown.add(context.node_id or "<missing>")
                invalid = True
                continue
            if relative is None:
                outside[context.node_id] += 1
                continue
            phase = TestPhase(context.phase)
            for line in context.lines:
                if line < 1:
                    invalid = True
                    continue
                per_test[context.node_id][relative][line].add(phase)

    updated: list[TestCaseRecord] = []
    for case in tests:
        observed_files: list[ObservedFile] = []
        unmapped_files: list[ObservedFile] = []
        symbols: list[ObservedSymbol] = []
        for path, line_map in sorted(per_test[case.node_id].items()):
            source_file = files.get(path)
            if source_file is None:
                unmapped_files.append(
                    ObservedFile(
                        path=path,
                        content_sha256="unknown",
                        lines=[
                            ObservedLine(line=line, phases=sorted(phases, key=lambda p: p.value))
                            for line, phases in sorted(line_map.items())
                        ],
                        mapping_status=MappingStatus.UNMAPPED,
                    )
                )
                continue
            if any(line > source_file.line_count for line in line_map):
                invalid = True
            observed = ObservedFile(
                path=path,
                content_sha256=source_file.content_sha256,
                lines=[
                    ObservedLine(line=line, phases=sorted(phases, key=lambda p: p.value))
                    for line, phases in sorted(line_map.items())
                    if line <= source_file.line_count
                ],
                mapping_status=MappingStatus.MAPPED,
            )
            observed_files.append(observed)
            claimed: set[int] = set()
            if source_file.parse_error is None:
                for symbol in source_file.symbols:
                    executed = sorted(set(symbol.executable_lines) & set(line_map))
                    if not executed:
                        continue
                    claimed.update(executed)
                    phases = sorted(
                        {phase for line in executed for phase in line_map[line]},
                        key=lambda phase: phase.value,
                    )
                    symbols.append(
                        ObservedSymbol(
                            path=path,
                            content_sha256=source_file.content_sha256,
                            qualified_name=symbol.qualified_name,
                            start_line=symbol.start_line,
                            end_line=symbol.end_line,
                            executed_lines=executed,
                            phases=phases,
                        )
                    )
            remaining = sorted(set(line_map) - claimed)
            if remaining:
                mapping_status = (
                    MappingStatus.PARSE_ERROR
                    if source_file.parse_error is not None
                    else MappingStatus.UNMAPPED
                )
                unmapped_files.append(
                    ObservedFile(
                        path=path,
                        content_sha256=source_file.content_sha256,
                        lines=[
                            ObservedLine(
                                line=line,
                                phases=sorted(line_map[line], key=lambda phase: phase.value),
                            )
                            for line in remaining
                        ],
                        mapping_status=mapping_status,
                    )
                )
        observation_status = ObservationStatus.COMPLETE
        error = None
        if report.errors or not report.completed:
            observation_status = ObservationStatus.INSTRUMENTATION_ERROR
            error = "; ".join(report.errors) or "instrumentation did not complete"
        elif not observed_files:
            observation_status = ObservationStatus.INCOMPLETE
            error = "no project source lines were recorded for this test"
        elif unknown or invalid:
            observation_status = ObservationStatus.INCOMPLETE
            error = "observation contained unknown contexts or invalid lines"
        observation = TestObservation(
            status=observation_status,
            instrumentation_version=report.instrumentation_version,
            source_revision=snapshot.revision,
            source_content_sha256=snapshot.content_sha256,
            files=observed_files,
            symbols=sorted(symbols, key=lambda item: (item.path, item.qualified_name)),
            unmapped=unmapped_files,
            outside_root_files=outside[case.node_id],
            unknown_contexts=sorted(unknown),
            error=error,
        )
        updated.append(case.model_copy(update={"observation": observation}))

    statuses = {case.observation.status for case in updated if case.observation is not None}
    run_status = (
        ObservationStatus.COMPLETE
        if statuses == {ObservationStatus.COMPLETE}
        else ObservationStatus.INSTRUMENTATION_ERROR
        if ObservationStatus.INSTRUMENTATION_ERROR in statuses
        else ObservationStatus.INCOMPLETE
    )
    collection_files = [
        CollectionObservedFile(
            path=path,
            content_sha256=files[path].content_sha256,
            lines=sorted(lines),
        )
        for path, lines in sorted(collection.items())
        if path in files
    ]
    return updated, run_status, collection_files, sorted(report.installed_packages)
