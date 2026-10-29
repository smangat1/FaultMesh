from __future__ import annotations

import json
import shutil
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
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")
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
    assert loaded.schema_version == "replay-export-1.0"
    assert loaded.session.import_source is not None
    assert loaded.session.import_source.value == "codex"
    assert loaded.manifests == []
    assert loaded.content_base64_by_sha256 == {}
    assert loaded.tests == []
    assert len(loaded.timeline) == len(loaded.records)
    assert all(not entry.changed_files for entry in loaded.timeline)
    prompt = next(record for record in loaded.records if record.prompt_text is not None)
    assert "[redacted: api key]" in (prompt.prompt_text or "")
    assert prompt.redaction_types == ["api key", "password"]
    assert any("file bytes are unknown" in limitation for limitation in loaded.limitations)


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
        "schema_version": "replay-export-1.0",
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
