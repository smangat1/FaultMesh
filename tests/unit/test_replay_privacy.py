from __future__ import annotations

from pathlib import Path

from faultmesh.replay.adapter import capture_hook_event
from faultmesh.replay.models import RecordKind
from faultmesh.replay.privacy import REDACTION_MARKER, TRUNCATION_MARKER, redact_text
from faultmesh.replay.store import ReplayStore


def _project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    return root


def test_redaction_happens_before_default_persistence(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        event = {
            "hook_event_name": "PreToolUse",
            "tool_use_id": "tool-1",
            "turn_id": "turn-1",
            "tool_name": "Bash",
            "cwd": str(root),
            "tool_input": {
                "command": "api_key=synthetic_value token=synthetic_token"
            },
        }
        capture_hook_event(store, session.id, event)
        record = store.list_records(session.id)[-1]

    serialized = str(record.tool_input)
    assert REDACTION_MARKER in serialized
    assert "synthetic_value" not in serialized
    assert "synthetic_token" not in serialized
    assert record.redaction_applied is True


def test_raw_logging_requires_explicit_opt_in(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(
            root, codex_version="codex-cli test", raw_logging=True
        )
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PreToolUse",
                "tool_use_id": "tool-raw",
                "tool_name": "Bash",
                "cwd": str(root),
                "tool_input": {"command": "token=synthetic-secret"},
            },
        )
        record = store.list_records(session.id)[-1]

    assert "synthetic-secret" in str(record.tool_input)
    assert record.redaction_applied is False


def test_changed_root_and_unknown_tool_are_visible_gaps(tmp_path: Path) -> None:
    root = _project(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PreToolUse",
                "tool_use_id": "tool-root",
                "tool_name": "Bash",
                "cwd": str(other),
            },
        )
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PostToolUse",
                "tool_use_id": "tool-future",
                "tool_name": "FutureTool",
                "cwd": str(root),
            },
        )
        records = store.list_records(session.id)

    assert records[-2].record_type == RecordKind.GAP
    assert records[-2].gap_reason == "hook_cwd_changed_from_selected_root"
    assert records[-1].record_type == RecordKind.UNSUPPORTED


def test_text_truncation_is_marked() -> None:
    result, _redacted, truncated = redact_text("x" * 500, 128)
    assert TRUNCATION_MARKER in result
    assert truncated is True
