"""Conservative discovery and lightweight indexing for local agent history."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.claude_history import KNOWN_CLAUDE_FORMAT_VERSIONS
from faultmesh.replay.codex_history import KNOWN_CODEX_FORMAT_VERSIONS
from faultmesh.replay.history_context import strip_injected_context
from faultmesh.replay.privacy import redact_history_text

DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024
DEFAULT_PREVIEW_CHARACTERS = 160
HistoryTool = Literal["codex", "claude_code"]
ParseStatus = Literal["ok", "partial", "unsupported"]
HistoryState = Literal["active", "archived"]
ProjectVisibility = Literal["normal", "system_temp"]
CatalogStatus = Literal["ok", "missing", "unsupported", "unreadable"]


class HistoryRootStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    tool: HistoryTool
    status: Literal["ok", "missing", "unreadable"]
    file_count: int = Field(ge=0)
    message: str
    active_file_count: int | None = Field(default=None, ge=0)
    archived_file_count: int | None = Field(default=None, ge=0)
    catalog_status: CatalogStatus | None = None
    catalog_message: str | None = None


class HistorySessionIndex(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    session_id: str
    tool: HistoryTool
    project_group_key: str
    project_display_name: str
    started_at: datetime
    ended_at: datetime
    prompt_count: int = Field(ge=0)
    first_prompt_preview: str | None = None
    format_version: str | None = None
    parse_status: ParseStatus
    unsupported_reason: str | None = None
    source_file_sha256: str
    redaction_types: list[str] = Field(default_factory=list)
    history_state: HistoryState | None = None
    project_visibility: ProjectVisibility | None = None
    source_title: str | None = None
    catalog_first_user_message_preview: str | None = None
    catalog_preview: str | None = None
    catalog_matched: bool | None = None
    injected_context_messages: int | None = Field(default=None, ge=0)


class HistoryDiscoveryResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    roots: list[HistoryRootStatus]
    sessions: list[HistorySessionIndex]


class HistoryFileChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    source_key: str
    tool: HistoryTool
    change: Literal["added", "modified", "removed"]
    mtime_ns: int = Field(ge=0)
    size: int = Field(ge=0)


def default_codex_history_root() -> Path:
    codex_home = os.environ.get("CODEX_HOME")
    return (
        Path(codex_home).expanduser() / "sessions"
        if codex_home
        else Path.home() / ".codex" / "sessions"
    )


def default_codex_catalog_path() -> Path:
    sqlite_home = os.environ.get("CODEX_SQLITE_HOME")
    if sqlite_home:
        return Path(sqlite_home).expanduser() / "state_5.sqlite"
    return default_codex_history_root().parent / "state_5.sqlite"


def default_claude_history_root() -> Path:
    return Path.home() / ".claude" / "projects"


def _history_files(root: Path, tool: HistoryTool) -> tuple[list[Path], bool]:
    files: list[Path] = []
    unreadable = False

    def on_error(_error: OSError) -> None:
        nonlocal unreadable
        unreadable = True

    try:
        for current, directories, names in os.walk(root, followlinks=False, onerror=on_error):
            current_path = Path(current)
            directories[:] = [
                name for name in directories if not (current_path / name).is_symlink()
            ]
            for name in names:
                path = current_path / name
                if path.is_symlink() or not path.is_file():
                    continue
                is_codex_history = tool == "codex" and (
                    name.endswith(".jsonl") or name.endswith(".jsonl.zst")
                )
                is_claude_history = tool == "claude_code" and name.endswith(".jsonl")
                if is_codex_history or is_claude_history:
                    files.append(path)
    except OSError:
        unreadable = True
    return sorted(files), unreadable


def _source_digest(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _read_bounded(
    path: Path,
    *,
    max_source_bytes: int,
    zstd_executable: Path | str | None,
    allow_zstd_lookup: bool,
) -> tuple[bytes | None, str, str | None]:
    try:
        digest, size = _source_digest(path)
    except OSError:
        return None, hashlib.sha256(str(path).encode()).hexdigest(), "history_source_unreadable"
    if size > max_source_bytes:
        return None, digest, "source_exceeds_configured_read_limit"
    if not path.name.endswith(".jsonl.zst"):
        try:
            return path.read_bytes(), digest, None
        except OSError:
            return None, digest, "history_source_unreadable"

    executable = str(zstd_executable) if zstd_executable is not None else None
    if executable is None and allow_zstd_lookup:
        executable = shutil.which("zstd")
    if executable is None:
        return None, digest, "zstd_executable_not_found"
    try:
        process = subprocess.Popen(
            [executable, "--decompress", "--stdout", "--quiet", "--", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return None, digest, "zstd_decompression_failed"
    assert process.stdout is not None
    try:
        data = process.stdout.read(max_source_bytes + 1)
        if len(data) > max_source_bytes:
            process.kill()
            process.wait(timeout=5)
            return None, digest, "decompressed_source_exceeds_configured_read_limit"
        return_code = process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
        return None, digest, "zstd_decompression_failed"
    if return_code != 0:
        return None, digest, "zstd_decompression_failed"
    return data, digest, None


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _project_identity(value: str | None, display_fallback: str) -> tuple[str, str]:
    normalized = (value or "").replace("\\", "/").rstrip("/")
    key = hashlib.sha256(normalized.encode()).hexdigest()
    return key, normalized.rsplit("/", 1)[-1] if normalized else display_fallback


def _is_within(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def _project_visibility(value: str | None) -> ProjectVisibility:
    if not value:
        return "normal"
    normalized = os.path.realpath(os.path.expanduser(value)).replace("\\", "/").rstrip("/")
    roots = {
        "/var/folders",
        "/private/var/folders",
        "/private/tmp",
        "/tmp",
        "/var/tmp",
        "/dev/shm",
    }
    tmpdir = os.environ.get("TMPDIR")
    if tmpdir:
        roots.add(os.path.realpath(os.path.expanduser(tmpdir)).replace("\\", "/").rstrip("/"))
    return "system_temp" if any(_is_within(normalized, root) for root in roots) else "normal"


def _bounded_catalog_text(value: object) -> tuple[str | None, list[str]]:
    if not isinstance(value, str) or not value:
        return None, []
    prompt, _injected = strip_injected_context(value)
    if prompt is None:
        return None, []
    redacted = redact_history_text(prompt, 4 * DEFAULT_PREVIEW_CHARACTERS)
    text = str(redacted.value).replace("\n", " ")[:DEFAULT_PREVIEW_CHARACTERS]
    return text, list(redacted.redaction_types)


def _catalog_datetime(value: object) -> datetime | None:
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed
    if not isinstance(value, int | float):
        return None
    seconds = float(value)
    while seconds > 10_000_000_000:
        seconds /= 1000
    try:
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (OSError, OverflowError, ValueError):
        return None


@dataclass(frozen=True)
class _CatalogThread:
    session_id: str
    rollout_path: str | None
    created_at: datetime | None
    cwd: str | None
    title: str | None
    first_user_message: str | None
    preview: str | None
    archived: bool | None


def _read_catalog(path: Path) -> tuple[list[_CatalogThread], CatalogStatus, str]:
    if not path.is_file():
        return [], "missing", "Codex thread catalog is absent"
    allowed = (
        "id",
        "rollout_path",
        "created_at",
        "cwd",
        "title",
        "first_user_message",
        "preview",
        "archived",
    )
    try:
        uri = f"{path.resolve().as_uri()}?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True)
        try:
            columns = {
                str(row[1]) for row in connection.execute("PRAGMA table_info(threads)").fetchall()
            }
            if "id" not in columns:
                return [], "unsupported", "Codex thread catalog has no usable threads table"
            selected = [column for column in allowed if column in columns]
            quoted = ", ".join(f'"{column}"' for column in selected)
            rows = connection.execute(f"SELECT {quoted} FROM threads").fetchall()
        finally:
            connection.close()
    except (OSError, sqlite3.Error):
        return [], "unreadable", "Codex thread catalog could not be read immutably"

    output: list[_CatalogThread] = []
    for row in rows:
        values = dict(zip(selected, row, strict=True))
        session_value = values.get("id")
        if not isinstance(session_value, str) or not session_value:
            continue
        archived_value = values.get("archived")
        output.append(
            _CatalogThread(
                session_id=session_value,
                rollout_path=(
                    values.get("rollout_path")
                    if isinstance(values.get("rollout_path"), str)
                    else None
                ),
                created_at=_catalog_datetime(values.get("created_at")),
                cwd=values.get("cwd") if isinstance(values.get("cwd"), str) else None,
                title=values.get("title") if isinstance(values.get("title"), str) else None,
                first_user_message=(
                    values.get("first_user_message")
                    if isinstance(values.get("first_user_message"), str)
                    else None
                ),
                preview=(values.get("preview") if isinstance(values.get("preview"), str) else None),
                archived=bool(archived_value) if archived_value is not None else None,
            )
        )
    return output, "ok", "Codex thread catalog enriched matching sessions"


def _fallback_time(path: Path) -> datetime:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    except OSError:
        return datetime.fromtimestamp(0, tz=UTC)


def _unsupported_index(
    path: Path,
    *,
    tool: HistoryTool,
    digest: str,
    reason: str,
    history_state: HistoryState | None = None,
) -> HistorySessionIndex:
    timestamp = _fallback_time(path)
    project_key, project_display = _project_identity(None, "Unknown project")
    return HistorySessionIndex(
        session_id=f"{tool}-history-{digest[:16]}",
        tool=tool,
        project_group_key=project_key,
        project_display_name=project_display,
        started_at=timestamp,
        ended_at=timestamp,
        prompt_count=0,
        format_version=None,
        parse_status="unsupported",
        unsupported_reason=reason,
        source_file_sha256=digest,
        history_state=history_state,
        project_visibility="normal",
    )


def _json_objects(data: bytes) -> tuple[list[dict[str, object]], bool]:
    values: list[dict[str, object]] = []
    corrupt = False
    for raw_line in data.splitlines():
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except (UnicodeDecodeError, json.JSONDecodeError):
            corrupt = True
            continue
        if not isinstance(value, dict):
            corrupt = True
            continue
        values.append(value)
    return values, corrupt


def _codex_prompt(value: dict[str, object]) -> str | None:
    if value.get("type") != "response_item":
        return None
    payload = value.get("payload")
    if not isinstance(payload, dict) or payload.get("type") != "message":
        return None
    if payload.get("role") != "user":
        return None
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts) if parts else None


def _claude_prompt(value: dict[str, object]) -> str | None:
    if value.get("type") != "user" or value.get("isMeta") is True:
        return None
    message = value.get("message")
    content = message.get("content") if isinstance(message, dict) else value.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts) if parts else None


def _preview(prompts: list[str], preview_characters: int) -> tuple[str | None, list[str]]:
    if not prompts:
        return None, []
    redacted = redact_history_text(prompts[0], max(1024, preview_characters * 4))
    value = str(redacted.value).replace("\n", " ")[:preview_characters]
    return value, list(redacted.redaction_types)


def _index_codex(
    path: Path,
    *,
    history_state: HistoryState = "active",
    max_source_bytes: int,
    preview_characters: int,
    zstd_executable: Path | str | None,
    allow_zstd_lookup: bool,
) -> HistorySessionIndex:
    data, digest, read_error = _read_bounded(
        path,
        max_source_bytes=max_source_bytes,
        zstd_executable=zstd_executable,
        allow_zstd_lookup=allow_zstd_lookup,
    )
    if data is None:
        return _unsupported_index(
            path,
            tool="codex",
            digest=digest,
            reason=read_error or "history_source_read_failed",
            history_state=history_state,
        )
    values, corrupt = _json_objects(data)
    metadata: dict[str, object] | None = None
    for value in values:
        payload = value.get("payload")
        if value.get("type") == "session_meta" and isinstance(payload, dict):
            metadata = payload
            break
    if metadata is None:
        return _unsupported_index(
            path,
            tool="codex",
            digest=digest,
            reason="empty_codex_history" if not values else "missing_session_meta",
            history_state=history_state,
        )
    format_value = metadata.get("cli_version")
    format_version = format_value if isinstance(format_value, str) else None
    session_value = metadata.get("session_id") or metadata.get("id")
    session_id = (
        session_value
        if isinstance(session_value, str) and session_value
        else f"codex-history-{digest[:16]}"
    )
    cwd_value = metadata.get("cwd")
    cwd = cwd_value if isinstance(cwd_value, str) else None
    project_key, project_display = _project_identity(cwd, "Unknown project")
    timestamps = [
        parsed
        for value in values
        for parsed in [_parse_datetime(value.get("timestamp"))]
        if parsed is not None
    ]
    metadata_time = _parse_datetime(metadata.get("timestamp"))
    if metadata_time is not None:
        timestamps.append(metadata_time)
    fallback = _fallback_time(path)
    prompts: list[str] = []
    injected_context_messages = 0
    for value in values:
        raw_prompt = _codex_prompt(value)
        if raw_prompt is None:
            continue
        prompt, injected = strip_injected_context(raw_prompt)
        if injected:
            injected_context_messages += 1
        if prompt is not None:
            prompts.append(prompt)
    preview, redaction_types = _preview(prompts, preview_characters)
    unsupported = format_version not in KNOWN_CODEX_FORMAT_VERSIONS
    return HistorySessionIndex(
        session_id=session_id,
        tool="codex",
        project_group_key=project_key,
        project_display_name=project_display,
        started_at=min(timestamps) if timestamps else fallback,
        ended_at=max(timestamps) if timestamps else fallback,
        prompt_count=len(prompts),
        first_prompt_preview=preview,
        format_version=format_version,
        parse_status="unsupported" if unsupported else ("partial" if corrupt else "ok"),
        unsupported_reason="unsupported_codex_format_version" if unsupported else None,
        source_file_sha256=digest,
        redaction_types=redaction_types,
        history_state=history_state,
        project_visibility=_project_visibility(cwd),
        injected_context_messages=injected_context_messages,
    )


def _index_claude(
    path: Path,
    *,
    max_source_bytes: int,
    preview_characters: int,
) -> HistorySessionIndex:
    data, digest, read_error = _read_bounded(
        path,
        max_source_bytes=max_source_bytes,
        zstd_executable=None,
        allow_zstd_lookup=False,
    )
    if data is None:
        return _unsupported_index(
            path,
            tool="claude_code",
            digest=digest,
            reason=read_error or "history_source_read_failed",
        )
    values, corrupt = _json_objects(data)
    metadata = next(iter(values), None)
    if metadata is None:
        return _unsupported_index(
            path, tool="claude_code", digest=digest, reason="empty_claude_history"
        )
    format_value = metadata.get("formatVersion")
    format_version = format_value if isinstance(format_value, str) else None
    session_value = metadata.get("sessionId")
    session_id = (
        session_value
        if isinstance(session_value, str) and session_value
        else f"claude-history-{digest[:16]}"
    )
    raw_project_name = path.parent.name
    decoded = raw_project_name.replace("-", "/")
    if not decoded.startswith("/"):
        decoded = f"/{decoded}"
    project_key, project_display = _project_identity(decoded, "Unknown project")
    timestamps = [
        parsed
        for value in values
        for parsed in [_parse_datetime(value.get("timestamp"))]
        if parsed is not None
    ]
    fallback = _fallback_time(path)
    prompts = [text for value in values for text in [_claude_prompt(value)] if text is not None]
    preview, redaction_types = _preview(prompts, preview_characters)
    unsupported = format_version not in KNOWN_CLAUDE_FORMAT_VERSIONS
    return HistorySessionIndex(
        session_id=session_id,
        tool="claude_code",
        project_group_key=project_key,
        project_display_name=project_display,
        started_at=min(timestamps) if timestamps else fallback,
        ended_at=max(timestamps) if timestamps else fallback,
        prompt_count=len(prompts),
        first_prompt_preview=preview,
        format_version=format_version,
        parse_status="unsupported" if unsupported else ("partial" if corrupt else "ok"),
        unsupported_reason="unsupported_claude_format_version" if unsupported else None,
        source_file_sha256=digest,
        redaction_types=redaction_types,
        project_visibility=_project_visibility(decoded),
    )


def _normalized_path_key(value: str | Path) -> str:
    return os.path.realpath(os.path.expanduser(str(value)))


def _catalog_fields(thread: _CatalogThread) -> tuple[dict[str, object], list[str]]:
    source_title, title_types = _bounded_catalog_text(thread.title)
    first_message, first_types = _bounded_catalog_text(thread.first_user_message)
    preview, preview_types = _bounded_catalog_text(thread.preview)
    return (
        {
            "source_title": source_title,
            "catalog_first_user_message_preview": first_message,
            "catalog_preview": preview,
            "catalog_matched": True,
        },
        sorted(set(title_types + first_types + preview_types)),
    )


def _enrich_from_catalog(
    indexed: list[tuple[HistorySessionIndex, Path]],
    threads: list[_CatalogThread],
) -> list[HistorySessionIndex]:
    by_id = {session.session_id: position for position, (session, _path) in enumerate(indexed)}
    by_path = {
        _normalized_path_key(path): position for position, (_session, path) in enumerate(indexed)
    }
    output = [session for session, _path in indexed]
    for thread in threads:
        position = by_id.get(thread.session_id)
        if position is None and thread.rollout_path:
            position = by_path.get(_normalized_path_key(thread.rollout_path))
        fields, catalog_redactions = _catalog_fields(thread)
        if position is not None:
            existing = output[position]
            output[position] = existing.model_copy(
                update={
                    **fields,
                    "redaction_types": sorted(set(existing.redaction_types + catalog_redactions)),
                }
            )
            continue
        if not thread.rollout_path:
            continue
        if Path(thread.rollout_path).expanduser().is_file():
            continue
        timestamp = thread.created_at or datetime.fromtimestamp(0, tz=UTC)
        project_key, project_display = _project_identity(thread.cwd, "Unknown project")
        digest = hashlib.sha256(
            f"catalog-thread:{thread.session_id}:{thread.rollout_path or ''}".encode()
        ).hexdigest()
        output.append(
            HistorySessionIndex(
                session_id=thread.session_id,
                tool="codex",
                project_group_key=project_key,
                project_display_name=project_display,
                started_at=timestamp,
                ended_at=timestamp,
                prompt_count=0,
                first_prompt_preview=None,
                parse_status="unsupported",
                unsupported_reason="rollout_file_missing",
                source_file_sha256=digest,
                redaction_types=catalog_redactions,
                history_state="archived" if thread.archived else "active",
                project_visibility=_project_visibility(thread.cwd),
                injected_context_messages=0,
                source_title=(
                    fields["source_title"] if isinstance(fields["source_title"], str) else None
                ),
                catalog_first_user_message_preview=(
                    fields["catalog_first_user_message_preview"]
                    if isinstance(fields["catalog_first_user_message_preview"], str)
                    else None
                ),
                catalog_preview=(
                    fields["catalog_preview"]
                    if isinstance(fields["catalog_preview"], str)
                    else None
                ),
                catalog_matched=True,
            )
        )
    return output


def discover_history(
    *,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    preview_characters: int = DEFAULT_PREVIEW_CHARACTERS,
    zstd_executable: Path | str | None = None,
    allow_zstd_lookup: bool = True,
) -> HistoryDiscoveryResult:
    """Index supported dotfolder histories without constructing full replay records."""
    active_codex_root = codex_root or default_codex_history_root()
    archived_codex_root = active_codex_root.parent / "archived_sessions"
    catalog_path = (
        active_codex_root.parent / "state_5.sqlite"
        if codex_root is not None
        else default_codex_catalog_path()
    )
    active_files, active_unreadable = (
        _history_files(active_codex_root, "codex") if active_codex_root.is_dir() else ([], False)
    )
    archived_files, archived_unreadable = (
        _history_files(archived_codex_root, "codex")
        if archived_codex_root.is_dir()
        else ([], False)
    )
    catalog_threads, catalog_status, catalog_message = _read_catalog(catalog_path)

    roots: list[HistoryRootStatus] = []
    codex_root_missing = not active_codex_root.is_dir() and not archived_codex_root.is_dir()
    codex_unreadable = active_unreadable or archived_unreadable
    roots.append(
        HistoryRootStatus(
            tool="codex",
            status=(
                "missing" if codex_root_missing else ("unreadable" if codex_unreadable else "ok")
            ),
            file_count=len(active_files) + len(archived_files),
            message=(
                "default history roots are absent"
                if codex_root_missing
                else (
                    "history roots could not be read completely"
                    if codex_unreadable
                    else "active and archived history roots indexed"
                )
            ),
            active_file_count=len(active_files),
            archived_file_count=len(archived_files),
            catalog_status=catalog_status,
            catalog_message=catalog_message,
        )
    )

    indexed_codex: list[tuple[HistorySessionIndex, Path]] = []
    seen_codex_ids: set[str] = set()
    codex_trees: tuple[tuple[HistoryState, list[Path]], ...] = (
        ("active", active_files),
        ("archived", archived_files),
    )
    for history_state, files in codex_trees:
        for path in files:
            indexed = _index_codex(
                path,
                history_state=history_state,
                max_source_bytes=max_source_bytes,
                preview_characters=preview_characters,
                zstd_executable=zstd_executable,
                allow_zstd_lookup=allow_zstd_lookup,
            )
            if indexed.session_id in seen_codex_ids:
                continue
            seen_codex_ids.add(indexed.session_id)
            indexed_codex.append((indexed, path))

    sessions = _enrich_from_catalog(indexed_codex, catalog_threads)

    configured_claude_root = claude_root or default_claude_history_root()
    if not configured_claude_root.is_dir():
        roots.append(
            HistoryRootStatus(
                tool="claude_code",
                status="missing",
                file_count=0,
                message="default history root is absent",
            )
        )
    else:
        claude_files, claude_unreadable = _history_files(configured_claude_root, "claude_code")
        roots.append(
            HistoryRootStatus(
                tool="claude_code",
                status="unreadable" if claude_unreadable else "ok",
                file_count=len(claude_files),
                message=(
                    "history root could not be read completely"
                    if claude_unreadable
                    else "history root indexed"
                ),
            )
        )
        sessions.extend(
            _index_claude(
                path,
                max_source_bytes=max_source_bytes,
                preview_characters=preview_characters,
            )
            for path in claude_files
        )
    sessions.sort(key=lambda item: (item.started_at, item.tool, item.session_id), reverse=True)
    return HistoryDiscoveryResult(roots=roots, sessions=sessions)


def find_history_source(
    session_id: str,
    *,
    tool: HistoryTool | None = None,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    zstd_executable: Path | str | None = None,
    allow_zstd_lookup: bool = True,
) -> tuple[HistoryTool, Path]:
    """Resolve one indexed session to an internal source path without exposing it in output."""
    active_codex_root = codex_root or default_codex_history_root()
    configured: list[tuple[HistoryTool, Path, HistoryState | None]] = [
        ("codex", active_codex_root, "active"),
        ("codex", active_codex_root.parent / "archived_sessions", "archived"),
        ("claude_code", claude_root or default_claude_history_root(), None),
    ]
    for candidate_tool, root, history_state in configured:
        if tool is not None and tool != candidate_tool:
            continue
        if not root.is_dir():
            continue
        files, _unreadable = _history_files(root, candidate_tool)
        matches: list[Path] = []
        for path in files:
            if candidate_tool == "codex":
                indexed = _index_codex(
                    path,
                    history_state=history_state or "active",
                    max_source_bytes=max_source_bytes,
                    preview_characters=DEFAULT_PREVIEW_CHARACTERS,
                    zstd_executable=zstd_executable,
                    allow_zstd_lookup=allow_zstd_lookup,
                )
            else:
                indexed = _index_claude(
                    path,
                    max_source_bytes=max_source_bytes,
                    preview_characters=DEFAULT_PREVIEW_CHARACTERS,
                )
            if indexed.session_id == session_id:
                matches.append(path)
        if len(matches) > 1:
            raise ValueError("history session id is ambiguous within the selected source")
        if matches:
            return candidate_tool, matches[0]
    raise KeyError(f"unknown history session: {session_id}")


def _source_key(tool: HistoryTool, root: Path, path: Path) -> str:
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        relative = path.name
    return hashlib.sha256(f"{tool}:{root.name}:{relative}".encode()).hexdigest()


def _snapshot(
    configured: Iterable[tuple[HistoryTool, Path]],
) -> dict[str, tuple[HistoryTool, int, int]]:
    snapshot: dict[str, tuple[HistoryTool, int, int]] = {}
    for tool, root in configured:
        if not root.is_dir():
            continue
        files, _unreadable = _history_files(root, tool)
        for path in files:
            try:
                stat = path.stat()
            except OSError:
                continue
            snapshot[_source_key(tool, root, path)] = (tool, stat.st_mtime_ns, stat.st_size)
    return snapshot


class HistoryWatcher:
    """Poll history file metadata; never opens or mutates a history file."""

    def __init__(
        self,
        *,
        codex_root: Path | None = None,
        claude_root: Path | None = None,
    ) -> None:
        active_codex_root = codex_root or default_codex_history_root()
        self._configured: tuple[tuple[HistoryTool, Path], ...] = (
            ("codex", active_codex_root),
            ("codex", active_codex_root.parent / "archived_sessions"),
            ("claude_code", claude_root or default_claude_history_root()),
        )
        self._previous = _snapshot(self._configured)

    def poll(self) -> list[HistoryFileChange]:
        current = _snapshot(self._configured)
        changes: list[HistoryFileChange] = []
        for key in sorted(current.keys() - self._previous.keys()):
            tool, mtime_ns, size = current[key]
            changes.append(
                HistoryFileChange(
                    source_key=key,
                    tool=tool,
                    change="added",
                    mtime_ns=mtime_ns,
                    size=size,
                )
            )
        for key in sorted(current.keys() & self._previous.keys()):
            tool, mtime_ns, size = current[key]
            if current[key] != self._previous[key]:
                changes.append(
                    HistoryFileChange(
                        source_key=key,
                        tool=tool,
                        change="modified",
                        mtime_ns=mtime_ns,
                        size=size,
                    )
                )
        for key in sorted(self._previous.keys() - current.keys()):
            tool, _mtime_ns, _size = self._previous[key]
            changes.append(
                HistoryFileChange(
                    source_key=key,
                    tool=tool,
                    change="removed",
                    mtime_ns=0,
                    size=0,
                )
            )
        self._previous = current
        return changes
