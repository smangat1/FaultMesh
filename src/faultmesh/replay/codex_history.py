"""Read-only parsing of version-gated Codex rollout history."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
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
from faultmesh.replay.privacy import redact_history_text, redact_history_value

KNOWN_CODEX_FORMAT_VERSIONS = frozenset({"0.164.0-alpha.11.1", "0.165.0-alpha.1.2"})
HISTORY_PROVENANCE = "history_import"
DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024

_KNOWN_TOP_LEVEL_TYPES = {
    "compacted",
    "event_msg",
    "response_item",
    "session_meta",
    "token_usage_record",
    "turn_context",
    "world_state",
}
_KNOWN_EVENT_TYPES = {
    "item_completed",
    "task_complete",
    "task_started",
    "thread_settings_applied",
    "token_count",
}
_KNOWN_RESPONSE_TYPES = {
    "additional_tools",
    "custom_tool_call",
    "custom_tool_call_output",
    "function_call",
    "function_call_output",
    "message",
    "reasoning",
}
_KNOWN_NON_STEP_ITEMS = {
    "AgentMessage",
    "ContextCompaction",
    "Extension",
    "ImageView",
    "Reasoning",
}
_WRITE_COMMAND = re.compile(
    r"(?:^|\s)(?:cp|install|mkdir|mv|rm|sed\s+-i|tee|touch)(?:\s|$)|"
    r">>|(?<![<])>(?!>)|apply_patch|write_(?:bytes|text)|writeText|writeFile"
)


@dataclass(frozen=True)
class CodexHistoryParseResult:
    session: ReplaySession
    records: tuple[ReplayRecord, ...]
    project_group_key: str
    project_display_name: str
    parse_status: Literal["ok", "partial", "unsupported"]
    duplicate_items: int
    gaps: int
    unsupported: int


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


def _event_datetime(value: dict[str, object]) -> datetime | None:
    payload = value.get("payload")
    if isinstance(payload, dict):
        completed_at_ms = payload.get("completed_at_ms")
        if isinstance(completed_at_ms, int | float):
            return datetime.fromtimestamp(completed_at_ms / 1000, tz=UTC)
    return _parse_datetime(value.get("timestamp"))


def _clean_text(value: str, max_bytes: int) -> tuple[str, list[str] | None, bool]:
    result = redact_history_text(value, max_bytes)
    return str(result.value), list(result.redaction_types) or None, result.truncated


def _clean_value(value: object, max_bytes: int) -> tuple[object, list[str] | None, bool]:
    result = redact_history_value(value, max_bytes)
    return result.value, list(result.redaction_types) or None, result.truncated


def _merge_redaction_types(*values: list[str] | None) -> list[str] | None:
    merged = sorted({item for value in values if value for item in value})
    return merged or None


def _text_content(payload: dict[str, object]) -> str | None:
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts) if parts else None


def _source_item_id(payload: dict[str, object]) -> str | None:
    item_id = payload.get("id")
    return item_id if isinstance(item_id, str) and item_id else None


def _source_sequence(value: dict[str, object]) -> int | None:
    ordinal = value.get("ordinal")
    return ordinal if isinstance(ordinal, int) and ordinal >= 0 else None


def _project_identity(cwd: str | None) -> tuple[str, str]:
    normalized = (cwd or "").replace("\\", "/").rstrip("/")
    identity = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    display = normalized.rsplit("/", 1)[-1] if normalized else "Unknown project"
    return identity, display


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
    max_text_bytes: int
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
        captured_at = _event_datetime(value) or datetime.fromtimestamp(0, tz=UTC)
        self.records.append(
            ReplayRecord(
                id=_record_id(self.source_digest, line.offset, source_item_id, record_type),
                session_id=self.session_id,
                sequence=len(self.records) + 1,
                source_identity=f"codex-history:{self.source_digest}",
                source_offset=line.offset,
                source_sequence=_source_sequence(value),
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


def _read_source(
    path: Path,
    *,
    zstd_executable: Path | str | None,
    allow_zstd_lookup: bool,
    max_source_bytes: int,
) -> tuple[bytes | None, str, str | None]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    source_digest = digest.hexdigest()
    if size > max_source_bytes:
        return None, source_digest, "source_exceeds_configured_read_limit"
    if not path.name.endswith(".jsonl.zst"):
        return path.read_bytes(), source_digest, None

    executable = str(zstd_executable) if zstd_executable is not None else None
    if executable is None and allow_zstd_lookup:
        executable = shutil.which("zstd")
    if executable is None:
        return None, source_digest, "zstd_executable_not_found"
    try:
        process = subprocess.Popen(
            [executable, "--decompress", "--stdout", "--quiet", "--", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return None, source_digest, "zstd_decompression_failed"
    assert process.stdout is not None
    try:
        decompressed = process.stdout.read(max_source_bytes + 1)
        if len(decompressed) > max_source_bytes:
            process.kill()
            process.wait(timeout=5)
            return None, source_digest, "decompressed_source_exceeds_configured_read_limit"
        return_code = process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
        return None, source_digest, "zstd_decompression_failed"
    if return_code != 0:
        return None, source_digest, "zstd_decompression_failed"
    return decompressed, source_digest, None


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


def _metadata_payload(lines: list[_Line]) -> dict[str, object] | None:
    for line in lines:
        if line.value is None or line.value.get("type") != "session_meta":
            continue
        payload = line.value.get("payload")
        if isinstance(payload, dict):
            return payload
    return None


def _session_times(
    lines: list[_Line], metadata: dict[str, object] | None, fallback: datetime
) -> tuple[datetime, datetime]:
    values = [
        parsed
        for line in lines
        if line.value is not None
        for parsed in [_event_datetime(line.value)]
        if parsed is not None
    ]
    metadata_time = _parse_datetime(metadata.get("timestamp")) if metadata else None
    if metadata_time is not None:
        values.append(metadata_time)
    if not values:
        return fallback, fallback
    return min(values), max(values)


def _unsupported_result(
    path: Path,
    *,
    source_digest: str,
    reason: str,
    format_version: str | None = None,
    session_id: str | None = None,
    cwd: str | None = None,
) -> CodexHistoryParseResult:
    timestamp = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    project_key, display_name = _project_identity(cwd)
    identity = session_id or f"codex-history-{source_digest[:16]}"
    session = ReplaySession(
        id=identity,
        created_at=timestamp,
        stopped_at=timestamp,
        status=SessionStatus.STOPPED,
        project_root_sha256=project_key,
        codex_version=format_version or "unknown",
        limits=CaptureLimits(),
        import_source=ImportSource.CODEX,
        format_version=format_version,
        source_file_sha256=source_digest,
    )
    synthetic_value: dict[str, object] = {"timestamp": timestamp.isoformat()}
    line = _Line(offset=0, value=synthetic_value)
    builder = _RecordBuilder(identity, source_digest, session.limits.max_text_field_bytes)
    builder.add(
        line=line,
        value=synthetic_value,
        record_type=RecordKind.UNSUPPORTED,
        completeness=Completeness.UNSUPPORTED,
        gap_reason=reason,
    )
    return CodexHistoryParseResult(
        session=session,
        records=tuple(builder.records),
        project_group_key=project_key,
        project_display_name=display_name,
        parse_status="unsupported",
        duplicate_items=0,
        gaps=0,
        unsupported=1,
    )


def _command_text(item: dict[str, object]) -> str | None:
    command = item.get("command")
    if isinstance(command, str):
        return command
    if isinstance(command, list):
        commands = [value for value in command if isinstance(value, str)]
        return "\n".join(commands) if commands else None
    return None


def _is_write_command(command: str, parsed_command: object) -> bool:
    if _WRITE_COMMAND.search(command):
        return True
    if isinstance(parsed_command, list):
        for item in parsed_command:
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if isinstance(kind, str) and kind.lower() in {
                "copy",
                "delete",
                "move",
                "write",
            }:
                return True
    return False


def _file_change_patch(item: dict[str, object], cwd: str | None) -> str | None:
    changes = item.get("changes")
    if not isinstance(changes, dict):
        return None
    output: list[str] = []
    for raw_path in sorted(str(path) for path in changes):
        change = changes.get(raw_path)
        if not isinstance(change, dict):
            continue
        path = raw_path
        if cwd and raw_path.startswith(cwd.rstrip("/") + "/"):
            path = raw_path[len(cwd.rstrip("/")) + 1 :]
        kind = change.get("type")
        output.append(f"*** {kind if isinstance(kind, str) else 'change'}: {path}")
        unified_diff = change.get("unified_diff")
        content = change.get("content")
        if isinstance(unified_diff, str) and unified_diff:
            output.append(unified_diff)
        elif isinstance(content, str) and content:
            output.append(content)
        move_path = change.get("move_path")
        if isinstance(move_path, str) and move_path:
            output.append(f"*** move to: {move_path}")
    return "\n".join(output) if output else None


def _turn_id(payload: dict[str, object]) -> str | None:
    value = payload.get("turn_id")
    return value if isinstance(value, str) and value else None


def _next_turn_ids(lines: list[_Line]) -> list[str | None]:
    output: list[str | None] = [None] * len(lines)
    upcoming: str | None = None
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index]
        if line.value is not None and line.value.get("type") == "event_msg":
            payload = line.value.get("payload")
            if isinstance(payload, dict) and payload.get("type") == "task_started":
                upcoming = _turn_id(payload)
        output[index] = upcoming
    return output


def _completed_tool_items(lines: list[_Line]) -> set[str]:
    identities: set[str] = set()
    for line in lines:
        if line.value is None or line.value.get("type") != "event_msg":
            continue
        payload = line.value.get("payload")
        if not isinstance(payload, dict) or payload.get("type") != "item_completed":
            continue
        item = payload.get("item")
        if not isinstance(item, dict) or item.get("type") not in {
            "CommandExecution",
            "FileChange",
            "McpToolCall",
        }:
            continue
        item_id = _source_item_id(item)
        if item_id is not None:
            identities.add(item_id)
    return identities


def _low_level_output_call_ids(lines: list[_Line]) -> set[str]:
    identities: set[str] = set()
    for line in lines:
        if line.value is None or line.value.get("type") != "response_item":
            continue
        payload = line.value.get("payload")
        if not isinstance(payload, dict) or payload.get("type") not in {
            "custom_tool_call_output",
            "function_call_output",
        }:
            continue
        call_id = payload.get("call_id")
        if isinstance(call_id, str) and call_id:
            identities.add(call_id)
    return identities


def parse_codex_history(
    path: Path | str,
    *,
    zstd_executable: Path | str | None = None,
    allow_zstd_lookup: bool = True,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
) -> CodexHistoryParseResult:
    """Parse one Codex history file without writing to it or exposing its local path."""
    source = Path(path).expanduser().resolve(strict=True)
    if not source.is_file():
        raise ValueError("Codex history source must be a regular file")
    data, source_digest, read_error = _read_source(
        source,
        zstd_executable=zstd_executable,
        allow_zstd_lookup=allow_zstd_lookup,
        max_source_bytes=max_source_bytes,
    )
    if read_error is not None or data is None:
        return _unsupported_result(
            source,
            source_digest=source_digest,
            reason=read_error or "history_source_read_failed",
        )

    lines = _decode_lines(data)
    metadata = _metadata_payload(lines)
    if metadata is None:
        reason = "empty_codex_history" if not lines else "missing_session_meta"
        return _unsupported_result(source, source_digest=source_digest, reason=reason)

    format_version_value = metadata.get("cli_version")
    format_version = format_version_value if isinstance(format_version_value, str) else None
    session_id_value = metadata.get("session_id") or metadata.get("id")
    session_id = (
        session_id_value
        if isinstance(session_id_value, str) and session_id_value
        else f"codex-history-{source_digest[:16]}"
    )
    cwd_value = metadata.get("cwd")
    cwd = cwd_value if isinstance(cwd_value, str) and cwd_value else None
    if format_version not in KNOWN_CODEX_FORMAT_VERSIONS:
        return _unsupported_result(
            source,
            source_digest=source_digest,
            reason="unsupported_codex_format_version",
            format_version=format_version,
            session_id=session_id,
            cwd=cwd,
        )

    fallback_time = datetime.fromtimestamp(source.stat().st_mtime, tz=UTC)
    created_at, stopped_at = _session_times(lines, metadata, fallback_time)
    project_key, display_name = _project_identity(cwd)
    session = ReplaySession(
        id=session_id,
        created_at=created_at,
        stopped_at=stopped_at,
        status=SessionStatus.STOPPED,
        project_root_sha256=project_key,
        codex_version=format_version,
        limits=CaptureLimits(),
        import_source=ImportSource.CODEX,
        format_version=format_version,
        source_file_sha256=source_digest,
    )
    builder = _RecordBuilder(session_id, source_digest, session.limits.max_text_field_bytes)
    seen_item_ids: set[str] = set()
    duplicate_items = 0
    gaps = 0
    unsupported = 0
    next_turn_ids = _next_turn_ids(lines)
    completed_tool_ids = _completed_tool_items(lines)
    has_completed_tools = bool(completed_tool_ids)
    low_level_output_ids = _low_level_output_call_ids(lines)
    canonical_prompt_texts = {
        text
        for line in lines
        if line.value is not None and line.value.get("type") == "response_item"
        for payload in [line.value.get("payload")]
        if isinstance(payload, dict)
        and payload.get("type") == "message"
        and payload.get("role") == "user"
        for text in [_text_content(payload)]
        if text is not None
    }
    current_turn_id: str | None = None

    for index, line in enumerate(lines):
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
        top_type = value.get("type")
        payload = value.get("payload")
        if not isinstance(top_type, str) or top_type not in _KNOWN_TOP_LEVEL_TYPES:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                gap_reason="unsupported_codex_record_type",
            )
            unsupported += 1
            continue
        if top_type in {
            "compacted",
            "session_meta",
            "token_usage_record",
            "turn_context",
            "world_state",
        }:
            continue
        if not isinstance(payload, dict):
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.GAP,
                completeness=Completeness.MISSING,
                gap_reason="codex_record_payload_is_not_an_object",
            )
            gaps += 1
            continue

        if top_type == "response_item":
            response_type = payload.get("type")
            if not isinstance(response_type, str) or response_type not in _KNOWN_RESPONSE_TYPES:
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.UNSUPPORTED,
                    completeness=Completeness.UNSUPPORTED,
                    gap_reason="unsupported_codex_response_item",
                )
                unsupported += 1
                continue
            item_id = _source_item_id(payload)
            if item_id is not None and item_id in seen_item_ids:
                duplicate_items += 1
                continue
            if response_type == "message" and payload.get("role") == "user":
                text = _text_content(payload)
                if text is None:
                    builder.add(
                        line=line,
                        value=value,
                        record_type=RecordKind.GAP,
                        completeness=Completeness.MISSING,
                        source_item_id=item_id,
                        gap_reason="user_message_text_missing",
                    )
                    gaps += 1
                else:
                    clean_text, redaction_types, truncated = _clean_text(
                        text, session.limits.max_text_field_bytes
                    )
                    builder.add(
                        line=line,
                        value=value,
                        record_type=RecordKind.CHECKPOINT,
                        completeness=Completeness.PARTIAL,
                        source_item_id=item_id,
                        turn_id=next_turn_ids[index],
                        prompt_id=item_id,
                        prompt_text=clean_text,
                        redaction_types=redaction_types,
                        redaction_applied=redaction_types is not None,
                        truncated=truncated,
                    )
                if item_id is not None:
                    seen_item_ids.add(item_id)
                continue
            if response_type in {"message", "reasoning", "additional_tools"}:
                if item_id is not None:
                    seen_item_ids.add(item_id)
                continue
            call_id_value = payload.get("call_id")
            call_id = call_id_value if isinstance(call_id_value, str) else None
            name_value = payload.get("name")
            name = name_value if isinstance(name_value, str) else "tool"
            is_output = response_type.endswith("_output")
            if has_completed_tools and (is_output or call_id in low_level_output_ids):
                if item_id is not None:
                    seen_item_ids.add(item_id)
                continue
            raw_evidence = (
                payload.get("output")
                if is_output
                else (
                    payload.get("input")
                    if response_type == "custom_tool_call"
                    else payload.get("arguments")
                )
            )
            clean_evidence, redaction_types, truncated = _clean_value(
                raw_evidence, session.limits.max_text_field_bytes
            )
            command = clean_evidence if isinstance(clean_evidence, str) else None
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.POST_TOOL if is_output else RecordKind.PRE_TOOL,
                completeness=Completeness.PARTIAL,
                source_item_id=item_id,
                turn_id=current_turn_id,
                tool_use_id=call_id,
                tool_name=name,
                file_state="unknown",
                edit_command=(
                    command if command is not None and _is_write_command(command, None) else None
                ),
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=truncated,
                tool_input=None if is_output else clean_evidence,
                tool_response=clean_evidence if is_output else None,
            )
            if item_id is not None:
                seen_item_ids.add(item_id)
            continue

        event_type = payload.get("type")
        if not isinstance(event_type, str) or event_type not in _KNOWN_EVENT_TYPES:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                gap_reason="unsupported_codex_event_type",
            )
            unsupported += 1
            continue
        if event_type == "task_started":
            current_turn_id = _turn_id(payload)
            continue
        if event_type == "task_complete":
            current_turn_id = None
            continue
        if event_type in {"thread_settings_applied", "token_count"}:
            continue

        item = payload.get("item")
        if not isinstance(item, dict):
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.GAP,
                completeness=Completeness.MISSING,
                turn_id=_turn_id(payload),
                gap_reason="completed_item_is_not_an_object",
            )
            gaps += 1
            continue
        item_type = item.get("type")
        item_id = _source_item_id(item)
        if item_id is not None and item_id in seen_item_ids:
            duplicate_items += 1
            continue
        turn_id = _turn_id(payload) or current_turn_id

        if item_type == "UserMessage":
            text = _text_content(item)
            if text is not None and text in canonical_prompt_texts:
                duplicate_items += 1
            elif text is not None:
                clean_text, redaction_types, truncated = _clean_text(
                    text, session.limits.max_text_field_bytes
                )
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.CHECKPOINT,
                    completeness=Completeness.PARTIAL,
                    source_item_id=item_id,
                    turn_id=turn_id,
                    prompt_id=item_id,
                    prompt_text=clean_text,
                    redaction_types=redaction_types,
                    redaction_applied=redaction_types is not None,
                    truncated=truncated,
                )
            else:
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.GAP,
                    completeness=Completeness.MISSING,
                    source_item_id=item_id,
                    turn_id=turn_id,
                    gap_reason="user_message_text_missing",
                )
                gaps += 1
        elif item_type == "CommandExecution":
            raw_command = _command_text(item)
            if raw_command is None:
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.GAP,
                    completeness=Completeness.MISSING,
                    source_item_id=item_id,
                    turn_id=turn_id,
                    gap_reason="command_text_missing",
                )
                gaps += 1
            else:
                clean_command, command_types, command_truncated = _clean_text(
                    raw_command, session.limits.max_text_field_bytes
                )
                raw_response = {
                    key: item.get(key)
                    for key in ("aggregated_output", "duration", "exit_code", "status")
                    if key in item
                }
                clean_response, response_types, response_truncated = _clean_value(
                    raw_response, session.limits.max_text_field_bytes
                )
                redaction_types = _merge_redaction_types(command_types, response_types)
                builder.add(
                    line=line,
                    value=value,
                    record_type=RecordKind.POST_TOOL,
                    completeness=Completeness.PARTIAL,
                    source_item_id=item_id,
                    turn_id=turn_id,
                    tool_use_id=item_id,
                    tool_name="Bash",
                    file_state="unknown",
                    edit_command=(
                        clean_command
                        if _is_write_command(clean_command, item.get("parsed_cmd"))
                        else None
                    ),
                    redaction_types=redaction_types,
                    redaction_applied=redaction_types is not None,
                    truncated=command_truncated or response_truncated,
                    tool_input={"command": clean_command},
                    tool_response=clean_response,
                )
        elif item_type == "FileChange":
            raw_patch = _file_change_patch(item, cwd)
            clean_patch: str | None = None
            patch_types: list[str] | None = None
            patch_truncated = False
            if raw_patch is not None:
                clean_patch, patch_types, patch_truncated = _clean_text(
                    raw_patch, session.limits.max_text_field_bytes
                )
            raw_response = {
                key: item.get(key) for key in ("status", "stderr", "stdout") if key in item
            }
            clean_response, response_types, response_truncated = _clean_value(
                raw_response, session.limits.max_text_field_bytes
            )
            redaction_types = _merge_redaction_types(patch_types, response_types)
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.POST_TOOL,
                completeness=Completeness.PARTIAL,
                source_item_id=item_id,
                turn_id=turn_id,
                tool_use_id=item_id,
                tool_name="FileChange",
                file_state="unknown",
                edit_patch=clean_patch,
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=patch_truncated or response_truncated,
                tool_response=clean_response,
            )
        elif item_type == "McpToolCall":
            raw_input = item.get("arguments")
            raw_response = {
                key: item.get(key) for key in ("duration", "result", "status") if key in item
            }
            clean_input, input_types, input_truncated = _clean_value(
                raw_input, session.limits.max_text_field_bytes
            )
            clean_response, response_types, response_truncated = _clean_value(
                raw_response, session.limits.max_text_field_bytes
            )
            server = item.get("server")
            tool = item.get("tool")
            tool_name = (
                ".".join(part for part in (server, tool) if isinstance(part, str) and part)
                or "McpToolCall"
            )
            redaction_types = _merge_redaction_types(input_types, response_types)
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.POST_TOOL,
                completeness=Completeness.PARTIAL,
                source_item_id=item_id,
                turn_id=turn_id,
                tool_use_id=item_id,
                tool_name=tool_name,
                file_state="unknown",
                redaction_types=redaction_types,
                redaction_applied=redaction_types is not None,
                truncated=input_truncated or response_truncated,
                tool_input=clean_input,
                tool_response=clean_response,
            )
        elif item_type in _KNOWN_NON_STEP_ITEMS:
            pass
        else:
            builder.add(
                line=line,
                value=value,
                record_type=RecordKind.UNSUPPORTED,
                completeness=Completeness.UNSUPPORTED,
                source_item_id=item_id,
                turn_id=turn_id,
                gap_reason="unsupported_codex_completed_item",
            )
            unsupported += 1
        if item_id is not None:
            seen_item_ids.add(item_id)

    if cwd is None:
        synthetic_value = {"timestamp": created_at.isoformat()}
        synthetic_value_typed: dict[str, object] = synthetic_value
        builder.add(
            line=_Line(offset=0, value=synthetic_value_typed),
            value=synthetic_value_typed,
            record_type=RecordKind.UNSUPPORTED,
            completeness=Completeness.UNSUPPORTED,
            gap_reason="session_meta_missing_cwd",
        )
        unsupported += 1

    parse_status: Literal["ok", "partial", "unsupported"] = "ok"
    if gaps or unsupported:
        parse_status = "partial"
    if builder.records and all(
        record.record_type == RecordKind.UNSUPPORTED for record in builder.records
    ):
        parse_status = "unsupported"
    return CodexHistoryParseResult(
        session=session,
        records=tuple(builder.records),
        project_group_key=project_key,
        project_display_name=display_name,
        parse_status=parse_status,
        duplicate_items=duplicate_items,
        gaps=gaps,
        unsupported=unsupported,
    )
