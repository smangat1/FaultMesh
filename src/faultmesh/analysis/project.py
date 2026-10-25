"""Non-executing Python and Markdown project analysis."""

from __future__ import annotations

import ast
import hashlib
from collections.abc import Iterable
from pathlib import Path

from faultmesh.schemas import (
    ClassMetadata,
    DocumentationMetadata,
    FunctionMetadata,
    ModuleMetadata,
    ParameterMetadata,
    ProjectIndex,
    SourceReference,
)

IGNORED_PARTS = {
    ".git",
    ".faultmesh",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _annotation(node: ast.expr | None) -> str | None:
    return ast.unparse(node) if node is not None else None


def _call_name(node: ast.Call) -> str:
    return ast.unparse(node.func)


def _iter_files(root: Path, focus: Path | None) -> Iterable[Path]:
    base = (root / focus).resolve() if focus else root
    try:
        base.relative_to(root)
    except ValueError as exc:
        raise ValueError("focus must remain inside the repository") from exc
    if not base.exists():
        raise FileNotFoundError(f"focus path does not exist: {base}")
    candidates = [base] if base.is_file() else base.rglob("*")
    for path in sorted(candidates):
        ignored = any(part in IGNORED_PARTS for part in path.relative_to(root).parts)
        if not path.is_file() or ignored:
            continue
        if path.suffix in {".py", ".md"}:
            yield path


class _FunctionCollector(ast.NodeVisitor):
    def __init__(self, source: str, relative_path: str, content_hash: str) -> None:
        self.source = source
        self.relative_path = relative_path
        self.content_hash = content_hash
        self.scope: list[tuple[str, str]] = []
        self.functions: list[FunctionMetadata] = []
        self.classes: list[ClassMetadata] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        qualified = ".".join([item[0] for item in self.scope] + [node.name])
        methods = [
            child.name
            for child in node.body
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]
        self.classes.append(
            ClassMetadata(
                name=node.name,
                qualified_name=qualified,
                reference=self._reference(node),
                bases=[ast.unparse(base) for base in node.bases],
                methods=methods,
            )
        )
        self.scope.append((node.name, "class"))
        self.generic_visit(node)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, is_async=True)

    def _visit_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef, *, is_async: bool
    ) -> None:
        qualified = ".".join([item[0] for item in self.scope] + [node.name])
        parameters = self._parameters(node.args)
        calls = sorted(
            {_call_name(child) for child in ast.walk(node) if isinstance(child, ast.Call)}
        )
        handlers = [
            ast.unparse(child.type) if child.type is not None else "BaseException"
            for child in ast.walk(node)
            if isinstance(child, ast.ExceptHandler)
        ]
        assertions = [
            ast.unparse(child.test) for child in ast.walk(node) if isinstance(child, ast.Assert)
        ]
        branches = sum(
            isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.Match))
            for child in ast.walk(node)
        )
        self.functions.append(
            FunctionMetadata(
                name=node.name,
                qualified_name=qualified,
                reference=self._reference(node),
                parameters=parameters,
                return_annotation=_annotation(node.returns),
                docstring=ast.get_docstring(node, clean=False),
                source=ast.get_source_segment(self.source, node) or "",
                calls=calls,
                branch_count=branches,
                exception_handlers=handlers,
                assertions=assertions,
                is_method=any(kind == "class" for _, kind in self.scope),
                is_async=is_async,
            )
        )
        self.scope.append((node.name, "function"))
        self.generic_visit(node)
        self.scope.pop()

    @staticmethod
    def _parameters(arguments: ast.arguments) -> list[ParameterMetadata]:
        positional = [*arguments.posonlyargs, *arguments.args]
        default_offset = len(positional) - len(arguments.defaults)
        result = [
            ParameterMetadata(
                name=argument.arg,
                annotation=_annotation(argument.annotation),
                has_default=index >= default_offset,
                kind="positional",
            )
            for index, argument in enumerate(positional)
        ]
        if arguments.vararg:
            result.append(
                ParameterMetadata(
                    name=arguments.vararg.arg,
                    annotation=_annotation(arguments.vararg.annotation),
                    has_default=False,
                    kind="var_positional",
                )
            )
        result.extend(
            ParameterMetadata(
                name=argument.arg,
                annotation=_annotation(argument.annotation),
                has_default=default is not None,
                kind="keyword_only",
            )
            for argument, default in zip(arguments.kwonlyargs, arguments.kw_defaults, strict=True)
        )
        if arguments.kwarg:
            result.append(
                ParameterMetadata(
                    name=arguments.kwarg.arg,
                    annotation=_annotation(arguments.kwarg.annotation),
                    has_default=False,
                    kind="var_keyword",
                )
            )
        return result

    def _reference(self, node: ast.stmt) -> SourceReference:
        return SourceReference(
            path=self.relative_path,
            start_line=node.lineno,
            end_line=node.end_lineno or node.lineno,
            content_hash=self.content_hash,
        )


class ProjectAnalyzer:
    """Build a lightweight index without importing or executing target code."""

    def analyze(self, root: Path, *, focus: Path | None = None) -> ProjectIndex:
        root = root.resolve()
        if not root.is_dir():
            raise NotADirectoryError(f"repository is not a directory: {root}")
        modules: list[ModuleMetadata] = []
        documentation: list[DocumentationMetadata] = []
        for path in _iter_files(root, focus):
            relative = path.relative_to(root).as_posix()
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            digest = _digest(text)
            if path.suffix == ".md":
                documentation.append(
                    DocumentationMetadata(
                        path=relative,
                        content_hash=digest,
                        headings=[
                            line.lstrip("#").strip()
                            for line in text.splitlines()
                            if line.startswith("#")
                        ],
                    )
                )
                continue
            try:
                tree = ast.parse(text, filename=relative)
            except SyntaxError as exc:
                modules.append(
                    ModuleMetadata(
                        path=relative,
                        content_hash=digest,
                        parse_error=f"{exc.msg} at line {exc.lineno}",
                    )
                )
                continue
            collector = _FunctionCollector(text, relative, digest)
            collector.visit(tree)
            imports = sorted(
                {
                    alias.name
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Import)
                    for alias in node.names
                }
                | {
                    (node.module or "")
                    for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom)
                }
            )
            modules.append(
                ModuleMetadata(
                    path=relative,
                    content_hash=digest,
                    imports=imports,
                    functions=collector.functions,
                    classes=collector.classes,
                )
            )
        return ProjectIndex(root=str(root), modules=modules, documentation=documentation)


class ContextBuilder:
    """Produce bounded, task-relevant model context for one function."""

    def __init__(self, max_characters: int = 12_000) -> None:
        self.max_characters = max_characters

    def for_function(self, function: FunctionMetadata) -> str:
        parameters = ", ".join(
            f"{parameter.name}: {parameter.annotation or 'unknown'}"
            for parameter in function.parameters
        )
        context = (
            f"Path: {function.reference.path}\n"
            f"Lines: {function.reference.start_line}-{function.reference.end_line}\n"
            f"Content hash: {function.reference.content_hash}\n"
            f"Function: {function.qualified_name}({parameters}) -> "
            f"{function.return_annotation or 'unknown'}\n"
            f"Docstring: {function.docstring or '(none)'}\n"
            f"Calls: {', '.join(function.calls) or '(none)'}\n"
            f"Branches: {function.branch_count}\n"
            f"Source:\n{function.source}\n"
        )
        return context[: self.max_characters]

