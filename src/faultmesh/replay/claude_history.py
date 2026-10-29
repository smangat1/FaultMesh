"""Synthetic-contract parser for local Claude Code history JSONL.

No real Claude history was available during development. The accepted format identifier is
therefore intentionally provisional and exact-version-gated.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from faultmesh.replay.models import (
    AttributionStatus,
    CaptureLimits,
    Completeness,
    ImportSource,
    RecordKind,
    ReplayRecord,
    ReplaySession,
    SessionStatus,
)
from faultmesh.replay.privacy import REDACTION_MARKER, redact_text, redact_value

SYNTHETIC_CLAUDE_FORMAT_VERSION = "claude-code-jsonl-synthetic-1"
KNOWN_CLAUDE_FORMAT_VERSIONS = frozenset({SYNTHETIC_CLAUDE_FORMAT_VERSION})
HISTORY_PROVENANCE = "history_import"
DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024

_KNOWN_RECORD_TYPES = {
    "assistant",
    "file-history-snapshot",
    "queue-operation",
    "summary",
    "system",
    "user",
}
_EDIT_TOOLS = {"Edit", "MultiEdit", "Write"}
_WRITE_COMMAND = re.compile(
    r"(?:^|\s)(?:cp|install|mkdir|mv|rm|sed\s+-i|tee|touch)(?:\s|$)|"
    r">>|(?<![<])>(?!>)|apply_patch|write_(?:bytes|text)|writeText|writeFile"
)


@dataclass(frozen=True)
class ClaudeHistoryParseResult:
    session: ReplaySession
    records: tuple[ReplayRecord, ...]
    project_group_key: str
    project_display_name: str
    raw_project_name: str
    decoded_project_path: str
    parse_status: Literal["ok", "partial", "unsupported"]
    duplicate_items: int
    gaps: int
    unsupported: int
    sidechain_entries: int
    subagent_entries: int
    meta_entries: int
    system_entries: int
    file_history_entries: int


@dataclass(frozen=True)
class _Line:
    offset: int
    value: dict[str, object] | None
    error: Literal["corrupt", "not_object"] | None = None


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _replace_redaction_marker(value: object) -> object:
    if isinstance(value, str):
        return value.replace(REDACTION_MARKER, "[redacted: secret]")
    if isinstance(value, list):
        return [_replace_redaction_marker(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _replace_redaction_marker(item) for key, item in value.items()}
    return value


def _clean_text(value: str, max_bytes: int) -> tuple[str, list[str] | None, bool]:
    cleaned, redacted, truncated = redact_text(value, max_bytes)
    cleaned = cleaned.replace(REDACTION_MARKER, "[redacted: secret]")
    return cleaned, ["secret"] if redacted else None, truncated


def _clean_value(value: object, max_bytes: int) -> tuple[object, list[str] | None, bool]:
    cleaned, redacted, truncated = redact_value(value, max_bytes)
    return (
        _replace_redaction_marker(cleaned),
        ["secret"] if redacted else None,
        truncated,
    )


def _merge_redaction_types(*values: list[str] | None) -> list[str] | None:
    merged = sorted({item for value in values if value for item in value})
    return merged or None


def decode_claude_project_name(raw_name: str) -> str:
    """Best-effort path-style decode; hyphen boundaries are inherently ambiguous."""
    if not raw_name:
        return ""
    decoded = raw_name.replace("-", "/")
    return decoded if decoded.startswith("/") else f"/{decoded}"


def _project_identity(raw_name: str) -> tuple[str, str, str]:
    decoded = decode_claude_project_name(raw_name).rstrip("/")
    identity = hashlib.sha256(decoded.encode("utf-8")).hexdigest()
    display = decoded.rsplit("/", 1)[-1] if decoded else "Unknown project"
    return identity, display, decoded


def _record_uuid(value: dict[str, object]) -> str | None:
    uuid = value.get("uuid")
    return uuid if isinstance(uuid, str) and uuid else None


def _turn_id(value: dict[str, object]) -> str | None:
    for key in ("requestId", "parentUuid"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def _record_id(
    source_digest: str,
    source_offset: int,
    source_item_id: str | None,
    record_type: RecordKind,
) -> str:
    identity = f"{source_digest}:{source_offset}:{source_item_id or ''}:{record_type.value}"
    return f"history-{hashlib.sha256(identity.encode()).hexdigest()[:24]}"


@dataclass
class _RecordBuilder:
    session_id: str
    source_digest: str
    records: list[ReplayRecord] = field(default_factory=list)

    def add(
        self,
        *,
        line: _Line,
        value: dict[str, object],
        record_type: RecordKind,
        completeness: Completeness,
        source_item_id: str | None = None,
        turn_id: str | None = None,
        tool_use_id: str | None = None,
        tool_name: str | None = None,
        prompt_id: str | None = None,
        prompt_text: str | None = None,
        file_state: Literal["unknown"] | None = None,
        edit_patch: str | None = None,
        edit_command: str | None = None,
        redaction_types: list[str] | None = None,
        redaction_applied: bool = False,
        truncated: bool = False,
        tool_input: object | None = None,
        tool_response: object | None = None,
        gap_reason: str | None = None,
    ) -> None:
        captured_at = _parse_datetime(value.get("timestamp")) or datetime.fromtimestamp(0, tz=UTC)
        self.records.append(
            ReplayRecord(
                id=_record_id(self.source_digest, line.offset, source_item_id, record_type),
                session_id=self.session_id,
                sequence=len(self.records) + 1,
                source_identity=f"claude-history:{self.source_digest}",
                source_offset=line.offset,
                record_type=record_type,
                captured_at=captured_at,
                source_timestamp=captured_at,
                provenance=HISTORY_PROVENANCE,
                completeness=completeness,
                attribution_status=AttributionStatus.UNKNOWN,
                turn_id=turn_id,
                tool_use_id=tool_use_id,
                tool_name=tool_name,
                partial=completeness == Completeness.PARTIAL,
                truncated=truncated,
                redaction_applied=redaction_applied,
                tool_input=tool_input,
                tool_response=tool_response,
                gap_reason=gap_reason,
                source_item_id=source_item_id,
                prompt_id=prompt_id,
                prompt_text=prompt_text,
                file_state=file_state,
                edit_patch=edit_patch,
                edit_command=edit_command,
                redaction_types=redaction_types,
            )
        )


def _decode_lines(data: bytes) -> list[_Line]:
    output: list[_Line] = []
    offset = 0
    for raw_line in data.splitlines(keepends=True):
        line_offset = offset
        offset += len(raw_line)
        if not raw_line.strip():
            continue
        try:
            decoded = raw_line.decode("utf-8")
            value = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            output.append(_Line(offset=line_offset, value=None, error="corrupt"))
            continue
        if not isinstance(value, dict):
            output.append(_Line(offset=line_offset, value=None, error="not_object"))
            continue
        output.append(_Line(offset=line_offset, value=value))
    return output


def _read_source(path: Path, max_source_bytes: int) -> tuple[bytes | None, str, str | None]:
    digest = hashlib.sha256()
    size = 0
    chunks: list[bytes] = []
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
            if size <= max_source_bytes:
                chunks.append(chunk)
    if size > max_source_bytes:
        return None, digest.hexdigest(), "source_exceeds_configured_read_limit"
    return b"".join(chunks), digest.hexdigest(), None


def _metadata(lines: list[_Line]) -> dict[str, object] | None:
    for line in lines:
        value = line.value
        if value is None:
            continue
        if any(
            isinstance(value.get(key), str) and value.get(key)
            for key in ("formatVersion", "sessionId", "cwd")
        ):
            return value
    return None


def _session_times(lines: list[_Line], fallback: datetime) -> tuple[datetime, datetime]:
    values = [
        timestamp
        for line in lines
        if line.value is not None
        for timestamp in [_parse_datetime(line.value.get("timestamp"))]
        if timestamp is not None
    ]
    if not values:
        return fallback, fallback
    return min(values), max(values)


def _message_content(value: dict[str, object]) -> object:
    message = value.get("message")
    if isinstance(message, dict):
        return message.get("content")
    return value.get("content")


def _text_blocks(content: object) -> list[str]:
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    output: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str):
            output.append(text)
    return output


def _content_blocks(content: object, block_type: str) -> list[dict[str, object]]:
    if not isinstance(content, list):
        return []
    return [
        block for block in content if isinstance(block, dict) and block.get("type") == block_type
    ]


def _entry_flags(value: dict[str, object]) -> list[str]:
    flags: list[str] = []
    if value.get("isSidechain") is True:
        flags.append("sidechain")
    if any(isinstance(value.get(key), str) and value.get(key) for key in ("agentId", "agent_id")):
        flags.append("subagent")
    if value.get("isMeta") is True:
        flags.append("meta")
    if value.get("type") == "system":
        flags.append("system")
    return flags


def _flagged_value(value: object, flags: list[str]) -> object:
    return {"history_flags": flags, "value": value} if flags else value


def _display_path(path: object, decoded_project_path: str) -> str:
    if not isinstance(path, str) or not path:
        return "unknown-path"
    prefix = decoded_project_path.rstrip("/") + "/"
    return path[len(prefix) :] if decoded_project_path and path.startswith(prefix) else path


def _edit_patch(tool_name: str, tool_input: object, decoded_project_path: str) -> str | None:
    if not isinstance(tool_input, dict):
        return None
    path = _display_path(tool_input.get("file_path"), decoded_project_path)
    if tool_name == "Write":
        content = tool_input.get("content")
        return f"*** write: {path}\n{content}" if isinstance(content, str) else None
    if tool_name == "Edit":
        old = tool_input.get("old_string")
        new = tool_input.get("new_string")
        if isinstance(old, str) and isinstance(new, str):
            return f"*** edit: {path}\n--- source old\n{old}\n+++ source new\n{new}"
        return None
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits")
        if not isinstance(edits, list):
            return None
        output = [f"*** multi-edit: {path}"]
        for index, edit in enumerate(edits, start=1):
            if not isinstance(edit, dict):
                continue
            old = edit.get("old_string")
            new = edit.get("new_string")
            if isinstance(old, str) and isinstance(new, str):
                output.extend(
                    [
                        f"--- source old {index}",
                        old,
                        f"+++ source new {index}",
                        new,
                    ]
                )
        return "\n".join(output) if len(output) > 1 else None
    return None


def _tool_name_map(lines: list[_Line]) -> dict[str, str]:
    output: dict[str, str] = {}
    for line in lines:
        value = line.value
        if value is None or value.get("type") != "assistant":
            continue
        for block in _content_blocks(_message_content(value), "tool_use"):
            tool_id = block.get("id")
            name = block.get("name")
            if isinstance(tool_id, str) and isinstance(name, str):
                output[tool_id] = name
    return output


def _unsupported_result(
    path: Path,
    *,
    source_digest: str,
    reason: str,
    raw_project_name: str,
    format_version: str | None = None,
    session_id: str | None = None,
) -> ClaudeHistoryParseResult:
    timestamp = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    project_key, display_name, decoded_path = _project_identity(raw_project_name)
    identity = session_id or f"claude-history-{source_digest[:16]}"
    session = ReplaySession(
        id=identity,
        created_at=timestamp,
        stopped_at=timestamp,
        status=SessionStatus.STOPPED,
        project_root_sha256=project_key,
        codex_version="claude-code history import",
        limits=CaptureLimits(),
        import_source=ImportSource.CLAUDE_CODE,
        format_version=format_version,
        source_file_sha256=source_digest,
    )
    synthetic_value: dict[str, object] = {"timestamp": timestamp.isoformat()}
    builder = _RecordBuilder(identity, source_digest)
    builder.add(
        line=_Line(offset=0, value=synthetic_value),
        value=synthetic_value,
        record_type=RecordKind.UNSUPPORTED,
        completeness=Completeness.UNSUPPORTED,
        gap_reason=reason,
    )
    return ClaudeHistoryParseResult(
        session=session,
        records=tuple(builder.records),
        project_group_key=project_key,
        project_display_name=display_name,
        raw_project_name=raw_project_name,
        decoded_project_path=decoded_path,
        parse_status="unsupported",
        duplicate_items=0,
        gaps=0,
        unsupported=1,
        sidechain_entries=0,
        subagent_entries=0,
        meta_entries=0,
        system_entries=0,
        file_history_entries=0,
    )


def parse_claude_history(
    path: Path | str,
    *,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
) -> ClaudeHistoryParseResult:
    """Parse the provisional synthetic Claude contract without writing to the source."""
    source = Path(path).expanduser().resolve(strict=True)
    if not source.is_file():
        raise ValueError("Claude history source must be a regular file")
    raw_project_name = source.parent.name
    data, source_digest, read_error = _read_source(source, max_source_bytes)
    if read_error is not None or data is None:
        return _unsupported_result(
            source,
            source_digest=source_digest,
            reason=read_error or "history_source_read_failed",
            raw_project_name=raw_project_name,
        )
    lines = _decode_lines(data)
    metadata = _metadata(lines)
    if metadata is None:
        reason = "empty_claude_history" if not lines else "missing_session_metadata"
        return _unsupported_result(
            source,
            source_digest=source_digest,
            reason=reason,
            raw_project_name=raw_project_name,
        )

    format_value = metadata.get("formatVersion")
    format_version = format_value if isinstance(format_value, str) else None
    session_value = metadata.get("sessionId")
    session_id = (
        session_value
        if isinstance(session_value, str) and session_value
        else f"claude-history-{source_digest[:16]}"
    )
    if format_version not in KNOWN_CLAUDE_FORMAT_VERSIONS:
        return _unsupported_result(
            source,
            source_digest=source_digest,
            reason="unsupported_claude_format_version",
            raw_project_name=raw_project_name,
            format_version=format_version,
            session_id=session_id,
        )

    fallback_time = datetime.fromtimestamp(source.stat().st_mtime, tz=UTC)
    created_at, stopped_at = _session_times(lines, fallback_time)
    project_key, display_name, decoded_path = _project_identity(raw_project_name)
    client_version = metadata.get("version")
    client_label = client_version if isinstance(client_version, str) else "unknown"
    session = ReplaySession(
        id=session_id,
        created_at=created_at,
        stopped_at=stopped_at,
        status=SessionStatus.STOPPED,
        project_root_sha256=project_key,
        codex_version=f"claude-code {client_label}",
        limits=CaptureLimits(),
        import_source=ImportSource.CLAUDE_CODE,
        format_version=format_version,
        source_file_sha256=source_digest,
    )
    builder = _RecordBuilder(session_id, source_digest)
    tool_names = _tool_name_map(lines)
    seen_uuids: set[str] = set()
    duplicate_items = 0
    gaps = 0
    unsupported = 0
    sidechain_entries = 0
    subagent_entries = 0
    meta_entries = 0
    system_entries = 0
    file_history_entries = 0

    for line in lines:
        if line.error is not None:
            synthetic_value: dict[str, object] = {"timestamp": created_at.isoformat()}
            builder.add(
                line=line,
                value=synthetic_value,
                record_type=RecordKind.GAP,
                completeness=Completeness.MISSING,
                gap_reason=(
                    "corrupt_jsonl_record"
                    if line.error == "corrupt"
                    else "jsonl_record_is_not_an_object"
                ),
            )
            gaps += 1
            continue
        value = line.value
        assert value is not None
        record_uuid = _record_uuid(value)
        if record_uuid is not None and record_uuid in seen_uuids:
            duplicate_items += 1
            continue
        if record_uuid is not None:
            seen_uuids.add(record_uuid)

        line_version = value.get("formatVersion")
        if line_version != format_version:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                source_item_id=record_uuid,
                gap_reason="claude_record_format_version_mismatch",
            )
            unsupported += 1
            continue
        record_type = value.get("type")
        if not isinstance(record_type, str) or record_type not in _KNOWN_RECORD_TYPES:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                source_item_id=record_uuid,
                gap_reason="unsupported_claude_record_type",
            )
            unsupported += 1
            continue

        flags = _entry_flags(value)
        sidechain_entries += int("sidechain" in flags)
        subagent_entries += int("subagent" in flags)
        meta_entries += int("meta" in flags)
        system_entries += int("system" in flags)
        turn_id = _turn_id(value)
        content = _message_content(value)

        if "meta" in flags or record_type in {"queue-operation", "summary", "system"}:
            clean_content, redaction_types, truncated = _clean_value(
                content, session.limits.max_text_field_bytes
            )
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.CHECKPOINT,
                completeness=Completeness.PARTIAL,
                source_item_id=record_uuid,
                turn_id=turn_id,
                tool_name="ClaudeMeta" if "meta" in flags else "ClaudeSystem",
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=truncated,
                tool_response=_flagged_value(clean_content, flags),
            )
            continue

        if record_type == "file-history-snapshot":
            file_history_entries += 1
            snapshot = value.get("snapshot")
            clean_snapshot, redaction_types, truncated = _clean_value(
                snapshot, session.limits.max_text_field_bytes
            )
            history_flags = [*flags, "file_history_snapshot_untrusted"]
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.CHECKPOINT,
                completeness=Completeness.PARTIAL,
                source_item_id=record_uuid,
                turn_id=turn_id,
                tool_name="ClaudeFileHistorySnapshot",
                file_state="unknown",
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=truncated,
                tool_response=_flagged_value(clean_snapshot, history_flags),
            )
            continue

        if record_type == "user":
            texts = _text_blocks(content)
            if isinstance(content, str):
                texts = [content]
            if texts:
                prompt_text = "\n".join(texts)
                clean_text, redaction_types, truncated = _clean_text(
                    prompt_text, session.limits.max_text_field_bytes
                )
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.CHECKPOINT,
                    completeness=Completeness.PARTIAL,
                    source_item_id=record_uuid,
                    turn_id=turn_id,
                    prompt_id=record_uuid,
                    prompt_text=clean_text,
                    redaction_types=redaction_types,
                    redaction_applied=redaction_types is not None,
                    truncated=truncated,
                    tool_response={"history_flags": flags} if flags else None,
                )
            for index, block in enumerate(_content_blocks(content, "tool_result")):
                tool_id = block.get("tool_use_id")
                tool_use_id = tool_id if isinstance(tool_id, str) else None
                raw_result = block.get("content")
                clean_result, redaction_types, truncated = _clean_value(
                    raw_result, session.limits.max_text_field_bytes
                )
                item_id = f"{record_uuid or line.offset}:tool-result:{index}"
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.POST_TOOL,
                    completeness=Completeness.PARTIAL,
                    source_item_id=item_id,
                    turn_id=turn_id,
                    tool_use_id=tool_use_id,
                    tool_name=tool_names.get(tool_use_id or "", "ClaudeToolResult"),
                    file_state="unknown",
                    redaction_types=redaction_types,
                    redaction_applied=redaction_types is not None,
                    truncated=truncated,
                    tool_response=_flagged_value(clean_result, flags),
                )
            if not texts and not _content_blocks(content, "tool_result"):
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.UNSUPPORTED,
                    completeness=Completeness.UNSUPPORTED,
                    source_item_id=record_uuid,
                    turn_id=turn_id,
                    gap_reason="unsupported_claude_user_content",
                )
                unsupported += 1
            continue

        assistant_texts = _text_blocks(content)
        if assistant_texts:
            clean_text, redaction_types, truncated = _clean_text(
                "\n".join(assistant_texts), session.limits.max_text_field_bytes
            )
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.CHECKPOINT,
                completeness=Completeness.PARTIAL,
                source_item_id=f"{record_uuid or line.offset}:assistant-text",
                turn_id=turn_id,
                tool_name="ClaudeAssistantMessage",
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=truncated,
                tool_response=_flagged_value({"text": clean_text}, flags),
            )
        tool_blocks = _content_blocks(content, "tool_use")
        for index, block in enumerate(tool_blocks):
            tool_id = block.get("id")
            tool_use_id = tool_id if isinstance(tool_id, str) else None
            name_value = block.get("name")
            tool_name = name_value if isinstance(name_value, str) else "ClaudeTool"
            raw_input = block.get("input")
            clean_input, input_types, input_truncated = _clean_value(
                raw_input, session.limits.max_text_field_bytes
            )
            raw_patch = (
                _edit_patch(tool_name, raw_input, decoded_path)
                if tool_name in _EDIT_TOOLS
                else None
            )
            clean_patch: str | None = None
            patch_types: list[str] | None = None
            patch_truncated = False
            if raw_patch is not None:
                clean_patch, patch_types, patch_truncated = _clean_text(
                    raw_patch, session.limits.max_text_field_bytes
                )
            edit_command: str | None = None
            command_types: list[str] | None = None
            command_truncated = False
            if tool_name == "Bash" and isinstance(raw_input, dict):
                command = raw_input.get("command")
                if isinstance(command, str) and _WRITE_COMMAND.search(command):
                    edit_command, command_types, command_truncated = _clean_text(
                        command, session.limits.max_text_field_bytes
                    )
            redaction_types = _merge_redaction_types(input_types, patch_types, command_types)
            item_id = tool_use_id or f"{record_uuid or line.offset}:tool-use:{index}"
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.PRE_TOOL,
                completeness=Completeness.PARTIAL,
                source_item_id=item_id,
                turn_id=turn_id,
                tool_use_id=tool_use_id,
                tool_name=tool_name,
                file_state="unknown",
                edit_patch=clean_patch,
                edit_command=edit_command,
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=input_truncated or patch_truncated or command_truncated,
                tool_input=_flagged_value(clean_input, flags),
            )
        if not assistant_texts and not tool_blocks:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                source_item_id=record_uuid,
                turn_id=turn_id,
                gap_reason="unsupported_claude_assistant_content",
            )
            unsupported += 1

    parse_status: Literal["ok", "partial", "unsupported"] = "ok"
    if gaps or unsupported:
        parse_status = "partial"
    if builder.records and all(
        record.record_type == RecordKind.UNSUPPORTED for record in builder.records
    ):
        parse_status = "unsupported"
    return ClaudeHistoryParseResult(
        session=session,
        records=tuple(builder.records),
        project_group_key=project_key,
        project_display_name=display_name,
        raw_project_name=raw_project_name,
        decoded_project_path=decoded_path,
        parse_status=parse_status,
        duplicate_items=duplicate_items,
        gaps=gaps,
        unsupported=unsupported,
        sidechain_entries=sidechain_entries,
        subagent_entries=subagent_entries,
        meta_entries=meta_entries,
        system_entries=system_entries,
        file_history_entries=file_history_entries,
    )
