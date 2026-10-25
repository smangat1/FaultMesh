from pathlib import Path

from faultmesh.analysis import ContextBuilder, ProjectAnalyzer

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def test_ast_analysis_extracts_behavioral_metadata_without_importing() -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    function = next(item for item in index.functions if item.name == "bounded_increment")
    assert function.parameters[0].name == "value"
    assert function.return_annotation == "int"
    assert function.branch_count == 1
    assert "never exceed" in (function.docstring or "")
    assert function.reference.content_hash
    assert "if value <= maximum" in ContextBuilder().for_function(function)


def test_focus_cannot_escape_repository() -> None:
    try:
        ProjectAnalyzer().analyze(EXAMPLE, focus=Path(".."))
    except ValueError as exc:
        assert "inside" in str(exc)
    else:
        raise AssertionError("escaping focus was accepted")

