from __future__ import annotations

from pathlib import Path

from faultmesh.structure import build_structure_index
from faultmesh.structure.models import SymbolKind


def test_index_keeps_all_files_symbols_metadata_and_duplicate_names(tmp_path: Path) -> None:
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "module.py").write_text(
        '''class Parent:
    """First class line.

    More text.
    """
    @property
    def value(self) -> int:
        return 1

    @value.setter
    def value(self, new):
        return None

async def outer(arg: str = "x") -> None:
    def nested():
        return arg
    await something()
''',
        encoding="utf-8",
    )
    (tmp_path / "empty.py").write_text("", encoding="utf-8")
    (tmp_path / "broken.py").write_text("def nope(:\n", encoding="utf-8")
    (tmp_path / "binary.py").write_bytes(b"value = '\xff'\n")
    (tmp_path / "test_sample.py").write_text("VALUE = 1\n", encoding="utf-8")

    result = build_structure_index(tmp_path)

    assert [item.path for item in result.files] == [
        "binary.py",
        "broken.py",
        "empty.py",
        "pkg/__init__.py",
        "pkg/module.py",
        "test_sample.py",
    ]
    assert result.files[0].parse_error is not None
    assert result.files[1].parse_error is not None
    assert result.files[-1].is_test is True
    symbols = {item.id: item for item in result.symbols}
    first = symbols["symbol:pkg/module.py:Parent.value"]
    second = symbols["symbol:pkg/module.py:Parent.value@2"]
    assert first.decorators == ["property"]
    assert second.decorators == ["value.setter"]
    assert second.disambiguator == 2
    assert symbols["symbol:pkg/module.py:Parent"].docstring is not None
    assert symbols["symbol:pkg/module.py:Parent"].docstring.text == "First class line."
    assert symbols["symbol:pkg/module.py:outer"].kind == SymbolKind.ASYNC_FUNCTION
    assert symbols["symbol:pkg/module.py:outer.nested"].kind == SymbolKind.NESTED_FUNCTION


def test_index_skips_ignored_and_symlink_paths(tmp_path: Path) -> None:
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "ignored.py").write_text("x = 1\n", encoding="utf-8")
    outside = tmp_path.parent / f"{tmp_path.name}-outside.py"
    outside.write_text("x = 1\n", encoding="utf-8")
    try:
        (tmp_path / "escape.py").symlink_to(outside)
        result = build_structure_index(tmp_path)
    finally:
        outside.unlink()

    assert result.files == []
    assert {(item.path, item.reason) for item in result.skips} == {
        (".venv", "ignored_directory"),
        ("escape.py", "symlink_file"),
    }
