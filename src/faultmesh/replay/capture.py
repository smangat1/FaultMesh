"""Bounded, non-executing capture of one explicitly selected project root."""

from __future__ import annotations

import base64
import fnmatch
import hashlib
import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from faultmesh.replay.models import (
    CapturedFile,
    CaptureFilePayload,
    CaptureLimits,
    SkippedPath,
    SkipReason,
    SnapshotManifest,
)
from faultmesh.structure.index import index_python_bytes

IGNORED_DIRECTORIES = {
    ".faultmesh",
    ".git",
    ".hg",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".svn",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "htmlcov",
    "node_modules",
    "target",
    "vendor",
}
SECRET_PATTERNS = (
    ".env*",
    "*.key",
    "*.p12",
    "*.pem",
    "*credentials*",
    "*secret*",
    "*token*",
    "id_ed25519*",
    "id_rsa*",
)
SOURCE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".go",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".rb",
    ".rs",
    ".swift",
    ".ts",
    ".tsx",
}


@dataclass(frozen=True)
class CapturedSnapshot:
    manifest: SnapshotManifest
    payloads: list[CaptureFilePayload]


def root_identity(root: Path) -> str:
    return hashlib.sha256(os.fsencode(root.resolve(strict=True))).hexdigest()


def _secret_like(name: str) -> bool:
    lowered = name.lower()
    return any(fnmatch.fnmatchcase(lowered, pattern) for pattern in SECRET_PATTERNS)


def _read_stable(path: Path, max_bytes: int) -> tuple[bytes, int] | str:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        return type(exc).__name__
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            return "not_regular_file"
        if before.st_size > max_bytes:
            return "file_too_large"
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = os.fstat(descriptor)
        before_key = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        after_key = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        if before_key != after_key:
            return "changed_during_read"
        if len(data) > max_bytes:
            return "file_too_large"
        return data, after.st_mtime_ns
    finally:
        os.close(descriptor)


def _manifest_id(files: list[CapturedFile], skipped: list[SkippedPath], partial: bool) -> str:
    value = {
        "files": [item.model_dump(mode="json") for item in files],
        "partial": partial,
        "skipped": [item.model_dump(mode="json") for item in skipped],
    }
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return f"manifest:{hashlib.sha256(encoded).hexdigest()}"


def capture_snapshot(root: Path | str, limits: CaptureLimits | None = None) -> CapturedSnapshot:
    selected = Path(root).resolve(strict=True)
    if not selected.is_dir():
        raise ValueError("selected replay root must be a directory")
    active_limits = limits or CaptureLimits()
    files: list[CapturedFile] = []
    payloads: list[CaptureFilePayload] = []
    skipped: list[SkippedPath] = []
    total_bytes = 0
    partial = False

    for current, dirs, names in os.walk(selected, topdown=True, followlinks=False):
        current_path = Path(current)
        kept: list[str] = []
        for name in sorted(dirs):
            path = current_path / name
            relative = path.relative_to(selected).as_posix()
            if name in IGNORED_DIRECTORIES:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.IGNORED_DIRECTORY))
            elif path.is_symlink():
                skipped.append(SkippedPath(path=relative, reason=SkipReason.SYMLINK))
            else:
                kept.append(name)
        dirs[:] = kept

        for name in sorted(names):
            path = current_path / name
            relative = path.relative_to(selected).as_posix()
            if path.is_symlink():
                skipped.append(SkippedPath(path=relative, reason=SkipReason.SYMLINK))
                continue
            if _secret_like(name):
                skipped.append(SkippedPath(path=relative, reason=SkipReason.SECRET_LIKE_NAME))
                continue
            if path.suffix.lower() in SOURCE_EXTENSIONS:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.NON_PYTHON_SOURCE))
                continue
            if path.suffix.lower() != ".py":
                continue
            if len(files) >= active_limits.max_files:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.FILE_LIMIT))
                partial = True
                continue
            result = _read_stable(path, active_limits.max_file_bytes)
            if isinstance(result, str):
                reason = {
                    "changed_during_read": SkipReason.CHANGED_DURING_READ,
                    "file_too_large": SkipReason.FILE_TOO_LARGE,
                }.get(result, SkipReason.READ_ERROR)
                skipped.append(SkippedPath(path=relative, reason=reason, detail=result))
                partial = True
                continue
            data, mtime_ns = result
            if b"\x00" in data:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.BINARY))
                partial = True
                continue
            try:
                data.decode("utf-8")
            except UnicodeDecodeError:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.NON_UTF8))
                partial = True
                continue
            if total_bytes + len(data) > active_limits.max_snapshot_bytes:
                skipped.append(SkippedPath(path=relative, reason=SkipReason.SNAPSHOT_LIMIT))
                partial = True
                continue
            digest = hashlib.sha256(data).hexdigest()
            file_node, _symbols, parse_error = index_python_bytes(relative, data)
            captured = CapturedFile(
                path=relative,
                content_sha256=digest,
                size=len(data),
                mtime_ns=mtime_ns,
                parse_ok=parse_error is None,
                parse_error=file_node.parse_error,
            )
            files.append(captured)
            payloads.append(
                CaptureFilePayload(
                    path=relative,
                    content_sha256=digest,
                    size=len(data),
                    mtime_ns=mtime_ns,
                    content_base64=base64.b64encode(data).decode("ascii"),
                )
            )
            total_bytes += len(data)

    files.sort(key=lambda item: item.path)
    payloads.sort(key=lambda item: item.path)
    skipped.sort(key=lambda item: (item.path, str(item.reason)))
    manifest = SnapshotManifest(
        id=_manifest_id(files, skipped, partial),
        files=files,
        skipped=skipped,
        partial=partial,
    )
    return CapturedSnapshot(manifest=manifest, payloads=payloads)
