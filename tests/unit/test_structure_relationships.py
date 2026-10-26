from __future__ import annotations

from pathlib import Path

from faultmesh.structure import build_relationships, build_structure_index
from faultmesh.structure.models import EdgeConfidence, EdgeKind


def test_relationships_resolve_project_imports_aliases_and_calls(tmp_path: Path) -> None:
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "__init__.py").write_text("from . import helper\n", encoding="utf-8")
    (package / "helper.py").write_text(
        "def useful():\n    return 1\n\ndef duplicate():\n    return 1\n",
        encoding="utf-8",
    )
    (package / "consumer.py").write_text(
        """from .helper import useful as imported
from . import helper

def local():
    return imported()

def through_module():
    return helper.useful()

def caller():
    return local()
""",
        encoding="utf-8",
    )

    index = build_structure_index(tmp_path)
    result = build_relationships(tmp_path, index)

    resolved_calls = {
        (edge.source_id, edge.target_id, edge.resolution_reason)
        for edge in result.edges
        if edge.kind == EdgeKind.POSSIBLE_CALL
        and edge.confidence == EdgeConfidence.RESOLVED
    }
    assert (
        "symbol:pkg/consumer.py:local",
        "symbol:pkg/helper.py:useful",
        "import_binding",
    ) in resolved_calls
    assert (
        "symbol:pkg/consumer.py:through_module",
        "symbol:pkg/helper.py:useful",
        "module_attribute",
    ) in resolved_calls
    assert (
        "symbol:pkg/consumer.py:caller",
        "symbol:pkg/consumer.py:local",
        "same_scope",
    ) in resolved_calls
    assert any(edge.resolution_reason == "from_import_submodule" for edge in result.edges)


def test_relationships_resolve_src_layout_modules(tmp_path: Path) -> None:
    package = tmp_path / "src" / "project"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("from project.value import value\n", encoding="utf-8")
    (package / "value.py").write_text("def value():\n    return 1\n", encoding="utf-8")
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "test_value.py").write_text(
        "from project import value\n\ndef test_value():\n    assert value() == 1\n",
        encoding="utf-8",
    )

    index = build_structure_index(tmp_path)
    result = build_relationships(tmp_path, index)

    modules = {item.path: item.module for item in index.files}
    assert modules["src/project/__init__.py"] == "project"
    assert modules["src/project/value.py"] == "project.value"
    assert any(
        edge.kind == EdgeKind.POSSIBLE_CALL
        and edge.target_id == "symbol:src/project/value.py:value"
        for edge in result.edges
    )


def test_relationships_handle_methods_ambiguity_and_unresolved_references(tmp_path: Path) -> None:
    (tmp_path / "sample.py").write_text(
        """from unknown import *
import importlib

def repeated():
    return 1

if FLAG:
    def repeated():
        return 2

class Base:
    def inherited(self):
        return 1

class Child(Base):
    @decorate
    def direct(self):
        return self.inherited()

def caller(value):
    repeated()
    getattr(value, "method")()
    importlib.import_module("thing")
    value.unknown()
""",
        encoding="utf-8",
    )

    index = build_structure_index(tmp_path)
    result = build_relationships(tmp_path, index)

    repeated = [
        edge
        for edge in result.edges
        if edge.kind == EdgeKind.POSSIBLE_CALL
        and edge.source_id == "symbol:sample.py:caller"
        and edge.resolution_reason == "same_scope"
    ]
    assert len(repeated) == 2
    assert {edge.confidence for edge in repeated} == {EdgeConfidence.AMBIGUOUS}
    assert any(edge.resolution_reason == "self_method" for edge in result.edges)
    reasons = {item.reason for item in result.unresolved}
    expected = {
        "star_import",
        "dynamic_reference",
        "dynamic_import",
        "unknown_receiver_type",
        "decorator_semantics",
    }
    assert expected <= reasons
    assert "importlib" in result.external_modules
