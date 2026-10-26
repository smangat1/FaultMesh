"""Honest static imports and possible-call relationships."""

from __future__ import annotations

import ast
import builtins
import hashlib
from collections import defaultdict
from dataclasses import dataclass, field
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
    reason: str = "import_binding"


@dataclass
class _Scope:
    kind: str
    scope_id: str
    local_names: set[str] = field(default_factory=set)
    global_names: set[str] = field(default_factory=set)
    nonlocal_names: set[str] = field(default_factory=set)
    bindings: dict[str, list[_Binding] | None] = field(default_factory=dict)


@dataclass(frozen=True)
class _Lookup:
    bindings: list[_Binding]
    blocked: bool = False


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


def _attribute_parts(node: ast.expr) -> list[str] | None:
    parts: list[str] = []
    current: ast.expr = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if not isinstance(current, ast.Name):
        return None
    return [current.id, *reversed(parts)]


class _FunctionBindings(ast.NodeVisitor):
    def __init__(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.local_names = {
            item.arg
            for item in [
                *node.args.posonlyargs,
                *node.args.args,
                *node.args.kwonlyargs,
            ]
        }
        if node.args.vararg:
            self.local_names.add(node.args.vararg.arg)
        if node.args.kwarg:
            self.local_names.add(node.args.kwarg.arg)
        self.global_names: set[str] = set()
        self.nonlocal_names: set[str] = set()
        for statement in node.body:
            self.visit(statement)
        self.local_names.difference_update(self.global_names | self.nonlocal_names)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.local_names.add(node.id)

    def visit_Import(self, node: ast.Import) -> None:
        self.local_names.update(alias.asname or alias.name.split(".")[0] for alias in node.names)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.local_names.update(
            alias.asname or alias.name for alias in node.names if alias.name != "*"
        )

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.local_names.add(node.name)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.local_names.add(node.name)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.local_names.add(node.name)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return

    def visit_Global(self, node: ast.Global) -> None:
        self.global_names.update(node.names)

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.nonlocal_names.update(node.names)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self.local_names.add(node.name)
        self.generic_visit(node)


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
        self.scopes = [_Scope(kind="file", scope_id=file_id)]
        self.occurrences: dict[str, int] = defaultdict(int)
        self.edges: list[StaticEdge] = []
        self.unresolved: list[UnresolvedReference] = []
        self.external: set[str] = set()
        self.edge_occurrences: dict[tuple[object, ...], int] = defaultdict(int)
        self.class_bases: dict[str, list[str]] = {}

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
        return self.scopes[-1].scope_id

    def _binding_scope(self, name: str) -> _Scope:
        current = self.scopes[-1]
        if current.kind == "function" and name in current.global_names:
            return self.scopes[0]
        if current.kind == "function" and name in current.nonlocal_names:
            for scope in reversed(self.scopes[:-1]):
                if scope.kind == "function":
                    return scope
        return current

    def _set_binding(self, name: str, binding: _Binding | None) -> None:
        scope = self._binding_scope(name)
        if binding is None:
            scope.bindings[name] = None
            return
        existing = scope.bindings.get(name)
        if existing is None:
            scope.bindings[name] = [binding]
        elif binding not in existing:
            existing.append(binding)

    def _replace_bindings(self, name: str, bindings: list[_Binding] | None) -> None:
        self._binding_scope(name).bindings[name] = bindings

    def _binding_snapshot(self) -> list[dict[str, list[_Binding] | None]]:
        return [
            {
                name: None if bindings is None else list(bindings)
                for name, bindings in scope.bindings.items()
            }
            for scope in self.scopes
        ]

    def _restore_bindings(
        self, snapshot: list[dict[str, list[_Binding] | None]]
    ) -> None:
        for scope, bindings in zip(self.scopes, snapshot, strict=True):
            scope.bindings = {
                name: None if candidates is None else list(candidates)
                for name, candidates in bindings.items()
            }

    def _visit_binding_branches(self, branches: list[list[ast.AST]]) -> None:
        baseline = self._binding_snapshot()
        outcomes: list[list[dict[str, list[_Binding] | None]]] = []
        for branch in branches:
            self._restore_bindings(baseline)
            for node in branch:
                self.visit(node)
            outcomes.append(self._binding_snapshot())
        merged: list[dict[str, list[_Binding] | None]] = []
        for position in range(len(self.scopes)):
            states = [outcome[position] for outcome in outcomes]
            names = set().union(*(state.keys() for state in states))
            combined: dict[str, list[_Binding] | None] = {}
            for name in names:
                if any(name not in state or state[name] is None for state in states):
                    combined[name] = None
                    continue
                candidates: list[_Binding] = []
                for state in states:
                    for binding in state[name] or []:
                        if binding not in candidates:
                            candidates.append(binding)
                combined[name] = candidates
            merged.append(combined)
        self._restore_bindings(merged)

    def _lookup(self, name: str) -> _Lookup:
        force_module = False
        inside_function = any(scope.kind == "function" for scope in self.scopes)
        for scope in reversed(self.scopes):
            if force_module and scope.kind != "file":
                continue
            if scope.kind == "class" and inside_function:
                continue
            if scope.kind == "function" and name in scope.global_names:
                force_module = True
                continue
            if name in scope.bindings:
                bindings = scope.bindings[name]
                return _Lookup(
                    bindings=[] if bindings is None else bindings,
                    blocked=bindings is None,
                )
            if scope.kind == "function" and name in scope.local_names:
                return _Lookup(bindings=[], blocked=True)
            candidates = self.children.get((scope.scope_id, name), [])
            if candidates:
                return _Lookup(
                    bindings=[
                        _Binding(module=self.module, target_id=item.id, reason="same_scope")
                        for item in candidates
                    ]
                )
        return _Lookup(bindings=[])

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self._set_binding(node.id, None)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            bound = alias.asname or alias.name.split(".")[0]
            bound_module = alias.name if alias.asname else alias.name.split(".")[0]
            self._replace_bindings(bound, [_Binding(module=bound_module)])
            target = self.module_files.get(alias.name)
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
                self._replace_bindings(
                    bound,
                    [
                        _Binding(module=base, target_id=item.id) for item in candidates
                    ],
                )
                continue
            if submodule in self.module_files:
                self._replace_bindings(bound, [_Binding(module=submodule)])
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=self.module_files[submodule],
                    line=node.lineno,
                    reason="from_import_submodule",
                    confidence=EdgeConfidence.RESOLVED,
                )
                continue
            if base in self.module_files:
                self._replace_bindings(bound, None)
                self._unresolved(node, ast.unparse(node), "missing_project_export")
            else:
                external = base or alias.name
                self.external.add(external)
                self._replace_bindings(bound, [_Binding(module=external)])
                self._add_edge(
                    kind=EdgeKind.IMPORTS,
                    source_id=self._source_id(),
                    target_id=None,
                    line=node.lineno,
                    reason="external_module",
                    confidence=EdgeConfidence.UNRESOLVED,
                    external_module=external,
                )

    def visit_If(self, node: ast.If) -> None:
        self.visit(node.test)
        branches: list[list[ast.AST]] = [list(node.body)]
        branches.append(list(node.orelse) if node.orelse else [])
        self._visit_binding_branches(branches)

    def visit_Try(self, node: ast.Try) -> None:
        success: list[ast.AST] = [*node.body, *node.orelse]
        for handler in node.handlers:
            if handler.type is not None:
                self.visit(handler.type)
        branches: list[list[ast.AST]] = [success]
        branches.extend(list(handler.body) for handler in node.handlers)
        self._visit_binding_branches(branches)
        for statement in node.finalbody:
            self.visit(statement)

    def visit_TryStar(self, node: ast.TryStar) -> None:
        success: list[ast.AST] = [*node.body, *node.orelse]
        for handler in node.handlers:
            if handler.type is not None:
                self.visit(handler.type)
        branches: list[list[ast.AST]] = [success]
        branches.extend(list(handler.body) for handler in node.handlers)
        self._visit_binding_branches(branches)
        for statement in node.finalbody:
            self.visit(statement)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._enter_symbol(node.name, "class", node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._enter_symbol(node.name, "function", node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._enter_symbol(node.name, "function", node)

    def _enter_symbol(
        self, name: str, kind: str, node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
    ) -> None:
        for decorator in node.decorator_list:
            self._unresolved(decorator, ast.unparse(decorator), "decorator_semantics")
        qualified = ".".join([*self.scope_names, name])
        self.occurrences[qualified] += 1
        occurrence = self.occurrences[qualified]
        suffix = "" if occurrence == 1 else f"@{occurrence}"
        symbol_id = f"symbol:{self.path}:{qualified}{suffix}"
        if symbol_id not in self.symbols_by_id:
            self.generic_visit(node)
            return
        self._set_binding(
            name, _Binding(module=self.module, target_id=symbol_id, reason="same_scope")
        )
        if isinstance(node, ast.ClassDef):
            resolved_bases: list[str] = []
            for base in node.bases:
                resolved_bases.extend(self._resolve_expression_targets(base))
            self.class_bases[symbol_id] = list(dict.fromkeys(resolved_bases))
            local_names: set[str] = set()
            global_names: set[str] = set()
            nonlocal_names: set[str] = set()
        else:
            collected = _FunctionBindings(node)
            local_names = collected.local_names
            global_names = collected.global_names
            nonlocal_names = collected.nonlocal_names
        scope = _Scope(
            kind=kind,
            scope_id=symbol_id,
            local_names=local_names,
            global_names=global_names,
            nonlocal_names=nonlocal_names,
        )
        if not isinstance(node, ast.ClassDef):
            for parameter in self.symbols_by_id[symbol_id].parameter_names:
                scope.bindings[parameter] = None
        self.scope_names.append(name)
        self.scopes.append(scope)
        self.generic_visit(node)
        self.scopes.pop()
        self.scope_names.pop()

    def _resolve_expression_targets(self, expression: ast.expr) -> list[str]:
        if isinstance(expression, ast.Name):
            lookup = self._lookup(expression.id)
            return [item.target_id for item in lookup.bindings if item.target_id is not None]
        parts = _attribute_parts(expression)
        if not parts or len(parts) < 2:
            return []
        lookup = self._lookup(parts[0])
        result: list[str] = []
        for binding in lookup.bindings:
            if binding.target_id is not None:
                continue
            module = ".".join([binding.module, *parts[1:-1]])
            result.extend(item.id for item in self.top_by_module_name.get((module, parts[-1]), []))
        return result

    def visit_Call(self, node: ast.Call) -> None:
        if self.scopes[-1].kind != "function":
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

    def _emit_candidates(self, node: ast.Call, bindings: list[_Binding], reason: str) -> bool:
        targets = list(dict.fromkeys(item.target_id for item in bindings if item.target_id))
        if not targets:
            return False
        confidence = EdgeConfidence.RESOLVED if len(targets) == 1 else EdgeConfidence.AMBIGUOUS
        for target in targets:
            self._add_edge(
                kind=EdgeKind.POSSIBLE_CALL,
                source_id=self._source_id(),
                target_id=target,
                line=node.lineno,
                reason=reason,
                confidence=confidence,
            )
        return True

    def _resolve_name_call(self, node: ast.Call, name: str) -> None:
        if name in {"getattr", "__import__"}:
            self._unresolved(node, ast.unparse(node.func), "dynamic_reference")
            return
        lookup = self._lookup(name)
        if lookup.blocked:
            self._unresolved(node, name, "local_binding")
            return
        if lookup.bindings:
            reason = lookup.bindings[0].reason
            if self._emit_candidates(node, lookup.bindings, reason):
                return
            external = lookup.bindings[0].module
            self.external.add(external)
            self._unresolved(node, name, "external_callable")
        elif hasattr(builtins, name):
            self.external.add("builtins")
            self._unresolved(node, name, "external_builtin")
        else:
            self._unresolved(node, name, "unknown_name")

    def _method_class(self, receiver: str) -> str | None:
        source = self.symbols_by_id.get(self._source_id())
        if source is None or source.kind not in {SymbolKind.METHOD, SymbolKind.ASYNC_METHOD}:
            return None
        if not source.parameter_names or source.parameter_names[0] != receiver:
            return None
        decorators = {item.rsplit(".", 1)[-1] for item in source.decorators}
        if "staticmethod" in decorators:
            return None
        if receiver == "cls" and "classmethod" not in decorators:
            return None
        if receiver == "self" and "classmethod" in decorators:
            return None
        return source.parent_id

    def _resolve_attribute_call(self, node: ast.Call) -> None:
        parts = _attribute_parts(node.func)
        if not parts or len(parts) < 2:
            self._unresolved(node, ast.unparse(node.func), "unknown_receiver_type")
            return
        receiver = parts[0]
        if parts == ["importlib", "import_module"]:
            self._unresolved(node, ast.unparse(node.func), "dynamic_import")
            return
        if len(parts) == 2 and receiver in {"self", "cls"}:
            class_id = self._method_class(receiver)
            method_candidates = self._class_methods(class_id, parts[-1])
            if method_candidates:
                bindings = [
                    _Binding(module=self.module, target_id=item.id)
                    for item in method_candidates
                ]
                self._emit_candidates(node, bindings, f"{receiver}_method")
                return
        lookup = self._lookup(receiver)
        if lookup.blocked:
            self._unresolved(node, ast.unparse(node.func), "local_binding")
            return
        candidates: list[SymbolNode] = []
        modules: list[str] = []
        for binding in lookup.bindings:
            if binding.target_id is not None:
                continue
            module = ".".join([binding.module, *parts[1:-1]])
            modules.append(module)
            candidates.extend(self.top_by_module_name.get((module, parts[-1]), []))
        if candidates:
            bindings = [_Binding(module=self.module, target_id=item.id) for item in candidates]
            self._emit_candidates(node, bindings, "module_attribute")
            return
        if modules:
            self.external.update(module for module in modules if module not in self.module_files)
            self._unresolved(node, ast.unparse(node.func), "external_or_unknown_attribute")
            return
        self._unresolved(node, ast.unparse(node.func), "unknown_receiver_type")

    def _class_methods(self, class_id: str | None, name: str) -> list[SymbolNode]:
        if class_id is None:
            return []
        direct = self.children.get((class_id, name), [])
        if direct:
            return direct
        result: list[SymbolNode] = []
        for base_id in self.class_bases.get(class_id, []):
            result.extend(self._class_methods(base_id, name))
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
                    is_package=file.path == "__init__.py" or file.path.endswith("/__init__.py"),
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
