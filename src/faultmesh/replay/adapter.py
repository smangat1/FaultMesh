"""Version-gated adapter from Codex hook input to immutable capture envelopes."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from faultmesh.replay.capture import capture_snapshot
from faultmesh.replay.models import CaptureEnvelope, RecordKind
from faultmesh.replay.store import ReplayStore

SUPPORTED_TOOL_NAMES = {"Bash", "apply_patch"}
SUPPORTED_HOOK_EVENTS = {"PreToolUse", "PostToolUse"}


def _record_id(session_id: str, hook_event: str, tool_use_id: str) -> str:
    value = f"{session_id}\0{hook_event}\0{tool_use_id}".encode()
    return f"record-{hashlib.sha256(value).hexdigest()}"


def capture_hook_event(
    store: ReplayStore, session_id: str, event: object
) -> CaptureEnvelope | None:
    """Capture one synchronous hook boundary without executing project code."""
    session = store.get_session(session_id)
    if not isinstance(event, dict):
        store.append_gap(
            session_id,
            source_identity=f"hook:{session_id}:invalid",
            source_offset=0,
            reason="hook_input_not_object",
            provenance="codex_hook",
            unsupported=True,
        )
        return None
    hook_event = event.get("hook_event_name")
    tool_use_id = event.get("tool_use_id")
    tool_name = event.get("tool_name")
    if not isinstance(hook_event, str) or not isinstance(tool_use_id, str):
        store.append_gap(
            session_id,
            source_identity=f"hook:{session_id}:missing_identity",
            source_offset=0,
            reason="hook_event_missing_identity",
            provenance="codex_hook",
            unsupported=True,
        )
        return None
    source_identity = f"hook:{hook_event}:{tool_use_id}"
    if hook_event not in SUPPORTED_HOOK_EVENTS or tool_name not in SUPPORTED_TOOL_NAMES:
        store.append_gap(
            session_id,
            source_identity=source_identity,
            source_offset=0,
            reason=f"unsupported_hook_or_tool:{hook_event}:{tool_name}",
            provenance="codex_hook",
            unsupported=True,
        )
        return None
    project_root = store.get_project_root(session_id)
    cwd = event.get("cwd")
    if not isinstance(cwd, str) or Path(cwd).resolve() != project_root:
        store.append_gap(
            session_id,
            source_identity=source_identity,
            source_offset=0,
            reason="hook_cwd_changed_from_selected_root",
            provenance="codex_hook",
        )
        return None
    try:
        snapshot = capture_snapshot(project_root, session.limits)
    except (OSError, ValueError) as exc:
        store.append_gap(
            session_id,
            source_identity=source_identity,
            source_offset=0,
            reason=f"snapshot_failed:{type(exc).__name__}",
            provenance="codex_hook",
        )
        return None
    record_type = RecordKind.PRE_TOOL if hook_event == "PreToolUse" else RecordKind.POST_TOOL
    envelope = CaptureEnvelope(
        record_id=_record_id(session_id, hook_event, tool_use_id),
        record_type=record_type,
        captured_at=datetime.now(UTC),
        project_root_sha256=session.project_root_sha256,
        codex_version=session.codex_version,
        session_id=session_id,
        turn_id=event.get("turn_id") if isinstance(event.get("turn_id"), str) else None,
        tool_use_id=tool_use_id,
        tool_name=str(tool_name),
        files=snapshot.payloads,
        skipped=snapshot.manifest.skipped,
        partial=snapshot.manifest.partial,
        raw_tool_input=event.get("tool_input"),
        raw_tool_response=event.get("tool_response"),
    )
    store.add_envelope(
        envelope,
        source_identity=source_identity,
        source_offset=0,
        provenance="codex_hook",
    )
    return envelope
