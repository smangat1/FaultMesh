from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from faultmesh.project_runner.runner import _content_hash
from faultmesh.structure import StructureGitError, build_structure_index, compare_git
from faultmesh.structure.models import ChangeStatus, FileChangeKind


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _commit(root: Path, message: str) -> str:
    _git(root, "add", ".")
    _git(
        root,
        "-c",
        "user.name=FaultMesh Test",
        "-c",
        "user.email=faultmesh@example.invalid",
        "commit",
        "-q",
        "-m",
        message,
    )
    return _git(root, "rev-parse", "HEAD")


def _repo(tmp_path: Path) -> tuple[Path, str]:
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-q")
    (root / "sample.py").write_text(
        "def kept():\n    value = 1\n    return value\n\ndef removed():\n    return 2\n",
        encoding="utf-8",
    )
    (root / "rename.py").write_text("def moved():\n    return 3\n", encoding="utf-8")
    return root, _commit(root, "base")


def test_worktree_git_status_and_symbol_hunks_are_read_only(tmp_path: Path) -> None:
    root, base = _repo(tmp_path)
    _git(root, "mv", "rename.py", "renamed.py")
    (root / "sample.py").write_text(
        "def kept():\n    return 1\n\ndef added():\n    return 4\n",
        encoding="utf-8",
    )
    (root / "new.py").write_text("VALUE = 1\n", encoding="utf-8")
    before_head = _git(root, "rev-parse", "HEAD")
    before_index = _git(root, "diff", "--cached", "--binary")
    before_hash = _content_hash(root)

    result = compare_git(root, build_structure_index(root), base=base)

    file_status = {item.path: item for item in result.comparison.files}
    assert file_status["sample.py"].status == FileChangeKind.MODIFIED
    assert file_status["renamed.py"].status == FileChangeKind.RENAMED
    assert file_status["renamed.py"].similarity == 100
    assert file_status["new.py"].status == FileChangeKind.UNTRACKED
    symbol_status = {item.symbol_id: item.status for item in result.comparison.symbols}
    assert symbol_status["symbol:sample.py:kept"] == ChangeStatus.MODIFIED
    assert symbol_status["symbol:sample.py:added"] == ChangeStatus.ADDED
    assert symbol_status["symbol:sample.py:removed"] == ChangeStatus.REMOVED
    assert symbol_status["symbol:renamed.py:moved"] == ChangeStatus.UNCHANGED
    assert any(
        item.id == "symbol:sample.py:removed" and item.removed
        for item in result.removed_symbols
    )
    assert _git(root, "rev-parse", "HEAD") == before_head
    assert _git(root, "diff", "--cached", "--binary") == before_index
    assert _content_hash(root) == before_hash


def test_commit_comparison_detached_and_invalid_revision(tmp_path: Path) -> None:
    root, base = _repo(tmp_path)
    (root / "sample.py").write_text("def kept():\n    return 8\n", encoding="utf-8")
    head = _commit(root, "change")
    _git(root, "checkout", "--detach", "-q", head)

    result = compare_git(root, build_structure_index(root), base=base, head=head)
    assert result.comparison.detached is True
    assert result.comparison.base == base
    assert result.comparison.head == head
    with pytest.raises(StructureGitError, match="missing or ambiguous"):
        compare_git(root, build_structure_index(root), base="does-not-exist")


def test_non_git_and_repository_without_commits(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    unavailable = compare_git(plain, build_structure_index(plain))
    assert unavailable.comparison.available is False

    empty = tmp_path / "empty"
    empty.mkdir()
    _git(empty, "init", "-q")
    (empty / "new.py").write_text("def new():\n    return 1\n", encoding="utf-8")
    no_commits = compare_git(empty, build_structure_index(empty))
    assert no_commits.comparison.available is True
    assert no_commits.comparison.error == "repository has no commits"
    assert no_commits.comparison.files[0].untracked is True


def test_shallow_clone_is_reported(tmp_path: Path) -> None:
    source, _ = _repo(tmp_path)
    clone = tmp_path / "shallow"
    subprocess.run(
        ["git", "clone", "-q", "--depth", "1", f"file://{source}", str(clone)],
        check=True,
    )
    result = compare_git(clone, build_structure_index(clone))
    assert result.comparison.shallow is True


def test_add_delete_rename_with_edit_and_copy(tmp_path: Path) -> None:
    root, base = _repo(tmp_path)
    (root / "delete.py").write_text("def gone():\n    return 1\n", encoding="utf-8")
    (root / "edit_name.py").write_text("def edited():\n    return 2\n", encoding="utf-8")
    base = _commit(root, "more files")
    (root / "delete.py").unlink()
    _git(root, "mv", "edit_name.py", "edited_name.py")
    (root / "edited_name.py").write_text("def edited():\n    return 20\n", encoding="utf-8")
    (root / "added.py").write_text("def added():\n    return 4\n", encoding="utf-8")
    shutil.copyfile(root / "rename.py", root / "copied.py")
    _git(root, "add", "added.py", "copied.py")

    result = compare_git(root, build_structure_index(root), base=base)
    statuses = {item.path: item for item in result.comparison.files}
    assert statuses["delete.py"].status == FileChangeKind.DELETED
    assert statuses["edited_name.py"].status == FileChangeKind.RENAMED
    assert statuses["edited_name.py"].similarity is not None
    assert statuses["edited_name.py"].similarity < 100
    assert statuses["added.py"].status == FileChangeKind.ADDED
    assert statuses["copied.py"].status == FileChangeKind.COPIED


def test_missing_git_binary_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    monkeypatch.setattr(shutil, "which", lambda name: None)
    result = compare_git(tmp_path, build_structure_index(tmp_path))
    assert result.comparison.available is False
    assert result.comparison.error == "git executable is unavailable"


def test_project_subdirectory_is_scoped_to_that_project(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    project = root / "examples" / "small"
    project.mkdir(parents=True)
    _git(root, "init", "-q")
    (root / "outside.py").write_text("def outside():\n    return 1\n", encoding="utf-8")
    (project / "inside.py").write_text("def inside():\n    return 1\n", encoding="utf-8")
    _commit(root, "base")
    (project / "inside.py").write_text("def inside():\n    return 2\n", encoding="utf-8")

    result = compare_git(project, build_structure_index(project))

    assert {item.path for item in result.head_index.files} == {"inside.py"}
    assert {item.path for item in result.comparison.files} == {"inside.py"}
