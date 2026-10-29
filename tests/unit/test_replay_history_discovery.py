from __future__ import annotations

import base64
import json
import shutil
from pathlib import Path

from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_discovery import HistoryWatcher, discover_history

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"


def test_discovery_indexes_metadata_and_redacted_preview_without_paths(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_project = claude_root / "-synthetic-example-project"
    claude_project.mkdir(parents=True)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "codex.jsonl")
    shutil.copy(
        FIXTURE_ROOT / "claude_history" / "-synthetic-example-project" / "normal.jsonl",
        claude_project / "claude.jsonl",
    )

    result = discover_history(codex_root=codex_root, claude_root=claude_root)

    assert [(root.tool, root.status, root.file_count) for root in result.roots] == [
        ("codex", "ok", 1),
        ("claude_code", "ok", 1),
    ]
    assert len(result.sessions) == 2
    by_tool = {session.tool: session for session in result.sessions}
    assert by_tool["codex"].session_id == "synthetic-session-normal"
    assert by_tool["codex"].project_display_name == "example-project"
    assert by_tool["codex"].prompt_count == 1
    assert by_tool["codex"].first_prompt_preview is not None
    assert "[redacted: api key]" in by_tool["codex"].first_prompt_preview
    assert by_tool["codex"].redaction_types == ["api key"]
    assert by_tool["claude_code"].session_id == "synthetic-claude-normal"
    assert by_tool["claude_code"].project_display_name == "project"
    serialized = result.model_dump_json()
    assert str(tmp_path) not in serialized
    assert "synthetic_value" not in serialized
    assert '"path"' not in serialized


def test_absent_default_roots_are_clear_and_unrelated_directories_are_not_scanned(
    tmp_path: Path, monkeypatch: object
) -> None:
    desktop = tmp_path / "Desktop"
    desktop.mkdir()
    (desktop / "unrelated.jsonl").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))  # type: ignore[attr-defined]

    result = discover_history()

    assert result.sessions == []
    assert [(root.tool, root.status) for root in result.roots] == [
        ("codex", "missing"),
        ("claude_code", "missing"),
    ]


def test_compressed_codex_without_zstd_is_visible_as_unsupported(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    (codex_root / "compressed.jsonl.zst").write_bytes(
        base64.b64decode(
            (FIXTURE_ROOT / "codex_history" / "normal.jsonl.zst.b64").read_text(encoding="ascii")
        )
    )

    result = discover_history(
        codex_root=codex_root,
        claude_root=claude_root,
        allow_zstd_lookup=False,
    )

    assert len(result.sessions) == 1
    session = result.sessions[0]
    assert session.parse_status == "unsupported"
    assert session.unsupported_reason == "zstd_executable_not_found"


def test_unknown_version_and_corruption_have_visible_statuses(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    shutil.copy(
        FIXTURE_ROOT / "codex_history" / "unknown_version.jsonl",
        codex_root / "unknown.jsonl",
    )
    shutil.copy(FIXTURE_ROOT / "codex_history" / "corrupt.jsonl", codex_root / "corrupt.jsonl")

    result = discover_history(codex_root=codex_root, claude_root=claude_root)
    by_id = {session.session_id: session for session in result.sessions}

    assert by_id["synthetic-session-unknown"].parse_status == "unsupported"
    assert (
        by_id["synthetic-session-unknown"].unsupported_reason == "unsupported_codex_format_version"
    )
    assert by_id["synthetic-session-corrupt"].parse_status == "partial"


def test_watcher_reports_opaque_add_modify_remove_changes(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    watcher = HistoryWatcher(codex_root=codex_root, claude_root=claude_root)
    source = codex_root / "session.jsonl"

    source.write_text(json.dumps({"type": "synthetic"}) + "\n", encoding="utf-8")
    added = watcher.poll()
    assert len(added) == 1
    assert added[0].change == "added"
    assert added[0].tool == "codex"
    assert str(tmp_path) not in added[0].model_dump_json()

    source.write_text(json.dumps({"type": "synthetic", "more": True}) + "\n", encoding="utf-8")
    modified = watcher.poll()
    assert len(modified) == 1
    assert modified[0].change == "modified"
    assert modified[0].source_key == added[0].source_key

    source.unlink()
    removed = watcher.poll()
    assert len(removed) == 1
    assert removed[0].change == "removed"
    assert removed[0].source_key == added[0].source_key


def test_discovery_does_not_follow_symlinked_directories(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    outside = tmp_path / "outside"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    outside.mkdir()
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", outside / "hidden.jsonl")
    (codex_root / "linked").symlink_to(outside, target_is_directory=True)

    result = discover_history(codex_root=codex_root, claude_root=claude_root)

    assert result.sessions == []
    assert result.roots[0].file_count == 0


def test_history_cli_lists_redacted_index_and_supports_bounded_watch(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "one.jsonl")
    runner = CliRunner()

    listed = runner.invoke(
        app,
        [
            "replay-history-list",
            "--codex-root",
            str(codex_root),
            "--claude-root",
            str(claude_root),
        ],
    )
    watched = runner.invoke(
        app,
        [
            "replay-history-watch",
            "--codex-root",
            str(codex_root),
            "--claude-root",
            str(claude_root),
            "--iterations",
            "1",
            "--interval-seconds",
            "0",
        ],
    )

    assert listed.exit_code == 0
    assert "synthetic-session-normal" in listed.stdout
    assert "[redacted: api key]" in listed.stdout
    assert "synthetic_value" not in listed.stdout
    assert str(tmp_path) not in listed.stdout
    assert watched.exit_code == 0
    assert watched.stdout == ""
