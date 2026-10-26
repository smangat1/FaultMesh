"""Honest static imports and possible-call relationships."""

from __future__ import annotations

import ast
import builtins
import hashlib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from faultmesh.structure.models import (
    EdgeConfidence,
    EdgeKind,
    RelationshipIndex,
    StaticEdge,
    StructureIndex,
    SymbolKind,
    SymbolNode,
    UnresolvedReference,
)


@dataclass(frozen=True)
class _Binding:
    module: str
    target_id: str | None = None


def _edge_id(parts: tuple[object, ...]) -> str:
    encoded = "\0".join(str(part) for part in parts).encode("utf-8")
    return f"edge:{hashlib.sha256(encoded).hexdigest()[:20]}"


def _relative_module(
    current: str, *, level: int, module: str | None, is_package: bool
) -> str:
    package = current if is_package else current.rpartition(".")[0]
    parts = [part for part in package.split(".") if part]
    remove = max(0, level - 1)
    if remove:
        parts = parts[:-remove] if remove <= len(parts) else []
    if module:
        parts.extend(module.split("."))
    return ".".join(parts)


class _RelationshipVisitor(ast.NodeVisitor):
    def __init__(
        self,
        *,
        path: str,
        module: str,
        file_id: str,
        module_files: dict[str, str],
        symbols: list[SymbolNode],
        exported_symbols: dict[tuple[str, str], list[SymbolNode]],
    ) -> None:
        self.path = path
        self.module = module
        self.file_id = file_id
        self.module_files = module_files
        self.symbols = symbols
        self.symbols_by_id = {item.id: item for item in symbols}
        self.top_by_module_name: dict[tuple[str, str], list[SymbolNode]] = defaultdict(list)
        self.top_by_module_name.update(exported_symbols)
        self.children: dict[tuple[str, str], list[SymbolNode]] = defaultdict(list)
        for symbol in symbols:
            target_module = next(
                (name for name, target in module_files.items() if target == f"file:{symbol.path}"),
                "",
            )
            if (
                symbol.parent_id == f"file:{symbol.path}"
                and symbol not in self.top_by_module_name[(target_module, symbol.name)]
            ):
                self.top_by_module_name[(target_module, symbol.name)].append(symbol)
            self.children[(symbol.parent_id, symbol.name)].append(symbol)
        self.scope_names: list[str] = []
        self.scope_ids: list[str] = [file_id]
        self.scope_kinds: list[str] = ["file"]
        self.bindings: list[dict[str, _Binding]] = [{}]
        self.occurrences: dict[str, int] = defaultdict(int)
        self.edges: list[StaticEdge] = []
        self.unresolved: list[UnresolvedReference] = []
        self.external: set[str] = set()
        self.edge_occurrences: dict[tuple[object, ...], int] = defaultdict(int)

    def _add_edge(
        self,
        *,
        kind: EdgeKind,
        source_id: str,
        target_id: str | None,
        line: int,
        reason: str,
        confidence: EdgeConfidence,
        external_module: str | None = None,
    ) -> None:
        key = (kind, source_id, target_id, self.path, line, reason, confidence, external_module)
        self.edge_occurrences[key] += 1
        self.edges.append(
            StaticEdge(
                id=_edge_id((*key, self.edge_occurrences[key])),
                kind=kind,
                source_id=source_id,
                target_id=target_id,
                callsite_path=self.path,
                callsite_line=line,
                resolution_reason=reason,
                confidence=confidence,
                external_module=external_module,
            )
        )

    def _unresolved(self, node: ast.AST, text: str, reason: str) -> None:
        self.unresolved.append(
            UnresolvedReference(
                path=self.path,
                line=getattr(node, "lineno", 1),
                text=text,
                reason=reason,
            )
        )

    def _source_id(self) -> str:
        return self.scope_ids[-1]

    def _lookup_binding(self, name: str) -> _Binding | None:
        for bindings in reversed(self.bindings):
            if name in bindings:
                return bindings[name]
        return None

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            bound = alias.asname or alias.name.split(".")[0]
            target = self.module_files.get(alias.name)
            self.bindings[-1][bound] = _Binding(module=alias.name)
            if target:
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=target,
                    line=node.lineno,
                    reason="import_binding",
                    confidence=EdgeConfidence.RESOLVED,
                )
            else:
                self.external.add(alias.name)
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=None,
                    line=node.lineno,
                    reason="external_module",
                    confidence=EdgeConfidence.UNRESOLVED,
                    external_module=alias.name,
                )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        base = (
            _relative_module(
                self.module,
                level=node.level,
                module=node.module,
                is_package=self.path == "__init__.py" or self.path.endswith("/__init__.py"),
            )
            if node.level
            else (node.module or "")
        )
        if any(alias.name == "*" for alias in node.names):
            self._unresolved(node, ast.unparse(node), "star_import")
        for alias in node.names:
            if alias.name == "*":
                continue
            bound = alias.asname or alias.name
            submodule = f"{base}.{alias.name}" if base else alias.name
            candidates = self.top_by_module_name.get((base, alias.name), [])
            if candidates:
                confidence = (
                    EdgeConfidence.RESOLVED
                    if len(candidates) == 1
                    else EdgeConfidence.AMBIGUOUS
                )
                for candidate in candidates:
                    self._add_edge(
                        kind=EdgeKind.IMPORTS,
                        source_id=self._source_id(),
                        target_id=candidate.id,
                        line=node.lineno,
                        reason="from_import_symbol",
                        confidence=confidence,
                    )
                if len(candidates) == 1:
                    self.bindings[-1][bound] = _Binding(
                        module=base, target_id=candidates[0].id
                    )
                continue
            if submodule in self.module_files:
                target_id = self.module_files[submodule]
                self.bindings[-1][bound] = _Binding(module=submodule)
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=target_id,
                    line=node.lineno,
                    reason="from_import_submodule",
                    confidence=EdgeConfidence.RESOLVED,
                )
                continue
            if base in self.module_files:
                self._unresolved(node, ast.unparse(node), "missing_project_export")
            else:
                external = base or alias.name
                self.external.add(external)
                self.bindings[-1][bound] = _Binding(module=external)
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=None,
                    line=node.lineno,
                    reason="external_module",
                    confidence=EdgeConfidence.UNRESOLVED,
                    external_module=external,
                )

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._enter_symbol(node.name, "class", node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._enter_symbol(node.name, "function", node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._enter_symbol(node.name, "function", node)

    def _enter_symbol(self, name: str, kind: str, node: ast.AST) -> None:
        decorators = getattr(node, "decorator_list", [])
        for decorator in decorators:
            self._unresolved(decorator, ast.unparse(decorator), "decorator_semantics")
        qualified = ".".join([*self.scope_names, name])
        self.occurrences[qualified] += 1
        occurrence = self.occurrences[qualified]
        suffix = "" if occurrence == 1 else f"@{occurrence}"
        symbol_id = f"symbol:{self.path}:{qualified}{suffix}"
        if symbol_id not in self.symbols_by_id:
            self.generic_visit(node)
            return
        self.scope_names.append(name)
        self.scope_ids.append(symbol_id)
        self.scope_kinds.append(kind)
        self.bindings.append({})
        self.generic_visit(node)
        self.bindings.pop()
        self.scope_kinds.pop()
        self.scope_ids.pop()
        self.scope_names.pop()

    def visit_Call(self, node: ast.Call) -> None:
        if self.scope_kinds[-1] != "function":
            self._unresolved(node, ast.unparse(node.func), "module_or_class_body_call")
            self.generic_visit(node)
            return
        if isinstance(node.func, ast.Name):
            self._resolve_name_call(node, node.func.id)
        elif isinstance(node.func, ast.Attribute):
            self._resolve_attribute_call(node)
        else:
            self._unresolved(node, ast.unparse(node.func), "dynamic_callable")
        self.generic_visit(node)

    def _resolve_name_call(self, node: ast.Call, name: str) -> None:
        if name in {"getattr", "__import__"}:
            self._unresolved(node, ast.unparse(node.func), "dynamic_reference")
            return
        binding = self._lookup_binding(name)
        if binding and binding.target_id:
            self._add_edge(
                kind=EdgeKind.POSSIBLE_CALL,
                source_id=self._source_id(),
                target_id=binding.target_id,
                line=node.lineno,
                reason="import_binding",
                confidence=EdgeConfidence.RESOLVED,
            )
            return
        candidates: list[SymbolNode] = []
        for scope_id in reversed(self.scope_ids):
            candidates = self.children.get((scope_id, name), [])
            if candidates:
                break
        if candidates:
            confidence = (
                EdgeConfidence.RESOLVED
                if len(candidates) == 1
                else EdgeConfidence.AMBIGUOUS
            )
            for candidate in candidates:
                self._add_edge(
                    kind=EdgeKind.POSSIBLE_CALL,
                    source_id=self._source_id(),
                    target_id=candidate.id,
                    line=node.lineno,
                    reason="same_scope",
                    confidence=confidence,
                )
            return
        if binding:
            self.external.add(binding.module)
            self._unresolved(node, name, "external_callable")
        elif hasattr(builtins, name):
            self.external.add("builtins")
            self._unresolved(node, name, "external_builtin")
        else:
            self._unresolved(node, name, "unknown_name")

    def _resolve_attribute_call(self, node: ast.Call) -> None:
        attribute = node.func
        assert isinstance(attribute, ast.Attribute)
        if isinstance(attribute.value, ast.Name):
            receiver = attribute.value.id
            if receiver == "importlib" and attribute.attr == "import_module":
                self._unresolved(node, ast.unparse(node.func), "dynamic_import")
                return
            if receiver in {"self", "cls"}:
                class_id = next(
                    (
                        scope_id
                        for scope_id, kind in zip(
                            reversed(self.scope_ids), reversed(self.scope_kinds), strict=True
                        )
                        if kind == "class"
                    ),
                    None,
                )
                candidates = self._class_methods(class_id, attribute.attr)
                if candidates:
                    confidence = (
                        EdgeConfidence.RESOLVED
                        if len(candidates) == 1
                        else EdgeConfidence.AMBIGUOUS
                    )
                    for candidate in candidates:
                        self._add_edge(
                            kind=EdgeKind.POSSIBLE_CALL,
                            source_id=self._source_id(),
                            target_id=candidate.id,
                            line=node.lineno,
                            reason=f"{receiver}_method",
                            confidence=confidence,
                        )
                    return
            binding = self._lookup_binding(receiver)
            if binding:
                candidates = self.top_by_module_name.get((binding.module, attribute.attr), [])
                if candidates:
                    confidence = (
                        EdgeConfidence.RESOLVED
                        if len(candidates) == 1
                        else EdgeConfidence.AMBIGUOUS
                    )
                    for candidate in candidates:
                        self._add_edge(
                            kind=EdgeKind.POSSIBLE_CALL,
                            source_id=self._source_id(),
                            target_id=candidate.id,
                            line=node.lineno,
                            reason="module_attribute",
                            confidence=confidence,
                        )
                    return
                self.external.add(binding.module)
                self._unresolved(node, ast.unparse(node.func), "external_or_unknown_attribute")
                return
        self._unresolved(node, ast.unparse(node.func), "unknown_receiver_type")

    def _class_methods(self, class_id: str | None, name: str) -> list[SymbolNode]:
        if class_id is None:
            return []
        direct = self.children.get((class_id, name), [])
        if direct:
            return direct
        class_node = self.symbols_by_id.get(class_id)
        if class_node is None:
            return []
        result: list[SymbolNode] = []
        for base in class_node.bases:
            result.extend(
                method
                for candidate in self.symbols
                if candidate.kind == SymbolKind.CLASS and candidate.name == base
                for method in self.children.get((candidate.id, name), [])
            )
        return result


def build_relationships(root: Path, index: StructureIndex) -> RelationshipIndex:
    root = root.resolve()
    module_files = {item.module: item.id for item in index.files if item.module}
    all_edges: list[StaticEdge] = []
    unresolved: list[UnresolvedReference] = []
    external: set[str] = set()
    exported_symbols: dict[tuple[str, str], list[SymbolNode]] = defaultdict(list)
    file_by_path = {item.path: item for item in index.files}
    for symbol in index.symbols:
        if symbol.parent_id == f"file:{symbol.path}":
            module = file_by_path[symbol.path].module
            exported_symbols[(module, symbol.name)].append(symbol)
    for file in index.files:
        if file.parse_error is not None:
            continue
        tree = ast.parse((root / file.path).read_text(encoding="utf-8"), filename=file.path)
        for node in tree.body:
            if not isinstance(node, ast.ImportFrom):
                continue
            base = (
                _relative_module(
                    file.module,
                    level=node.level,
                    module=node.module,
                    is_package=(
                        file.path == "__init__.py" or file.path.endswith("/__init__.py")
                    ),
                )
                if node.level
                else (node.module or "")
            )
            for alias in node.names:
                candidates = exported_symbols.get((base, alias.name), [])
                key = (file.module, alias.asname or alias.name)
                for candidate in candidates:
                    if candidate not in exported_symbols[key]:
                        exported_symbols[key].append(candidate)
    for symbol in index.symbols:
        kind = EdgeKind.DEFINES if symbol.parent_id.startswith("file:") else EdgeKind.CONTAINS
        all_edges.append(
            StaticEdge(
                id=_edge_id((kind, symbol.parent_id, symbol.id, symbol.path, symbol.start_line)),
                kind=kind,
                source_id=symbol.parent_id,
                target_id=symbol.id,
                callsite_path=symbol.path,
                callsite_line=symbol.start_line,
                resolution_reason="ast_definition",
                confidence=EdgeConfidence.RESOLVED,
            )
        )
    for file in index.files:
        if file.parse_error is not None:
            continue
        source = (root / file.path).read_text(encoding="utf-8")
        tree = ast.parse(source, filename=file.path)
        visitor = _RelationshipVisitor(
            path=file.path,
            module=file.module,
            file_id=file.id,
            module_files=module_files,
            symbols=index.symbols,
            exported_symbols=exported_symbols,
        )
        visitor.visit(tree)
        all_edges.extend(visitor.edges)
        unresolved.extend(visitor.unresolved)
        external.update(visitor.external)
    return RelationshipIndex(
        edges=sorted(
            all_edges,
            key=lambda item: (
                item.callsite_path,
                item.callsite_line,
                item.kind,
                item.source_id,
                item.target_id or "",
                item.id,
            ),
        ),
        unresolved=sorted(
            unresolved, key=lambda item: (item.path, item.line, item.text, item.reason)
        ),
        external_modules=sorted(external),
    )
