from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from faultmesh.project_runner.runner import _content_hash
from faultmesh.structure import build_structure_export
from faultmesh.structure.models import FileChangeKind, StructureExport


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
    (root / "a.py").write_text("def value():\n    return 1\n", encoding="utf-8")
    return root, _commit(root, "base")


def _helper(path: Path, marker: Path) -> None:
    path.write_text(f"#!/bin/sh\ntouch {marker!s}\nexit 0\n", encoding="utf-8")
    path.chmod(0o755)


def _state(root: Path) -> tuple[str, str, str]:
    return (
        _git(root, "rev-parse", "HEAD"),
        _git(root, "diff", "--cached", "--binary"),
        _content_hash(root),
    )


def _assert_modified(exported: StructureExport) -> None:
    git = exported.git
    changed = [item for item in git.files if item.path == "a.py"]
    assert len(changed) == 1
    assert changed[0].status == FileChangeKind.MODIFIED


def test_repository_external_diff_is_never_executed(tmp_path: Path) -> None:
    root, _ = _repo(tmp_path)
    marker = tmp_path / "repo-external-ran"
    helper = tmp_path / "external-diff"
    _helper(helper, marker)
    _git(root, "config", "diff.external", str(helper))
    (root / "a.py").write_text("def value():\n    return 2\n", encoding="utf-8")
    before = _state(root)

    exported = build_structure_export(root)

    _assert_modified(exported)
    assert not marker.exists()
    assert _state(root) == before


def test_inherited_external_diff_is_disabled_for_revision_comparison(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, base = _repo(tmp_path)
    (root / "a.py").write_text("def value():\n    return 2\n", encoding="utf-8")
    head = _commit(root, "head")
    marker = tmp_path / "environment-external-ran"
    helper = tmp_path / "environment-diff"
    _helper(helper, marker)
    monkeypatch.setenv("GIT_EXTERNAL_DIFF", str(helper))
    before = _state(root)

    exported = build_structure_export(root, base=base, head=head)

    _assert_modified(exported)
    assert not marker.exists()
    assert _state(root) == before


def test_textconv_driver_is_disabled_for_worktree_and_revisions(tmp_path: Path) -> None:
    root, base = _repo(tmp_path)
    marker = tmp_path / "textconv-ran"
    helper = tmp_path / "textconv"
    _helper(helper, marker)
    (root / ".gitattributes").write_text("*.py diff=marker\n", encoding="utf-8")
    _git(root, "config", "diff.marker.textconv", str(helper))
    _commit(root, "attributes")
    base = _git(root, "rev-parse", "HEAD")
    (root / "a.py").write_text("def value():\n    return 2\n", encoding="utf-8")
    before_worktree = _state(root)

    worktree = build_structure_export(root)

    _assert_modified(worktree)
    assert not marker.exists()
    assert _state(root) == before_worktree

    head = _commit(root, "head")
    before_revision = _state(root)
    revision = build_structure_export(root, base=base, head=head)

    _assert_modified(revision)
    assert not marker.exists()
    assert _state(root) == before_revision


def test_scan_sets_optional_locks_off_without_mutating_caller_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _ = _repo(tmp_path)
    (root / "a.py").write_text("def value():\n    return 2\n", encoding="utf-8")
    monkeypatch.setenv("GIT_OPTIONAL_LOCKS", "caller-value")

    build_structure_export(root)

    assert os.environ["GIT_OPTIONAL_LOCKS"] == "caller-value"
