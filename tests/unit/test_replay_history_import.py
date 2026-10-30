from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_discovery import discover_history
from faultmesh.replay.history_import import import_history_session, real_history_smoke_summary
from faultmesh.replay.models import RecordKind, ReplayExport
from faultmesh.replay.views import load_export

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"


def _history_roots(tmp_path: Path) -> tuple[Path, Path]:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    return codex_root, claude_root


def test_selected_history_round_trips_through_existing_ui_export_loader(
    tmp_path: Path,
) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    source = codex_root / "normal.jsonl"
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", source)
    connection = sqlite3.connect(codex_root.parent / "state_5.sqlite")
    try:
        connection.execute(
            "CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, archived INTEGER)"
        )
        connection.execute(
            "INSERT INTO threads VALUES (?, ?, ?, ?)",
            (
                "synthetic-session-normal",
                str(source),
                "Synthetic title token=TITLE_SENTINEL",
                0,
            ),
        )
        connection.commit()
    finally:
        connection.close()
    export_path = tmp_path / "history-replay.json"

    exported = import_history_session(
        "synthetic-session-normal",
        tool="codex",
        codex_root=codex_root,
        claude_root=claude_root,
    )
    schema_validated = ReplayExport.model_validate_json(exported.model_dump_json())
    export_path.write_text(schema_validated.model_dump_json(indent=2) + "\n", encoding="utf-8")
    loaded = load_export(export_path)

    assert loaded == exported
    assert loaded.schema_version == "replay-export-1.1"
    assert loaded.session.import_source is not None
    assert loaded.session.import_source.value == "codex"
    assert loaded.session.history_state == "active"
    assert loaded.session.source_title is not None
    assert "TITLE_SENTINEL" not in loaded.session.source_title
    assert "[redacted: token]" in loaded.session.source_title
    assert loaded.manifests == []
    assert loaded.content_base64_by_sha256 == {}
    assert loaded.tests == []
    assert len(loaded.timeline) == len(loaded.records)
    derived_changes = [change for entry in loaded.timeline for change in entry.changed_files]
    assert derived_changes
    assert all(change.derived_from == "recorded_patch" for change in derived_changes)
    assert all(change.file_state == "unknown" for change in derived_changes)
    assert loaded.transcript_spans
    prompt = next(record for record in loaded.records if record.prompt_text is not None)
    assert "[redacted: api key]" in (prompt.prompt_text or "")
    assert prompt.redaction_types == ["api key", "password"]
    assert any("derived and unverified" in limitation for limitation in loaded.limitations)


def test_unsupported_selected_history_is_a_valid_visible_export(tmp_path: Path) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    shutil.copy(
        FIXTURE_ROOT / "codex_history" / "unknown_version.jsonl",
        codex_root / "unknown.jsonl",
    )

    exported = import_history_session(
        "synthetic-session-unknown",
        codex_root=codex_root,
        claude_root=claude_root,
    )

    assert len(exported.records) == 1
    assert exported.records[0].record_type is RecordKind.UNSUPPORTED
    assert exported.timeline[0].gap_reason == "unsupported_codex_format_version"


def test_selected_claude_history_uses_the_same_additive_export(tmp_path: Path) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    project = claude_root / "-synthetic-example-project"
    project.mkdir()
    shutil.copy(
        FIXTURE_ROOT / "claude_history" / "-synthetic-example-project" / "normal.jsonl",
        project / "normal.jsonl",
    )

    exported = import_history_session(
        "synthetic-claude-normal",
        tool="claude_code",
        codex_root=codex_root,
        claude_root=claude_root,
    )

    assert exported.session.import_source is not None
    assert exported.session.import_source.value == "claude_code"
    assert len(exported.records) == 15
    assert exported.manifests == []
    assert ReplayExport.model_validate_json(exported.model_dump_json()) == exported


