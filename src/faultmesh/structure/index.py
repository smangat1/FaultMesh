"""Non-executing Python structure indexer."""

from __future__ import annotations

import ast
import hashlib
import os
from collections import defaultdict
from pathlib import Path

from faultmesh.analysis.project import IGNORED_PARTS
from faultmesh.structure.models import (
    DocstringMetadata,
    FileNode,
    ParseErrorRecord,
    SkipRecord,
    StructureIndex,
    SymbolKind,
    SymbolNode,
)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def module_name(path: str) -> str:
    parts = path.removesuffix(".py").split("/")
    if parts[0] == "src" and len(parts) > 1:
        parts = parts[1:]
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _is_test(path: str) -> bool:
    parts = path.split("/")
    name = parts[-1]
    return "tests" in parts[:-1] or name.startswith("test_") or name.endswith("_test.py")


def _decorator_name(node: ast.expr) -> str:
    return ast.unparse(node)


def _parameters(arguments: ast.arguments) -> list[str]:
    result = [item.arg for item in [*arguments.posonlyargs, *arguments.args]]
    if arguments.vararg:
        result.append(arguments.vararg.arg)
    result.extend(item.arg for item in arguments.kwonlyargs)
    if arguments.kwarg:
        result.append(arguments.kwarg.arg)
    return result


class _SymbolCollector(ast.NodeVisitor):
    def __init__(self, source: str, path: str) -> None:
        self.source = source
        self.lines = source.splitlines(keepends=True)
        self.path = path
        self.scope: list[tuple[str, str, str]] = []
        self.occurrences: dict[tuple[str, str], int] = defaultdict(int)
        self.symbols: list[SymbolNode] = []

    def _qualified(self, name: str) -> str:
        return ".".join([scope[0] for scope in self.scope] + [name])

    def _identity(self, qualified: str) -> tuple[str, int]:
        key = (self.path, qualified)
        self.occurrences[key] += 1
        occurrence = self.occurrences[key]
        suffix = "" if occurrence == 1 else f"@{occurrence}"
        return f"symbol:{self.path}:{qualified}{suffix}", occurrence

    def _segment(self, start: int, end: int) -> str:
        return "".join(self.lines[start - 1 : end])

    def _parent_id(self) -> str:
        return self.scope[-1][2] if self.scope else f"file:{self.path}"

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        qualified = self._qualified(node.name)
        symbol_id, occurrence = self._identity(qualified)
        start = min([node.lineno, *(item.lineno for item in node.decorator_list)])
        docstring = ast.get_docstring(node, clean=False)
        self.symbols.append(
            SymbolNode(
                id=symbol_id,
                path=self.path,
                qualified_name=qualified,
                name=node.name,
                kind=SymbolKind.CLASS,
                disambiguator=occurrence,
                parent_id=self._parent_id(),
                start_line=start,
                end_line=node.end_lineno or node.lineno,
                content_sha256=_sha256(
                    self._segment(start, node.end_lineno or node.lineno).encode("utf-8")
                ),
                decorators=[_decorator_name(item) for item in node.decorator_list],
                docstring=(
                    DocstringMetadata(text=docstring.splitlines()[0]) if docstring else None
                ),
                bases=[ast.unparse(base) for base in node.bases],
            )
        )
        self.scope.append((node.name, "class", symbol_id))
        self.generic_visit(node)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, is_async=True)

    def _visit_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef, *, is_async: bool
    ) -> None:
        qualified = self._qualified(node.name)
        symbol_id, occurrence = self._identity(qualified)
        direct_class = bool(self.scope and self.scope[-1][1] == "class")
        inside_function = any(item[1] == "function" for item in self.scope)
        if inside_function:
            kind = (
                SymbolKind.NESTED_ASYNC_FUNCTION if is_async else SymbolKind.NESTED_FUNCTION
            )
        elif direct_class:
            kind = SymbolKind.ASYNC_METHOD if is_async else SymbolKind.METHOD
        else:
            kind = SymbolKind.ASYNC_FUNCTION if is_async else SymbolKind.FUNCTION
        start = min([node.lineno, *(item.lineno for item in node.decorator_list)])
        end = node.end_lineno or node.lineno
        returns = f" -> {ast.unparse(node.returns)}" if node.returns is not None else ""
        docstring = ast.get_docstring(node, clean=False)
        self.symbols.append(
            SymbolNode(
                id=symbol_id,
                path=self.path,
                qualified_name=qualified,
                name=node.name,
                kind=kind,
                disambiguator=occurrence,
                parent_id=self._parent_id(),
                start_line=start,
                end_line=end,
                content_sha256=_sha256(self._segment(start, end).encode("utf-8")),
                signature=f"({ast.unparse(node.args)}){returns}",
                parameter_names=_parameters(node.args),
                decorators=[_decorator_name(item) for item in node.decorator_list],
                docstring=(
                    DocstringMetadata(text=docstring.splitlines()[0]) if docstring else None
                ),
            )
        )
        self.scope.append((node.name, "function", symbol_id))
        self.generic_visit(node)
        self.scope.pop()


