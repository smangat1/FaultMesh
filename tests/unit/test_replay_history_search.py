from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_search import (
    HistorySearchResult,
    refresh_history_search_index,
    search_history,
)
from faultmesh.replay.models import ImportSource
from faultmesh.replay.store import ReplayStore

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"


def _history_roots(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")
    return (
        codex_root,
        claude_root,
        tmp_path / "missing-thread-history.sqlite",
        tmp_path / "missing-catalog.sqlite",
    )


def test_refresh_and_search_cached_prompt_text_and_changed_files(tmp_path: Path) -> None:
    codex_root, claude_root, thread_history, catalog = _history_roots(tmp_path)
    store_root = tmp_path / "store"

    first_refresh = refresh_history_search_index(
        store_root=store_root,
        codex_root=codex_root,
        claude_root=claude_root,
        thread_history_path=thread_history,
        catalog_path=catalog,
    )
    second_refresh = refresh_history_search_index(
        store_root=store_root,
        codex_root=codex_root,
        claude_root=claude_root,
        thread_history_path=thread_history,
        catalog_path=catalog,
    )
    prompt_result = search_history(
        "Inspect the parser",
        store_root=store_root,
        codex_root=codex_root,
        claude_root=claude_root,
        thread_history_path=thread_history,
        catalog_path=catalog,
    )
    path_result = search_history(
        "value.py",
        store_root=store_root,
        codex_root=codex_root,
        claude_root=claude_root,
        thread_history_path=thread_history,
        catalog_path=catalog,
    )

    assert first_refresh.discovered_sessions == 1
    assert first_refresh.indexed_sessions == 1
    assert first_refresh.failed_sessions == 0
    assert second_refresh.cached_sessions == 1
    assert prompt_result.match_count == 1
    assert prompt_result.sessions[0].prompts[0].matched_in == ["prompt_text"]
    assert "[redacted:" in (prompt_result.sessions[0].prompts[0].first_line or "")
    assert path_result.match_count == 1
    assert path_result.sessions[0].prompts[0].matched_in == ["changed_file"]
    assert "value.py" in path_result.sessions[0].prompts[0].changed_files


def test_search_includes_imported_replay_store_sessions(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text("VALUE = 1\n", encoding="utf-8")
    store_root = tmp_path / "store"
    with ReplayStore(store_root) as store:
        session = store.create_session(project, codex_version="synthetic")
        imported_session = session.model_copy(
            update={
                "import_source": ImportSource.CODEX,
                "source_title": "Authentication repair",
            }
        )
        record = store.list_records(session.id)[0].model_copy(
            update={
                "turn_id": "turn-one",
                "prompt_id": "prompt-one",
                "prompt_text": "Repair authentication\nUpdate the middleware routing",
            }
        )
        with store.connection:
            store.connection.execute(
                "UPDATE sessions SET record_json = ? WHERE id = ?",
                (imported_session.model_dump_json(), session.id),
            )
            store.connection.execute(
                "UPDATE records SET record_json = ? WHERE session_id = ? AND sequence = 1",
                (record.model_dump_json(), session.id),
            )

    result = search_history(
        "middleware routing",
        store_root=store_root,
        codex_root=tmp_path / "missing-codex",
        claude_root=tmp_path / "missing-claude",
        thread_history_path=tmp_path / "missing-thread-history.sqlite",
        catalog_path=tmp_path / "missing-catalog.sqlite",
    )

    assert result.match_count == 1
    assert result.sessions[0].title == "Authentication repair"
    assert result.sessions[0].prompts[0].matched_in == ["prompt_text"]


def test_search_cli_emits_typed_local_results(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = HistorySearchResult(
        query="auth",
        sessions=[],
        match_count=0,
        indexed_session_count=3,
    )
    monkeypatch.setattr("faultmesh.cli.app.search_history", lambda *_args, **_kwargs: payload)

    result = CliRunner().invoke(app, ["replay-history-search", "auth"])

    assert result.exit_code == 0
    assert HistorySearchResult.model_validate(json.loads(result.stdout)) == payload