def test_archived_import_preserves_source_order_and_exports_monotonic_extents(
    tmp_path: Path,
) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    archived = codex_root.parent / "archived_sessions" / "2026" / "10" / "29"
    archived.mkdir(parents=True)
    source = archived / "nonmonotonic.jsonl"
    records = [
        {
            "timestamp": "2026-10-29T12:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": "synthetic-archived-nonmonotonic",
                "timestamp": "2026-10-29T12:00:00Z",
                "cwd": "/synthetic/archived",
                "cli_version": "0.165.0-alpha.1.2",
            },
        },
        {
            "timestamp": "2026-10-29T12:10:00Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": "later-prompt",
                "content": [{"type": "input_text", "text": "Synthetic later prompt"}],
            },
        },
        {
            "timestamp": "2026-10-29T12:05:00Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "item": {
                    "type": "CommandExecution",
                    "id": "earlier-command",
                    "command": ["python -m pytest -q"],
                    "aggregated_output": "synthetic output",
                    "status": "completed",
                },
            },
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    exported = import_history_session(
        "synthetic-archived-nonmonotonic",
        tool="codex",
        codex_root=codex_root,
        claude_root=claude_root,
    )

    assert exported.session.history_state == "archived"
    assert exported.records[0].captured_at > exported.records[1].captured_at
    assert exported.session.timeline_started_at == exported.records[1].captured_at
    assert exported.session.timeline_ended_at == exported.records[0].captured_at
    assert exported.session.timeline_started_at <= exported.session.timeline_ended_at
    assert exported.timeline[0].sequence == 1
    assert exported.timeline[1].sequence == 2


def test_smoke_summary_is_aggregate_only_for_synthetic_roots(tmp_path: Path) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")

    summary = real_history_smoke_summary(codex_root=codex_root, claude_root=claude_root)
    serialized = summary.model_dump_json()

    assert summary.sessions_found == 1
    assert summary.ok == 1
    assert summary.imports_validated == 1
    assert summary.import_failures == 0
    assert summary.redactions_by_type == {"api key": 3, "password": 5, "secret": 1}
    assert "synthetic-session-normal" not in serialized
    assert "synthetic_value" not in serialized
    assert str(tmp_path) not in serialized


def test_history_import_cli_writes_loadable_export_and_reports_only_summary(
    tmp_path: Path,
) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")
    export_path = tmp_path / "selected.json"

    result = CliRunner().invoke(
        app,
        [
            "replay-history-import",
            "synthetic-session-normal",
            "--tool",
            "codex",
            "--codex-root",
            str(codex_root),
            "--claude-root",
            str(claude_root),
            "--out",
            str(export_path),
        ],
    )

    assert result.exit_code == 0, result.output
    summary = json.loads(result.output)
    assert summary == {
        "path": str(export_path.resolve()),
        "records": 9,
        "schema_version": "replay-export-1.1",
        "session_id": "synthetic-session-normal",
    }
    assert "synthetic_value" not in result.output
    assert load_export(export_path).session.id == "synthetic-session-normal"


def test_supported_parsers_redact_every_sentinel_before_index_and_export(
    tmp_path: Path,
) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    claude_project = claude_root / "-synthetic-example-project"
    claude_project.mkdir()
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")
    shutil.copy(
        FIXTURE_ROOT / "claude_history" / "-synthetic-example-project" / "normal.jsonl",
        claude_project / "normal.jsonl",
    )

    index = discover_history(codex_root=codex_root, claude_root=claude_root)
    codex_export = import_history_session(
        "synthetic-session-normal",
        tool="codex",
        codex_root=codex_root,
        claude_root=claude_root,
    )
    claude_export = import_history_session(
        "synthetic-claude-normal",
        tool="claude_code",
        codex_root=codex_root,
        claude_root=claude_root,
    )
    serialized_index = index.model_dump_json()
    serialized_exports = codex_export.model_dump_json() + claude_export.model_dump_json()

    assert "FM_" not in serialized_index
    assert "FM_" not in serialized_exports
    assert "[redacted: api key]" in serialized_index
    assert "[redacted: password]" in serialized_index
    for marker in (
        "[redacted: api key]",
        "[redacted: password]",
        "[redacted: secret]",
        "[redacted: url password]",
    ):
        assert marker in serialized_exports
    redaction_types = {
        label
        for exported in (codex_export, claude_export)
        for record in exported.records
        for label in record.redaction_types or []
    }
    assert redaction_types >= {"api key", "password", "secret", "url password"}
    assert "safe synthetic query" in serialized_exports
    assert "write_text" in serialized_exports
    assert "VALUE = 1" in serialized_exports


