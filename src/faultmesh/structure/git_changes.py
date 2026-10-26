"""Read-only Git file and symbol comparisons."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from faultmesh.project_runner.runner import _content_hash
from faultmesh.structure.index import build_structure_index
from faultmesh.structure.models import (
    ChangeStatus,
    FileChangeKind,
    FileGitStatus,
    GitComparison,
    StructureIndex,
    SymbolGitStatus,
    SymbolNode,
)

_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class StructureGitError(RuntimeError):
    pass


@dataclass(frozen=True)
class GitAnalysis:
    comparison: GitComparison
    head_index: StructureIndex
    removed_symbols: list[SymbolNode]


def _run(root: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *arguments],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise StructureGitError("git executable is unavailable") from exc
    if check and completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise StructureGitError(f"git {' '.join(arguments)} failed: {detail}")
    return completed


def _run_bytes(root: Path, *arguments: str) -> bytes:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *arguments],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise StructureGitError("git executable is unavailable") from exc
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise StructureGitError(f"git {' '.join(arguments)} failed: {detail}")
    return completed.stdout


def _resolve(root: Path, revision: str) -> str:
    completed = _run(root, "rev-parse", "--verify", f"{revision}^{{commit}}", check=False)
    value = completed.stdout.strip()
    if completed.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise StructureGitError(f"Git revision is missing or ambiguous: {revision}")
    return value


def _index_revision(root: Path, revision: str) -> StructureIndex:
    listing = _run_bytes(root, "ls-tree", "-r", "-z", "--name-only", revision)
    paths = [
        item.decode("utf-8", errors="surrogateescape")
        for item in listing.split(b"\0")
        if item
    ]
    with tempfile.TemporaryDirectory(prefix="faultmesh-structure-") as temporary:
        target = Path(temporary)
        for relative in sorted(path for path in paths if path.endswith(".py")):
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(_run_bytes(root, "show", f"{revision}:{relative}"))
        return build_structure_index(target)


def _name_status(
    root: Path, base: str, head: str | None
) -> tuple[list[FileGitStatus], dict[str, str]]:
    arguments = [
        "diff",
        "--name-status",
        "--find-renames=50%",
        "--find-copies=50%",
        "--find-copies-harder",
        base,
    ]
    if head is not None:
        arguments.append(head)
    output = _run(root, *arguments).stdout
    changes: list[FileGitStatus] = []
    renames: dict[str, str] = {}
    for line in output.splitlines():
        fields = line.split("\t")
        code = fields[0]
        letter = code[0]
        similarity = int(code[1:]) if len(code) > 1 and code[1:].isdigit() else None
        if letter in {"R", "C"} and len(fields) == 3:
            old_path, path = fields[1], fields[2]
            status = FileChangeKind.RENAMED if letter == "R" else FileChangeKind.COPIED
            changes.append(
                FileGitStatus(
                    path=path,
                    old_path=old_path,
                    status=status,
                    similarity=similarity,
                    python=path.endswith(".py") or old_path.endswith(".py"),
                )
            )
            if letter == "R":
                renames[old_path] = path
            continue
        if len(fields) != 2:
            continue
        path = fields[1]
        status = {
            "A": FileChangeKind.ADDED,
            "M": FileChangeKind.MODIFIED,
            "D": FileChangeKind.DELETED,
        }.get(letter, FileChangeKind.MODIFIED)
        changes.append(FileGitStatus(path=path, status=status, python=path.endswith(".py")))
    return changes, renames


def _untracked(root: Path) -> list[str]:
    output = _run(root, "ls-files", "--others", "--exclude-standard", "-z").stdout
    return sorted(item for item in output.split("\0") if item)


def _hunks(
    root: Path, base: str, head: str | None
) -> tuple[dict[str, list[tuple[int, int]]], dict[str, list[tuple[int, int]]]]:
    arguments = ["diff", "--unified=0", "--no-color", "--find-renames=50%", base]
    if head is not None:
        arguments.append(head)
    output = _run(root, *arguments, "--", "*.py").stdout
    old_ranges: dict[str, list[tuple[int, int]]] = {}
    new_ranges: dict[str, list[tuple[int, int]]] = {}
    old_path: str | None = None
    new_path: str | None = None
    for line in output.splitlines():
        if line.startswith("--- "):
            value = line[4:]
            old_path = None if value == "/dev/null" else value.removeprefix("a/")
        elif line.startswith("+++ "):
            value = line[4:]
            new_path = None if value == "/dev/null" else value.removeprefix("b/")
        elif line.startswith("@@ "):
            match = _HUNK.match(line)
            if match is None:
                continue
            old_start, old_count, new_start, new_count = (
                int(match[1]),
                int(match[2] or "1"),
                int(match[3]),
                int(match[4] or "1"),
            )
            if old_path is not None:
                old_end = old_start if old_count == 0 else old_start + old_count - 1
                old_ranges.setdefault(old_path, []).append((old_start, old_end))
            if new_path is not None:
                new_end = new_start if new_count == 0 else new_start + new_count - 1
                new_ranges.setdefault(new_path, []).append((new_start, new_end))
    return old_ranges, new_ranges


def _overlaps(symbol: SymbolNode, ranges: list[tuple[int, int]]) -> bool:
    return any(start <= symbol.end_line and end >= symbol.start_line for start, end in ranges)


def _symbol_statuses(
    old: StructureIndex,
    new: StructureIndex,
    renames: dict[str, str],
    old_hunks: dict[str, list[tuple[int, int]]],
    new_hunks: dict[str, list[tuple[int, int]]],
) -> tuple[list[SymbolGitStatus], list[SymbolNode]]:
    old_by_key = {
        (renames.get(item.path, item.path), item.qualified_name, item.disambiguator): item
        for item in old.symbols
    }
    new_by_key = {
        (item.path, item.qualified_name, item.disambiguator): item for item in new.symbols
    }
    statuses: list[SymbolGitStatus] = []
    removed: list[SymbolNode] = []
    for key in sorted(set(old_by_key) | set(new_by_key)):
        before = old_by_key.get(key)
        after = new_by_key.get(key)
        if before is None and after is not None:
            statuses.append(SymbolGitStatus(symbol_id=after.id, status=ChangeStatus.ADDED))
        elif after is None and before is not None:
            ghost = before.model_copy(update={"removed": True})
            removed.append(ghost)
            statuses.append(SymbolGitStatus(symbol_id=ghost.id, status=ChangeStatus.REMOVED))
        elif before is not None and after is not None:
            modified = (
                before.content_sha256 != after.content_sha256
                or _overlaps(before, old_hunks.get(before.path, []))
                or _overlaps(after, new_hunks.get(after.path, []))
            )
            statuses.append(
                SymbolGitStatus(
                    symbol_id=after.id,
                    old_symbol_id=before.id if before.id != after.id else None,
                    status=ChangeStatus.MODIFIED if modified else ChangeStatus.UNCHANGED,
                )
            )
    return statuses, removed


def _not_repository(root: Path, current: StructureIndex, error: str) -> GitAnalysis:
    return GitAnalysis(
        comparison=GitComparison(available=False, error=error),
        head_index=current,
        removed_symbols=[],
    )


def compare_git(
    root: Path,
    current: StructureIndex,
    *,
    base: str = "HEAD",
    head: str = "worktree",
) -> GitAnalysis:
    root = root.resolve()
    if shutil.which("git") is None:
        return _not_repository(root, current, "git executable is unavailable")
    inside = _run(root, "rev-parse", "--is-inside-work-tree", check=False)
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return _not_repository(root, current, "project is not a Git worktree")
    has_head = _run(root, "rev-parse", "--verify", "HEAD^{commit}", check=False)
    if has_head.returncode != 0:
        untracked = _untracked(root)
        files = [
            FileGitStatus(
                path=item.path,
                status=FileChangeKind.UNTRACKED,
                untracked=True,
            )
            for item in current.files
            if item.path in untracked
        ]
        symbols = [
            SymbolGitStatus(symbol_id=item.id, status=ChangeStatus.ADDED)
            for item in current.symbols
        ]
        return GitAnalysis(
            comparison=GitComparison(
                available=True,
                error="repository has no commits",
                head_is_worktree=True,
                dirty=bool(untracked),
                worktree_content_sha256=_content_hash(root),
                files=files,
                symbols=symbols,
            ),
            head_index=current,
            removed_symbols=[],
        )
    base_sha = _resolve(root, base)
    head_is_worktree = head == "worktree"
    head_sha = _resolve(root, "HEAD") if head_is_worktree else _resolve(root, head)
    old_index = _index_revision(root, base_sha)
    head_index = current if head_is_worktree else _index_revision(root, head_sha)
    changes, renames = _name_status(root, base_sha, None if head_is_worktree else head_sha)
    if head_is_worktree:
        for path in _untracked(root):
            changes.append(
                FileGitStatus(
                    path=path,
                    status=FileChangeKind.UNTRACKED,
                    untracked=True,
                    python=path.endswith(".py"),
                )
            )
    changed_paths = {item.path for item in changes}
    changed_old_paths = {item.old_path for item in changes if item.old_path is not None}
    all_paths = {item.path for item in old_index.files} | {item.path for item in head_index.files}
    for path in sorted(all_paths - changed_paths - changed_old_paths):
        changes.append(FileGitStatus(path=path, status=FileChangeKind.UNCHANGED))
    old_hunks, new_hunks = _hunks(root, base_sha, None if head_is_worktree else head_sha)
    symbol_statuses, removed = _symbol_statuses(
        old_index, head_index, renames, old_hunks, new_hunks
    )
    status = _run(root, "status", "--porcelain=v1", "--untracked-files=all").stdout
    detached = _run(root, "symbolic-ref", "-q", "HEAD", check=False).returncode != 0
    shallow = _run(root, "rev-parse", "--is-shallow-repository").stdout.strip() == "true"
    submodules = sum(1 for item in head_index.skips if item.reason == "git_submodule")
    return GitAnalysis(
        comparison=GitComparison(
            available=True,
            base=base_sha,
            head=head_sha,
            head_is_worktree=head_is_worktree,
            detached=detached,
            shallow=shallow,
            dirty=bool(status),
            worktree_content_sha256=_content_hash(root),
            files=sorted(changes, key=lambda item: (item.path, item.old_path or "")),
            symbols=symbol_statuses,
            non_python_changes=sum(not item.python for item in changes),
            skipped_submodules=submodules,
        ),
        head_index=head_index,
        removed_symbols=removed,
    )