def _walk_python_files(root: Path) -> tuple[list[Path], list[SkipRecord]]:
    files: list[Path] = []
    skips: list[SkipRecord] = []
    for current, dirs, names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_dirs: list[str] = []
        for name in sorted(dirs):
            path = current_path / name
            relative = path.relative_to(root).as_posix()
            if name in IGNORED_PARTS:
                count = sum(1 for item in path.rglob("*") if item.is_file())
                skips.append(
                    SkipRecord(
                        path=relative, reason="ignored_directory", count=max(1, count)
                    )
                )
            elif (path / ".git").is_file():
                count = sum(1 for item in path.rglob("*") if item.is_file())
                skips.append(
                    SkipRecord(path=relative, reason="git_submodule", count=max(1, count))
                )
            elif path.is_symlink():
                skips.append(SkipRecord(path=relative, reason="symlink_directory", count=1))
            else:
                kept_dirs.append(name)
        dirs[:] = kept_dirs
        for name in sorted(names):
            path = current_path / name
            if path.suffix != ".py":
                continue
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                skips.append(SkipRecord(path=relative, reason="symlink_file", count=1))
            elif path.is_file():
                files.append(path)
    return sorted(files), sorted(skips, key=lambda item: (item.path, item.reason))


def index_python_bytes(
    relative: str, data: bytes
) -> tuple[FileNode, list[SymbolNode], ParseErrorRecord | None]:
    """Index one already-bounded Python file without importing or executing it."""
    line_count = len(data.splitlines())
    parse_error: str | None = None
    error: ParseErrorRecord | None = None
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        source = ""
        parse_error = f"non-UTF-8 source at byte {exc.start}"
        error = ParseErrorRecord(path=relative, message=parse_error)
    tree: ast.Module | None = None
    if parse_error is None:
        try:
            tree = ast.parse(source, filename=relative)
        except SyntaxError as exc:
            parse_error = f"{exc.msg} at line {exc.lineno}"
            error = ParseErrorRecord(path=relative, line=exc.lineno, message=exc.msg)
    file_node = FileNode(
        id=f"file:{relative}",
        path=relative,
        module=module_name(relative),
        content_sha256=_sha256(data),
        line_count=line_count,
        is_test=_is_test(relative),
        parse_error=parse_error,
    )
    symbols: list[SymbolNode] = []
    if tree is not None:
        collector = _SymbolCollector(source, relative)
        collector.visit(tree)
        symbols = collector.symbols
    return file_node, symbols, error


def build_structure_index(root: Path) -> StructureIndex:
    root = root.resolve()
    if not root.is_dir():
        raise NotADirectoryError(f"project is not a directory: {root}")
    paths, skips = _walk_python_files(root)
    files: list[FileNode] = []
    symbols: list[SymbolNode] = []
    errors: list[ParseErrorRecord] = []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        file_node, file_symbols, error = index_python_bytes(relative, data)
        files.append(file_node)
        symbols.extend(file_symbols)
        if error is not None:
            errors.append(error)
    return StructureIndex(
        files=sorted(files, key=lambda item: item.path),
        symbols=sorted(symbols, key=lambda item: (item.path, item.start_line, item.id)),
        skips=skips,
        parse_errors=sorted(errors, key=lambda item: (item.path, item.line or 0)),
    )
