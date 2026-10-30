"""Map projected Codex thread-history items into the existing replay schema."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.history_context import strip_injected_context
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
from faultmesh.replay.thread_history import (
    ThreadHistoryItem,
    ThreadHistoryReader,
    ThreadHistoryTurn,
    ThreadHistoryTurnGap,
)

logger = logging.getLogger(__name__)

HISTORY_PROVENANCE = "history_import"
_UNKNOWN_TYPE = "<missing>"
_FINAL_PHASE_HINTS = frozenset({"answer", "complete", "final", "terminal"})

_MappingKind = Literal[
    "prompt",
    "command",
    "file_edit",
    "mcp_tool",
    "dynamic_tool",
    "agent_message",
    "reasoning_skip",
    "collab_tool_guess",
    "web_tool_guess",
    "image_view_guess",
    "image_generation_guess",
    "subagent_tool_guess",
    "plan_narration_guess",
    "bookkeeping_skip",
]

# The *_guess entries intentionally preserve the conservative best-guess classification
# from the verified mapping. Unknown types never enter this table.
ITEM_TYPE_MAPPING: Mapping[str, _MappingKind] = MappingProxyType(
    {
        "userMessage": "prompt",
        "commandExecution": "command",
        "fileChange": "file_edit",
        "mcpToolCall": "mcp_tool",
        "dynamicToolCall": "dynamic_tool",
        "agentMessage": "agent_message",
        "reasoning": "reasoning_skip",
        "collabAgentToolCall": "collab_tool_guess",
        "webSearch": "web_tool_guess",
        "imageView": "image_view_guess",
        "imageGeneration": "image_generation_guess",
        "subAgentActivity": "subagent_tool_guess",
        "plan": "plan_narration_guess",
        "contextCompaction": "bookkeeping_skip",
        "sleep": "bookkeeping_skip",
    }
)


class ThreadHistorySmokeSummary(BaseModel):
    """Aggregate-only diagnostics safe to print for a real local history database."""

    model_config = ConfigDict(extra="forbid", strict=True)

    threads: int = Field(ge=0)
    turns: int = Field(ge=0)
    items: int = Field(ge=0)
    items_by_type: dict[str, int]
    unknown_type_count: int = Field(ge=0)
    partial_thread_count: int = Field(ge=0)
    created_at_ms_min: int | None = None
    created_at_ms_max: int | None = None


FinalPhaseMethod = Literal[
    "turn_final_agent_item_id",
    "semantic_terminal_hint",
    "unresolved",
]


@dataclass(frozen=True)
class ThreadHistoryImportResult:
    session: ReplaySession
    records: tuple[ReplayRecord, ...]
    parse_status: Literal["ok", "partial", "unsupported"]
    item_type_counts: Mapping[str, int]
    unknown_item_types: Mapping[str, int]
    skipped_item_types: Mapping[str, int]
    gaps: int
    injected_context_messages: int
    final_answer_phase: str | None
    observed_agent_phases: tuple[str, ...]
    final_phase_method: FinalPhaseMethod


@dataclass
class _Sanitizer:
    max_bytes: int
    injected_context_messages: int = 0

    def _strip_value(self, value: object) -> object:
        if isinstance(value, str):
            stripped, injected = strip_injected_context(value)
            if injected:
                self.injected_context_messages += 1
            return stripped if stripped is not None else ""
        if isinstance(value, list):
            return [self._strip_value(item) for item in value]
        if isinstance(value, dict):
            return {key: self._strip_value(item) for key, item in value.items()}
        return value

    def text(self, value: object) -> tuple[str | None, list[str] | None, bool]:
        if not isinstance(value, str):
            return None, None, False
        stripped = self._strip_value(value)
        if not isinstance(stripped, str) or not stripped:
            return None, None, False
        redacted = redact_history_text(stripped, self.max_bytes)
        return (
            str(redacted.value),
            list(redacted.redaction_types) or None,
            redacted.truncated,
        )

    def value(self, value: object) -> tuple[object, list[str] | None, bool]:
        redacted = redact_history_value(self._strip_value(value), self.max_bytes)
        return redacted.value, list(redacted.redaction_types) or None, redacted.truncated


def _merge_types(*values: list[str] | None) -> list[str] | None:
    merged = sorted({item for value in values if value for item in value})
    return merged or None


def _epoch_datetime(value: int | None, *, milliseconds: bool = False) -> datetime | None:
    if value is None:
        return None
    seconds = value / 1000 if milliseconds else float(value)
    if not milliseconds:
        while seconds > 10_000_000_000:
            seconds /= 1000
    try:
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (OSError, OverflowError, ValueError):
        return None


def _fallback_datetime(path: Path) -> datetime:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    except OSError:
        return datetime.fromtimestamp(0, tz=UTC)


def _item_datetime(item: ThreadHistoryItem, fallback: datetime) -> tuple[datetime, bool]:
    for value in (item.created_at_ms, item.started_at_ms, item.completed_at_ms):
        parsed = _epoch_datetime(value, milliseconds=True)
        if parsed is not None:
            return parsed, False
    return fallback, True


def _turn_datetime(turn: ThreadHistoryTurn, fallback: datetime) -> tuple[datetime, bool]:
    for value in (turn.started_at, turn.completed_at):
        parsed = _epoch_datetime(value)
        if parsed is not None:
            return parsed, False
    return fallback, True


def _project_identity(cwd: str | None, thread_id: str) -> str:
    identity = cwd.replace("\\", "/").rstrip("/") if cwd else f"thread:{thread_id}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _source_identity(thread_id: str) -> str:
    digest = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()
    return f"codex-thread-history:{digest}"


def _record_id(thread_id: str, source_id: str, record_type: RecordKind) -> str:
    value = f"{thread_id}:{source_id}:{record_type.value}"
    return f"history-{hashlib.sha256(value.encode()).hexdigest()[:24]}"


def _record(
    *,
    thread_id: str,
    source_identity: str,
    source_id: str,
    source_ordinal: int,
    sequence: int,
    captured_at: datetime,
    timestamp_inferred: bool,
    record_type: RecordKind,
    completeness: Completeness,
    turn_id: str | None = None,
    tool_name: str | None = None,
    tool_input: object | None = None,
    tool_response: object | None = None,
    prompt_text: str | None = None,
    prompt_id: str | None = None,
    edit_patch: str | None = None,
    redaction_types: list[str] | None = None,
    truncated: bool = False,
    gap_reason: str | None = None,
) -> ReplayRecord:
    return ReplayRecord(
        id=_record_id(thread_id, source_id, record_type),
        session_id=thread_id,
        sequence=sequence,
        source_identity=source_identity,
        source_offset=source_ordinal,
        source_sequence=source_ordinal,
        record_type=record_type,
        captured_at=captured_at,
        source_timestamp=None if timestamp_inferred else captured_at,
        timestamp_inferred=timestamp_inferred,
        provenance=HISTORY_PROVENANCE,
        completeness=completeness,
        attribution_status=AttributionStatus.UNKNOWN,
        turn_id=turn_id,
        tool_use_id=(source_id if record_type is RecordKind.POST_TOOL else None),
        tool_name=tool_name,
        partial=completeness is Completeness.PARTIAL,
        truncated=truncated,
        redaction_applied=redaction_types is not None,
        tool_input=tool_input,
        tool_response=tool_response,
        gap_reason=gap_reason,
        source_item_id=source_id,
        prompt_id=prompt_id,
        prompt_text=prompt_text,
        file_state="unknown" if record_type is RecordKind.POST_TOOL else None,
        edit_patch=edit_patch,
        redaction_types=redaction_types,
    )


def _content_text(payload: dict[str, object]) -> str | None:
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts = [
        text
        for item in content
        if isinstance(item, dict)
        for text in [item.get("text")]
        if isinstance(text, str)
    ]
    return "\n".join(parts) if parts else None


def _command_text(payload: dict[str, object]) -> str | None:
    command = payload.get("command")
    if isinstance(command, str):
        return command
    if isinstance(command, list):
        parts = [item for item in command if isinstance(item, str)]
        return "\n".join(parts) if parts else None
    return None


def _clean_tool_name(
    sanitizer: _Sanitizer, parts: tuple[object, ...], fallback: str
) -> tuple[str, list[str] | None, bool]:
    raw = ".".join(item for item in parts if isinstance(item, str) and item)
    clean, types, truncated = sanitizer.text(raw or fallback)
    return clean or fallback, types, truncated


def _phase_tokens(value: str) -> frozenset[str]:
    return frozenset(token for token in re.split(r"[^a-z0-9]+", value.lower()) if token)


def _detect_final_phase(
    items: list[ThreadHistoryItem], turns: list[ThreadHistoryTurn]
) -> tuple[str | None, tuple[str, ...], FinalPhaseMethod]:
    phases_by_item: dict[str, str] = {}
    ordered_phases: list[str] = []
    for item in items:
        if item.item_type != "agentMessage" or item.item_json is None:
            continue
        phase = item.item_json.get("phase")
        if isinstance(phase, str) and phase:
            phases_by_item[item.item_id] = phase
            ordered_phases.append(phase)
    observed = tuple(sorted(set(ordered_phases)))

    referenced = [
        phases_by_item[turn.final_agent_item_id]
        for turn in turns
        if turn.final_agent_item_id in phases_by_item
    ]
    selected: str | None
    if referenced:
        counts = Counter(referenced)
        selected = max(referenced, key=lambda phase: (counts[phase], referenced.index(phase)))
        method: FinalPhaseMethod = "turn_final_agent_item_id"
    else:
        candidates = [
            phase for phase in ordered_phases if _phase_tokens(phase) & _FINAL_PHASE_HINTS
        ]
        selected = candidates[-1] if candidates else None
        method = "semantic_terminal_hint" if selected is not None else "unresolved"

    logger.info(
        "thread history final-answer phase detection",
        extra={
            "thread_history_final_answer_phase": selected,
            "thread_history_final_phase_method": method,
        },
    )
    return selected, observed, method


def _gap_record_for_item(
    item: ThreadHistoryItem,
    *,
    source_identity: str,
    sequence: int,
    captured_at: datetime,
    timestamp_inferred: bool,
    reason: str,
) -> ReplayRecord:
    return _record(
        thread_id=item.thread_id,
        source_identity=source_identity,
        source_id=item.item_id,
        source_ordinal=item.rollout_ordinal,
        sequence=sequence,
        captured_at=captured_at,
        timestamp_inferred=timestamp_inferred,
        record_type=RecordKind.GAP,
        completeness=Completeness.MISSING,
        turn_id=item.turn_id,
        gap_reason=reason,
    )


def _map_item(
    item: ThreadHistoryItem,
    *,
    kind: _MappingKind,
    sanitizer: _Sanitizer,
    final_phase: str | None,
    source_identity: str,
    sequence: int,
    fallback_time: datetime,
) -> ReplayRecord | None:
    captured_at, timestamp_inferred = _item_datetime(item, fallback_time)
    payload = item.item_json
    if payload is None:
        return _gap_record_for_item(
            item,
            source_identity=source_identity,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            reason=f"thread_history_item_json_{item.item_json_error or 'missing'}",
        )

    if kind in {"reasoning_skip", "bookkeeping_skip"}:
        return None

    if kind == "prompt":
        clean, types, truncated = sanitizer.text(_content_text(payload))
        if clean is None:
            return None
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.CHECKPOINT,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            prompt_id=item.item_id,
            prompt_text=clean,
            redaction_types=types,
            truncated=truncated,
        )

    if kind == "command":
        command, command_types, command_truncated = sanitizer.text(_command_text(payload))
        if command is None:
            return _gap_record_for_item(
                item,
                source_identity=source_identity,
                sequence=sequence,
                captured_at=captured_at,
                timestamp_inferred=timestamp_inferred,
                reason="thread_history_command_text_missing",
            )
        response, response_types, response_truncated = sanitizer.value(
            {
                key: payload.get(key)
                for key in (
                    "aggregatedOutput",
                    "exitCode",
                    "status",
                    "durationMs",
                    "cwd",
                    "commandActions",
                )
                if key in payload
            }
        )
        types = _merge_types(command_types, response_types)
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.POST_TOOL,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name="Command",
            tool_input={"command": command},
            tool_response=response,
            redaction_types=types,
            truncated=command_truncated or response_truncated,
        )

    if kind == "file_edit":
        changes, types, truncated = sanitizer.value(payload.get("changes"))
        patch = json.dumps(changes, sort_keys=True, separators=(",", ":"))
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.POST_TOOL,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name="FileChange",
            tool_response={"changes": changes},
            edit_patch=patch,
            redaction_types=types,
            truncated=truncated,
        )

    if kind == "mcp_tool":
        name, name_types, name_truncated = _clean_tool_name(
            sanitizer, (payload.get("server"), payload.get("tool")), "McpToolCall"
        )
        tool_input, input_types, input_truncated = sanitizer.value(payload.get("arguments"))
        result = payload.get("result")
        raw_response: dict[str, object] = {
            key: result.get(key)
            for key in ("content", "structuredContent")
            if isinstance(result, dict) and key in result
        }
        for key in ("error", "status", "durationMs"):
            if key in payload:
                raw_response[key] = payload.get(key)
        response, response_types, response_truncated = sanitizer.value(raw_response)
        types = _merge_types(name_types, input_types, response_types)
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.POST_TOOL,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name=name,
            tool_input=tool_input,
            tool_response=response,
            redaction_types=types,
            truncated=name_truncated or input_truncated or response_truncated,
        )

    if kind == "dynamic_tool":
        name, name_types, name_truncated = _clean_tool_name(
            sanitizer, (payload.get("namespace"), payload.get("tool")), "DynamicToolCall"
        )
        tool_input, input_types, input_truncated = sanitizer.value(payload.get("arguments"))
        content_items = payload.get("contentItems")
        raw_output = (
            "\n".join(
                text
                for content in content_items
                if isinstance(content, dict)
                for text in [content.get("text")]
                if isinstance(text, str)
            )
            if isinstance(content_items, list)
            else None
        )
        output, output_types, output_truncated = sanitizer.text(raw_output)
        response, response_types, response_truncated = sanitizer.value(
            {
                "content": output,
                **{
                    key: payload.get(key)
                    for key in ("status", "success", "durationMs")
                    if key in payload
                },
            }
        )
        types = _merge_types(name_types, input_types, output_types, response_types)
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.POST_TOOL,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name=name,
            tool_input=tool_input,
            tool_response=response,
            redaction_types=types,
            truncated=(
                name_truncated
                or input_truncated
                or output_truncated
                or response_truncated
            ),
        )

    if kind == "agent_message":
        text, text_types, text_truncated = sanitizer.text(payload.get("text"))
        if text is None:
            return None
        phase = payload.get("phase")
        clean_phase, phase_types, phase_truncated = sanitizer.text(phase)
        is_final = isinstance(phase, str) and final_phase is not None and phase == final_phase
        types = _merge_types(text_types, phase_types)
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.CHECKPOINT,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name="FinalAnswer" if is_final else "Narration",
            tool_response={"text": text, "phase": clean_phase},
            redaction_types=types,
            truncated=text_truncated or phase_truncated,
        )

    if kind == "plan_narration_guess":
        text, types, truncated = sanitizer.text(payload.get("text"))
        if text is None:
            return None
        return _record(
            thread_id=item.thread_id,
            source_identity=source_identity,
            source_id=item.item_id,
            source_ordinal=item.rollout_ordinal,
            sequence=sequence,
            captured_at=captured_at,
            timestamp_inferred=timestamp_inferred,
            record_type=RecordKind.CHECKPOINT,
            completeness=Completeness.PARTIAL,
            turn_id=item.turn_id,
            tool_name="Plan",
            tool_response={"text": text},
            redaction_types=types,
            truncated=truncated,
        )

    raw_input: object
    guessed_response: object
    fallback_name: str
    if kind == "collab_tool_guess":
        fallback_name = "CollabAgentToolCall"
        raw_input = {
            key: payload.get(key)
            for key in (
                "tool",
                "prompt",
                "receiverThreadIds",
                "senderThreadId",
                "model",
                "reasoningEffort",
            )
            if key in payload
        }
        guessed_response = {
            key: payload.get(key) for key in ("agentsStates", "status") if key in payload
        }
    elif kind == "web_tool_guess":
        fallback_name = "WebSearch"
        raw_input = {
            key: payload.get(key) for key in ("query", "action") if key in payload
        }
        guessed_response = {"results": payload.get("results")}
    elif kind == "image_view_guess":
        fallback_name = "ImageView"
        raw_input = {"path": payload.get("path")}
        guessed_response = {}
    elif kind == "image_generation_guess":
        fallback_name = "ImageGeneration"
        raw_input = {
            key: payload.get(key)
            for key in ("revisedPrompt", "transparentBackground")
            if key in payload
        }
        guessed_response = {
            key: payload.get(key)
            for key in ("result", "failure", "savedPath", "status")
            if key in payload
        }
    else:
        fallback_name = "SubAgentActivity"
        raw_input = {
            key: payload.get(key)
            for key in ("agentPath", "agentThreadId", "kind")
            if key in payload
        }
        guessed_response = {}
    tool_input, input_types, input_truncated = sanitizer.value(raw_input)
    tool_response, response_types, response_truncated = sanitizer.value(guessed_response)
    types = _merge_types(input_types, response_types)
    return _record(
        thread_id=item.thread_id,
        source_identity=source_identity,
        source_id=item.item_id,
        source_ordinal=item.rollout_ordinal,
        sequence=sequence,
        captured_at=captured_at,
        timestamp_inferred=timestamp_inferred,
        record_type=RecordKind.POST_TOOL,
        completeness=Completeness.PARTIAL,
        turn_id=item.turn_id,
        tool_name=fallback_name,
        tool_input=tool_input,
        tool_response=tool_response,
        redaction_types=types,
        truncated=input_truncated or response_truncated,
    )


def _unknown_record(
    item: ThreadHistoryItem,
    *,
    source_identity: str,
    sequence: int,
    fallback_time: datetime,
) -> ReplayRecord:
    captured_at, timestamp_inferred = _item_datetime(item, fallback_time)
    return _record(
        thread_id=item.thread_id,
        source_identity=source_identity,
        source_id=item.item_id,
        source_ordinal=item.rollout_ordinal,
        sequence=sequence,
        captured_at=captured_at,
        timestamp_inferred=timestamp_inferred,
        record_type=RecordKind.UNSUPPORTED,
        completeness=Completeness.UNSUPPORTED,
        turn_id=item.turn_id,
        gap_reason="unsupported_thread_history_item_type",
    )


def _turn_gap_record(
    gap: ThreadHistoryTurnGap,
    turn: ThreadHistoryTurn,
    *,
    source_identity: str,
    sequence: int,
    fallback_time: datetime,
) -> ReplayRecord:
    captured_at, timestamp_inferred = _turn_datetime(turn, fallback_time)
    source_id = f"turn-gap:{gap.turn_id}"
    return _record(
        thread_id=gap.thread_id,
        source_identity=source_identity,
        source_id=source_id,
        source_ordinal=gap.rollout_ordinal,
        sequence=sequence,
        captured_at=captured_at,
        timestamp_inferred=timestamp_inferred,
        record_type=RecordKind.GAP,
        completeness=Completeness.MISSING,
        turn_id=gap.turn_id,
        gap_reason="thread_history_turn_has_no_items",
    )


def parse_thread_history_thread(
    database: Path | str,
    thread_id: str,
    *,
    cwd: str | None = None,
    title: str | None = None,
) -> ThreadHistoryImportResult:
    """Map one projected thread without reading or requiring its source rollout file."""
    database_path = Path(database).expanduser().resolve()
    fallback_time = _fallback_datetime(database_path)
    with ThreadHistoryReader(database_path) as reader:
        items = list(reader.iter_items(thread_id=thread_id))
        turns = list(reader.iter_turns(thread_id=thread_id))
        gaps = [gap for gap in reader.iter_turn_gaps() if gap.thread_id == thread_id]
        migration_version = reader.schema.latest_migration_version

    item_type_counts = Counter(item.item_type or _UNKNOWN_TYPE for item in items)
    unknown_counts = Counter(
        item.item_type or _UNKNOWN_TYPE
        for item in items
        if item.item_type not in ITEM_TYPE_MAPPING
    )
    skipped_counts = Counter(
        item.item_type or _UNKNOWN_TYPE
        for item in items
        if ITEM_TYPE_MAPPING.get(item.item_type or "")
        in {"reasoning_skip", "bookkeeping_skip"}
    )
    final_phase, observed_phases, final_phase_method = _detect_final_phase(items, turns)
    source_identity = _source_identity(thread_id)
    sanitizer = _Sanitizer(CaptureLimits().max_text_field_bytes)
    turn_by_id = {turn.turn_id: turn for turn in turns}

    events: list[tuple[int, int, ThreadHistoryItem | ThreadHistoryTurnGap]] = [
        (item.rollout_ordinal, 1, item) for item in items
    ]
    events.extend((gap.rollout_ordinal, 0, gap) for gap in gaps)
    events.sort(key=lambda event: (event[0], event[1]))
    records: list[ReplayRecord] = []
    for _ordinal, _priority, event in events:
        if isinstance(event, ThreadHistoryTurnGap):
            turn = turn_by_id[event.turn_id]
            records.append(
                _turn_gap_record(
                    event,
                    turn,
                    source_identity=source_identity,
                    sequence=len(records) + 1,
                    fallback_time=fallback_time,
                )
            )
            continue
        mapping = ITEM_TYPE_MAPPING.get(event.item_type or "")
        if mapping is None:
            records.append(
                _unknown_record(
                    event,
                    source_identity=source_identity,
                    sequence=len(records) + 1,
                    fallback_time=fallback_time,
                )
            )
            continue
        mapped = _map_item(
            event,
            kind=mapping,
            sanitizer=sanitizer,
            final_phase=final_phase,
            source_identity=source_identity,
            sequence=len(records) + 1,
            fallback_time=fallback_time,
        )
        if mapped is not None:
            records.append(mapped)

    actual_times = [
        parsed
        for item in items
        for parsed in [
            _epoch_datetime(item.created_at_ms, milliseconds=True)
            or _epoch_datetime(item.started_at_ms, milliseconds=True)
            or _epoch_datetime(item.completed_at_ms, milliseconds=True)
        ]
        if parsed is not None
    ]
    for turn in turns:
        parsed = _epoch_datetime(turn.started_at) or _epoch_datetime(turn.completed_at)
        if parsed is not None:
            actual_times.append(parsed)
    created_at = min(actual_times) if actual_times else fallback_time
    ended_at = max(actual_times) if actual_times else fallback_time
    active = any(
        (turn.status or "").lower().replace("_", "")
        in {"active", "inprogress", "running"}
        for turn in turns
    )

    clean_title, title_types, _title_truncated = sanitizer.text(title)
    if clean_title is None:
        clean_title = next(
            (
                record.prompt_text[:160]
                for record in records
                if record.prompt_text is not None
            ),
            None,
        )
    if title_types:
        clean_title = clean_title or "[redacted history title]"
    format_version = (
        f"thread-history-{migration_version}" if migration_version is not None else "thread-history"
    )
    session = ReplaySession(
        id=thread_id,
        created_at=created_at,
        stopped_at=None if active else ended_at,
        status=SessionStatus.ACTIVE if active else SessionStatus.STOPPED,
        project_root_sha256=_project_identity(cwd, thread_id),
        codex_version=format_version,
        limits=CaptureLimits(),
        import_source=ImportSource.CODEX,
        format_version=format_version,
        source_title=clean_title,
        timeline_started_at=min((record.captured_at for record in records), default=created_at),
        timeline_ended_at=max((record.captured_at for record in records), default=ended_at),
        injected_context_messages=sanitizer.injected_context_messages,
        missing_timestamp_fallbacks=sum(record.timestamp_inferred for record in records),
        out_of_order_steps=sum(
            current.captured_at < previous.captured_at
            for previous, current in zip(records, records[1:], strict=False)
        ),
    )
    gap_count = sum(record.record_type is RecordKind.GAP for record in records)
    unsupported_count = sum(record.record_type is RecordKind.UNSUPPORTED for record in records)
    parse_status: Literal["ok", "partial", "unsupported"] = "ok"
    if gap_count or unsupported_count:
        parse_status = "partial"
    if records and all(record.record_type is RecordKind.UNSUPPORTED for record in records):
        parse_status = "unsupported"
    return ThreadHistoryImportResult(
        session=session,
        records=tuple(records),
        parse_status=parse_status,
        item_type_counts=MappingProxyType(dict(sorted(item_type_counts.items()))),
        unknown_item_types=MappingProxyType(dict(sorted(unknown_counts.items()))),
        skipped_item_types=MappingProxyType(dict(sorted(skipped_counts.items()))),
        gaps=gap_count,
        injected_context_messages=sanitizer.injected_context_messages,
        final_answer_phase=final_phase,
        observed_agent_phases=observed_phases,
        final_phase_method=final_phase_method,
    )


def thread_history_smoke_summary(database: Path | str) -> ThreadHistorySmokeSummary:
    """Return aggregate-only real-database diagnostics without exposing row content."""
    with ThreadHistoryReader(database) as reader:
        items = list(reader.iter_items())
        turns = list(reader.iter_turns())
        gaps = list(reader.iter_turn_gaps())
    item_counts = Counter(item.item_type or _UNKNOWN_TYPE for item in items)
    threads = {item.thread_id for item in items} | {turn.thread_id for turn in turns}
    created_values = [item.created_at_ms for item in items if item.created_at_ms is not None]
    return ThreadHistorySmokeSummary(
        threads=len(threads),
        turns=len(turns),
        items=len(items),
        items_by_type=dict(sorted(item_counts.items())),
        unknown_type_count=sum(
            count for item_type, count in item_counts.items() if item_type not in ITEM_TYPE_MAPPING
        ),
        partial_thread_count=len({gap.thread_id for gap in gaps}),
        created_at_ms_min=min(created_values) if created_values else None,
        created_at_ms_max=max(created_values) if created_values else None,
    )
