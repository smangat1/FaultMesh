from __future__ import annotations

import base64
import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_discovery import (
    HistoryWatcher,
    default_codex_catalog_path,
    default_codex_history_root,
    discover_history,
)

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"


def _write_codex_history(
    path: Path,
    *,
    session_id: str,
    cwd: str,
    prompts: list[str],
) -> None:
    records: list[dict[str, object]] = [
        {
            "timestamp": "2026-10-29T12:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "timestamp": "2026-10-29T12:00:00Z",
                "cwd": cwd,
                "cli_version": "0.165.0-alpha.1.2",
            },
        }
    ]
    records.extend(
        {
            "timestamp": f"2026-10-29T12:00:{index:02d}Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": f"prompt-{index}",
                "content": [{"type": "input_text", "text": prompt}],
            },
        }
        for index, prompt in enumerate(prompts, start=1)
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )


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
    assert by_tool["codex"].redaction_types == ["api key", "password"]
    assert by_tool["claude_code"].session_id == "synthetic-claude-normal"
    assert by_tool["claude_code"].project_display_name == "project"
    serialized = result.model_dump_json()
    assert str(tmp_path) not in serialized
    assert "synthetic_value" not in serialized
    assert "FM_" not in serialized
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


def test_codex_home_and_sqlite_home_environment_overrides_are_respected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "custom-codex"))
    monkeypatch.setenv("CODEX_SQLITE_HOME", str(tmp_path / "custom-sqlite"))

    assert default_codex_history_root() == tmp_path / "custom-codex" / "sessions"
    assert default_codex_catalog_path() == tmp_path / "custom-sqlite" / "state_5.sqlite"


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


def test_injected_context_is_excluded_from_preview_and_prompt_count(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    claude_root.mkdir(parents=True)
    _write_codex_history(
        codex_root / "injected.jsonl",
        session_id="synthetic-injected-context",
        cwd="/synthetic/project",
        prompts=[
            "<environment_context><cwd>/synthetic/project</cwd></environment_context>\n"
            "<user_instructions>synthetic agent instructions</user_instructions>",
            "Please implement the real synthetic request",
        ],
    )

    result = discover_history(codex_root=codex_root, claude_root=claude_root)
    session = result.sessions[0]

    assert session.prompt_count == 1
    assert session.first_prompt_preview == "Please implement the real synthetic request"
    assert session.injected_context_messages == 1


def test_archived_sessions_are_discovered_and_active_copy_wins_deduplication(
    tmp_path: Path,
) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    archived_root = tmp_path / ".codex" / "archived_sessions" / "2026" / "10" / "29"
    claude_root = tmp_path / ".claude" / "projects"
    claude_root.mkdir(parents=True)
    for path in (codex_root / "active.jsonl", archived_root / "archived.jsonl"):
        _write_codex_history(
            path,
            session_id="synthetic-moved-session",
            cwd="/synthetic/project",
            prompts=["Synthetic active prompt"],
        )

    result = discover_history(codex_root=codex_root, claude_root=claude_root)

    assert len(result.sessions) == 1
    assert result.sessions[0].history_state == "active"
    assert result.roots[0].active_file_count == 1
    assert result.roots[0].archived_file_count == 1


def test_system_temp_project_is_classified_without_exposing_its_path(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    claude_root.mkdir(parents=True)
    _write_codex_history(
        codex_root / "temp.jsonl",
        session_id="synthetic-temp-session",
        cwd="/private/var/folders/synthetic/faultmesh-capture-boundary/fixture",
        prompts=["Synthetic temp prompt"],
    )

    result = discover_history(codex_root=codex_root, claude_root=claude_root)

    assert result.sessions[0].project_visibility == "system_temp"
    assert "/private/var/folders" not in result.model_dump_json()


def test_sqlite_catalog_enriches_matches_and_reports_missing_rollouts(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    claude_root.mkdir(parents=True)
    source = codex_root / "matched.jsonl"
    _write_codex_history(
        source,
        session_id="synthetic-catalog-match",
        cwd="/synthetic/catalog-project",
        prompts=["Synthetic catalog prompt"],
    )
    database = codex_root.parent / "state_5.sqlite"
    connection = sqlite3.connect(database)
    try:
        connection.execute(
            "CREATE TABLE threads (id TEXT, rollout_path TEXT, created_at TEXT, cwd TEXT, "
            "title TEXT, first_user_message TEXT, preview TEXT, archived INTEGER)"
        )
        connection.executemany(
            "INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    "synthetic-catalog-match",
                    str(source),
                    "2026-10-29T12:00:00Z",
                    "/synthetic/catalog-project",
                    "Catalog title token=CATALOG_TITLE_SENTINEL",
                    "Synthetic catalog prompt",
                    "Synthetic catalog preview",
                    0,
                ),
                (
                    "synthetic-catalog-missing",
                    str(codex_root / "missing.jsonl"),
                    "2026-10-29T11:00:00Z",
                    "/synthetic/missing-project",
                    "Missing synthetic rollout",
                    "Synthetic missing prompt",
                    "Synthetic missing preview",
                    1,
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    result = discover_history(codex_root=codex_root, claude_root=claude_root)
    by_id = {session.session_id: session for session in result.sessions}

    assert result.roots[0].catalog_status == "ok"
    assert by_id["synthetic-catalog-match"].catalog_matched is True
    assert by_id["synthetic-catalog-match"].source_title is not None
    assert "CATALOG_TITLE_SENTINEL" not in by_id["synthetic-catalog-match"].source_title
    assert by_id["synthetic-catalog-missing"].parse_status == "unsupported"
    assert by_id["synthetic-catalog-missing"].unsupported_reason == "rollout_file_missing"
    assert by_id["synthetic-catalog-missing"].history_state == "archived"
    assert str(tmp_path) not in result.model_dump_json()


def test_sqlite_catalog_schema_variants_are_tolerated(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    connection = sqlite3.connect(codex_root.parent / "state_5.sqlite")
    try:
        connection.execute("CREATE TABLE threads (id TEXT, rollout_path TEXT)")
        connection.execute(
            "INSERT INTO threads VALUES (?, ?)",
            ("synthetic-minimal-catalog", str(codex_root / "gone.jsonl")),
        )
        connection.commit()
    finally:
        connection.close()

    result = discover_history(codex_root=codex_root, claude_root=claude_root)

    assert result.roots[0].catalog_status == "ok"
    assert result.sessions[0].unsupported_reason == "rollout_file_missing"


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