@pytest.mark.parametrize(
    ("case_id", "fragment", "sensitive_value", "marker", "redaction_type"),
    [
        (
            "camel-api-key",
            '{"apiKey":"CAMEL_API_KEY_SENTINEL"}',
            "CAMEL_API_KEY_SENTINEL",
            "[redacted: api key]",
            "api key",
        ),
        (
            "camel-client-secret",
            '{"clientSecret":"CAMEL_CLIENT_SECRET_SENTINEL"}',
            "CAMEL_CLIENT_SECRET_SENTINEL",
            "[redacted: secret]",
            "secret",
        ),
        (
            "secret-key",
            '{"secret_key":"SECRET_KEY_SENTINEL"}',
            "SECRET_KEY_SENTINEL",
            "[redacted: secret]",
            "secret",
        ),
        (
            "passphrase",
            '{"passphrase":"PASSPHRASE_SENTINEL"}',
            "PASSPHRASE_SENTINEL",
            "[redacted: password]",
            "password",
        ),
        (
            "authorization",
            '{"authorization":"Basic AUTHORIZATION_SENTINEL"}',
            "AUTHORIZATION_SENTINEL",
            "[redacted: authorization]",
            "authorization",
        ),
        (
            "cookie",
            '{"cookie":"COOKIE_SENTINEL"}',
            "COOKIE_SENTINEL",
            "[redacted: cookie]",
            "cookie",
        ),
        (
            "set-cookie",
            '{"set-cookie":"session=SET_COOKIE_SENTINEL; HttpOnly"}',
            "SET_COOKIE_SENTINEL",
            "[redacted: cookie]",
            "cookie",
        ),
        (
            "password-flag",
            "--password FLAG_PASSWORD_SENTINEL",
            "FLAG_PASSWORD_SENTINEL",
            "[redacted: password]",
            "password",
        ),
        (
            "token-flag",
            "--token FLAG_TOKEN_SENTINEL",
            "FLAG_TOKEN_SENTINEL",
            "[redacted: token]",
            "token",
        ),
        (
            "curl-user",
            "curl -u synthetic-user:CURL_PASSWORD_SENTINEL https://example.invalid",
            "CURL_PASSWORD_SENTINEL",
            "[redacted: password]",
            "password",
        ),
        (
            "numeric-password",
            '{"password":987654321}',
            "987654321",
            "[redacted: password]",
            "password",
        ),
    ],
)
def test_common_secret_forms_are_absent_from_preview_prompt_and_command_output(
    tmp_path: Path,
    case_id: str,
    fragment: str,
    sensitive_value: str,
    marker: str,
    redaction_type: str,
) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    session_id = f"synthetic-hardening-{case_id}"
    source = codex_root / f"{case_id}.jsonl"
    records = [
        {
            "timestamp": "2026-10-29T15:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "session_id": session_id,
                "timestamp": "2026-10-29T15:00:00Z",
                "cwd": "/synthetic/privacy-hardening",
                "cli_version": "0.165.0-alpha.1.2",
            },
            "ordinal": 0,
        },
        {
            "timestamp": "2026-10-29T15:00:01Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": f"prompt-{case_id}",
                "content": [{"type": "input_text", "text": fragment}],
            },
            "ordinal": 1,
        },
        {
            "timestamp": "2026-10-29T15:00:02Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "turn_id": f"turn-{case_id}",
                "item": {
                    "type": "CommandExecution",
                    "id": f"command-{case_id}",
                    "command": ["python -m pytest -q"],
                    "aggregated_output": fragment,
                    "status": "completed",
                    "exit_code": 0,
                },
            },
            "ordinal": 2,
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    discovered = discover_history(codex_root=codex_root, claude_root=claude_root)
    indexed = discovered.sessions[0]
    exported = import_history_session(
        session_id,
        tool="codex",
        codex_root=codex_root,
        claude_root=claude_root,
    )
    prompt = next(record for record in exported.records if record.prompt_text is not None)
    command = next(record for record in exported.records if record.tool_name == "Bash")
    command_output = json.dumps(command.tool_response, sort_keys=True)

    assert indexed.first_prompt_preview is not None
    assert sensitive_value not in indexed.first_prompt_preview
    assert sensitive_value not in (prompt.prompt_text or "")
    assert sensitive_value not in command_output
    assert marker in indexed.first_prompt_preview
    assert marker in (prompt.prompt_text or "")
    assert marker in command_output
    assert redaction_type in indexed.redaction_types
    assert redaction_type in (prompt.redaction_types or [])
    assert redaction_type in (command.redaction_types or [])


def test_history_import_rejects_unknown_session_without_writing(tmp_path: Path) -> None:
    codex_root, claude_root = _history_roots(tmp_path)
    output = tmp_path / "missing.json"

    with pytest.raises(KeyError, match="unknown history session"):
        import_history_session(
            "does-not-exist",
            codex_root=codex_root,
            claude_root=claude_root,
        )
    assert not output.exists()
