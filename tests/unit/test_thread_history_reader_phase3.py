from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Mapping
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_discovery import discover_history
from faultmesh.replay.history_import import (
    BothHistorySourcesMissingError,
    HistorySourcesMissingError,
    import_history_session,
    import_thread_history_session,
)
from faultmesh.replay.models import RecordKind, ReplayExport
from faultmesh.replay.thread_history_import import thread_history_smoke_summary


def _create_synthetic_catalog(
    path: Path,
    threads: list[dict[str, object]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT,
                created_at INTEGER,
                cwd TEXT,
                title TEXT,
                first_user_message TEXT,
                preview TEXT,
                archived INTEGER
            )
            """
        )
        for thread in threads:
            connection.execute(
                """
                INSERT INTO threads (
                    id, rollout_path, created_at, cwd, title,
                    first_user_message, preview, archived
                )
                VALUES (
                    :id, :rollout_path, :created_at, :cwd, :title,
                    :first_user_message, :preview, :archived
                )
                """,
                {
                    "id": thread["id"],
                    "rollout_path": thread.get("rollout_path"),
                    "created_at": thread.get("created_at", 1_770_000_000_000),
                    "cwd": thread.get("cwd", "/synthetic/test/project"),
                    "title": thread.get("title", "Synthetic Thread Title"),
                    "first_user_message": thread.get("first_user_message"),
                    "preview": thread.get("preview"),
                    "archived": thread.get("archived", 0),
                },
            )
        connection.commit()


def _create_synthetic_projection(
    path: Path,
    *,
    items: list[dict[str, object]] | None = None,
    turns: list[dict[str, object]] | None = None,
    migration_version: int = 1,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
            VALUES (?, 'initial', 1, X'00', 10)
            """,
            (migration_version,),
        )
        connection.execute(
            """
            CREATE TABLE thread_turns (
                thread_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                rollout_ordinal INTEGER NOT NULL,
                status TEXT NOT NULL,
                error_json TEXT,
                started_at INTEGER,
                completed_at INTEGER,
                duration_ms INTEGER,
                first_user_item_id TEXT,
                final_agent_item_id TEXT,
                rollout_byte_offset INTEGER,
                rollout_end_ordinal INTEGER,
                rollout_end_byte_offset INTEGER,
                root_turn_id TEXT,
                PRIMARY KEY (thread_id, turn_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE thread_items (
                thread_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                rollout_ordinal INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                item_json TEXT NOT NULL,
                item_type TEXT NOT NULL DEFAULT '',
                updated_at_ordinal INTEGER NOT NULL DEFAULT 0,
                started_at_ms INTEGER,
                completed_at_ms INTEGER,
                PRIMARY KEY (thread_id, turn_id, item_id)
            )
            """
        )
        if turns:
            for turn in turns:
                connection.execute(
                    """
                    INSERT INTO thread_turns (
                        thread_id, turn_id, rollout_ordinal, status, error_json,
                        started_at, completed_at, duration_ms, first_user_item_id,
                        final_agent_item_id, rollout_byte_offset, rollout_end_ordinal,
                        rollout_end_byte_offset, root_turn_id
                    )
                    VALUES (
                        :thread_id, :turn_id, :rollout_ordinal, :status, :error_json,
                        :started_at, :completed_at, :duration_ms, :first_user_item_id,
                        :final_agent_item_id, :rollout_byte_offset, :rollout_end_ordinal,
                        :rollout_end_byte_offset, :root_turn_id
                    )
                    """,
                    {
                        "thread_id": turn["thread_id"],
                        "turn_id": turn["turn_id"],
                        "rollout_ordinal": turn.get("rollout_ordinal", 1),
                        "status": turn.get("status", "completed"),
                        "error_json": turn.get("error_json"),
                        "started_at": turn.get("started_at", 1_770_000_000),
                        "completed_at": turn.get("completed_at", 1_770_000_010),
                        "duration_ms": turn.get("duration_ms", 10_000),
                        "first_user_item_id": turn.get("first_user_item_id"),
                        "final_agent_item_id": turn.get("final_agent_item_id"),
                        "rollout_byte_offset": turn.get("rollout_byte_offset"),
                        "rollout_end_ordinal": turn.get("rollout_end_ordinal"),
                        "rollout_end_byte_offset": turn.get("rollout_end_byte_offset"),
                        "root_turn_id": turn.get("root_turn_id"),
                    },
                )
        if items:
            for item in items:
                connection.execute(
                    """
                    INSERT INTO thread_items (
                        thread_id, turn_id, item_id, rollout_ordinal, created_at_ms,
                        item_json, item_type, updated_at_ordinal, started_at_ms, completed_at_ms
                    )
                    VALUES (
                        :thread_id, :turn_id, :item_id, :rollout_ordinal,
                        :created_at_ms, :item_json, :item_type,
                        :updated_at_ordinal, :started_at_ms, :completed_at_ms
                    )
                    """,
                    {
                        "thread_id": item["thread_id"],
                        "turn_id": item.get("turn_id", "turn-1"),
                        "item_id": item["item_id"],
                        "rollout_ordinal": item.get("rollout_ordinal", 1),
                        "created_at_ms": item.get("created_at_ms", 1_770_000_000_000),
                        "item_json": item["item_json"],
                        "item_type": item.get("item_type", "userMessage"),
                        "updated_at_ordinal": item.get("updated_at_ordinal", 0),
                        "started_at_ms": item.get("started_at_ms"),
                        "completed_at_ms": item.get("completed_at_ms"),
                    },
                )
        connection.commit()


def test_import_resolves_catalog_only_session_through_projection(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    projection_path = codex_root.parent / "thread_history_1.sqlite"

    thread_id = "synthetic-catalog-thread-1"
    cwd = "/synthetic/work/project-alpha"
    title = "Investigate token leak in auth worker"

    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": thread_id,
                "rollout_path": str(codex_root / "missing-rollout.jsonl"),
                "created_at": 1_770_000_000_000,
                "cwd": cwd,
                "title": title,
                "archived": 0,
            }
        ],
    )

    items = [
        {
            "thread_id": thread_id,
            "turn_id": "turn-1",
            "item_id": "item-user-1",
            "rollout_ordinal": 1,
            "created_at_ms": 1_770_000_000_000,
            "item_type": "userMessage",
            "item_json": json.dumps(
                {
                    "type": "userMessage",
                    "id": "item-user-1",
                    "content": [{"type": "text", "text": "Debug auth token flow"}],
                }
            ),
        },
        {
            "thread_id": thread_id,
            "turn_id": "turn-1",
            "item_id": "item-cmd-1",
            "rollout_ordinal": 2,
            "created_at_ms": 1_770_000_002_000,
            "item_type": "commandExecution",
            "item_json": json.dumps(
                {
                    "type": "commandExecution",
                    "id": "item-cmd-1",
                    "command": ["pytest tests/test_auth.py"],
                    "status": "completed",
                    "exitCode": 0,
                }
            ),
        },
    ]
    turns = [
        {
            "thread_id": thread_id,
            "turn_id": "turn-1",
            "rollout_ordinal": 1,
            "status": "completed",
            "started_at": 1_770_000_000,
            "completed_at": 1_770_000_010,
        }
    ]
    _create_synthetic_projection(projection_path, items=items, turns=turns)

    # 1. import via Python API
    exported = import_history_session(
        thread_id,
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )

    assert isinstance(exported, ReplayExport)
    assert exported.session.id == thread_id
    assert exported.session.source_title == title
    assert exported.session.history_state == "active"
    assert exported.session.project_root_sha256 == hashlib.sha256(cwd.encode()).hexdigest()
    assert len(exported.records) == 2
    assert exported.records[0].record_type is RecordKind.CHECKPOINT
    assert exported.records[0].prompt_text == "Debug auth token flow"
    assert exported.records[1].record_type is RecordKind.POST_TOOL
    assert len(exported.timeline) == 2

    validated = ReplayExport.model_validate_json(exported.model_dump_json())
    assert validated.session.id == thread_id

    # 2. direct import_thread_history_session call with history_state
    direct_export = import_thread_history_session(
        projection_path,
        thread_id,
        cwd=cwd,
        title=title,
        history_state="archived",
    )
    assert direct_export.session.history_state == "archived"
    assert direct_export.session.source_title == title

    # 3. CLI replay-history-import invocation
    out_path = tmp_path / "imported-export.json"
    result = CliRunner().invoke(
        app,
        [
            "replay-history-import",
            thread_id,
            "--out",
            str(out_path),
            "--codex-root",
            str(codex_root),
            "--catalog",
            str(catalog_path),
            "--thread-history",
            str(projection_path),
        ],
    )
    assert result.exit_code == 0, result.output
    loaded_export = ReplayExport.model_validate_json(out_path.read_text(encoding="utf-8"))
    assert loaded_export.session.id == thread_id
    assert loaded_export.session.source_title == title


def test_discovery_upgrades_missing_rollout_catalog_thread_in_projection(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    projection_path = codex_root.parent / "thread_history_1.sqlite"

    recovered_id = "thread-recovered-1"
    absent_id = "thread-absent-2"

    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": recovered_id,
                "rollout_path": str(codex_root / "missing-rollout-1.jsonl"),
                "created_at": 1_770_000_000_000,
                "cwd": "/synthetic/work/service",
                "title": "Recovered Investigation",
                "archived": 0,
            },
            {
                "id": absent_id,
                "rollout_path": str(codex_root / "missing-rollout-2.jsonl"),
                "created_at": 1_770_000_050_000,
                "cwd": "/synthetic/work/service",
                "title": "Absent Thread",
                "archived": 1,
            },
        ],
    )

    items = [
        {
            "thread_id": recovered_id,
            "turn_id": "turn-1",
            "item_id": "item-u-1",
            "rollout_ordinal": 1,
            "created_at_ms": 1_770_000_000_000,
            "item_type": "userMessage",
            "item_json": json.dumps(
                {
                    "type": "userMessage",
                    "id": "item-u-1",
                    "content": [{"type": "text", "text": "First recovered prompt"}],
                }
            ),
        },
        {
            "thread_id": recovered_id,
            "turn_id": "turn-2",
            "item_id": "item-u-2",
            "rollout_ordinal": 2,
            "created_at_ms": 1_770_000_010_000,
            "item_type": "userMessage",
            "item_json": json.dumps(
                {
                    "type": "userMessage",
                    "id": "item-u-2",
                    "content": [{"type": "text", "text": "Second recovered prompt"}],
                }
            ),
        },
    ]
    turns = [
        {
            "thread_id": recovered_id,
            "turn_id": "turn-1",
            "rollout_ordinal": 1,
            "started_at": 1_770_000_000,
            "completed_at": 1_770_000_010,
        }
    ]
    _create_synthetic_projection(projection_path, items=items, turns=turns)

    result = discover_history(
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )

    by_id = {session.session_id: session for session in result.sessions}
    assert recovered_id in by_id
    assert absent_id in by_id

    recovered = by_id[recovered_id]
    assert recovered.parse_status == "partial"
    assert recovered.unsupported_reason is None
    assert recovered.prompt_count == 2
    assert recovered.first_prompt_preview == "First recovered prompt"
    assert recovered.source_title == "Recovered Investigation"
    assert recovered.format_version == "thread-history-1"

    absent = by_id[absent_id]
    assert absent.parse_status == "unsupported"
    assert absent.unsupported_reason == "rollout_file_missing"
    assert absent.prompt_count == 0
    assert absent.first_prompt_preview is None
    assert absent.history_state == "archived"


def test_databases_opened_readonly_immutable_with_no_sidecars(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    projection_path = codex_root.parent / "thread_history_1.sqlite"

    thread_id = "synthetic-readonly-thread"
    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": thread_id,
                "rollout_path": str(codex_root / "missing.jsonl"),
                "cwd": "/synthetic/project",
                "title": "Readonly test",
            }
        ],
    )
    _create_synthetic_projection(
        projection_path,
        items=[
            {
                "thread_id": thread_id,
                "turn_id": "turn-1",
                "item_id": "item-1",
                "rollout_ordinal": 1,
                "created_at_ms": 1_770_000_000_000,
                "item_type": "userMessage",
                "item_json": json.dumps(
                    {
                        "type": "userMessage",
                        "id": "item-1",
                        "content": [{"type": "text", "text": "Prompt text"}],
                    }
                ),
            }
        ],
    )

    # Perform discovery and import
    discover_history(
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )
    import_history_session(
        thread_id,
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )

    # Assert no -wal or -shm sidecars exist in the parent folder
    parent_files = {p.name for p in codex_root.parent.iterdir()}
    assert "state_5.sqlite-wal" not in parent_files
    assert "state_5.sqlite-shm" not in parent_files
    assert "thread_history_1.sqlite-wal" not in parent_files
    assert "thread_history_1.sqlite-shm" not in parent_files

    # Assert read-only / immutable mode by verifying write attempts fail
    with pytest.raises(sqlite3.OperationalError):
        uri = f"{projection_path.as_uri()}?mode=ro&immutable=1"
        ro_conn = sqlite3.connect(uri, uri=True)
        try:
            ro_conn.execute("INSERT INTO _sqlx_migrations VALUES (999, 'bad', 1, X'00', 0)")
        finally:
            ro_conn.close()


def test_missing_and_corrupt_projection_degrades_gracefully(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    missing_projection = codex_root.parent / "thread_history_1.sqlite"

    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": "thread-fallback-1",
                "rollout_path": str(codex_root / "missing.jsonl"),
                "cwd": "/synthetic/project",
                "title": "Fallback Title",
            }
        ],
    )

    # Case 1: Projection database is absent on disk
    result = discover_history(
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=missing_projection,
    )
    assert result.roots[0].thread_history_status == "missing"
    assert result.sessions[0].parse_status == "unsupported"
    assert result.sessions[0].unsupported_reason == "rollout_file_missing"

    # Case 2: Projection database is corrupted/unreadable
    corrupt_projection = codex_root.parent / "corrupt_thread_history.sqlite"
    corrupt_projection.write_bytes(b"NOT_A_VALID_SQLITE_DATABASE_HEADER")

    corrupt_result = discover_history(
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=corrupt_projection,
    )
    assert corrupt_result.roots[0].thread_history_status == "unreadable"
    assert corrupt_result.sessions[0].parse_status == "unsupported"
    assert corrupt_result.sessions[0].unsupported_reason == "rollout_file_missing"


def test_thread_in_neither_source_raises_typed_error(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    projection_path = codex_root.parent / "thread_history_1.sqlite"

    _create_synthetic_catalog(catalog_path, [])
    _create_synthetic_projection(projection_path, items=[])

    with pytest.raises(BothHistorySourcesMissingError) as exc_info:
        import_history_session(
            "unknown-thread-nowhere",
            codex_root=codex_root,
            catalog_path=catalog_path,
            thread_history_path=projection_path,
        )

    assert isinstance(exc_info.value, HistorySourcesMissingError)
    assert isinstance(exc_info.value, KeyError)
    assert "unknown-thread-nowhere" in str(exc_info.value)
    assert "missing" in str(exc_info.value).lower()


def test_fixture_secrets_and_injected_context_are_redacted(tmp_path: Path) -> None:
    codex_root = tmp_path / ".codex" / "sessions"
    codex_root.mkdir(parents=True)
    catalog_path = codex_root.parent / "state_5.sqlite"
    projection_path = codex_root.parent / "thread_history_1.sqlite"

    thread_id = "thread-secret-redaction"
    secret_key = "FM_SYNTHETIC_API_KEY_ABCDEF123456"
    secret_pass = "FM_SYNTHETIC_PASSWORD_XYZ987654"
    injected_marker = "SYSTEM_INJECTED_PROMPT_PREFIX"

    raw_user_prompt = (
        f"<environment_context>{injected_marker}</environment_context>\n"
        f"Please check service with api_key={secret_key} and password={secret_pass}."
    )

    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": thread_id,
                "rollout_path": str(codex_root / "missing.jsonl"),
                "cwd": "/synthetic/project",
                "title": f"Debug task with api_key={secret_key}",
            }
        ],
    )

    items = [
        {
            "thread_id": thread_id,
            "turn_id": "turn-1",
            "item_id": "item-secret-1",
            "rollout_ordinal": 1,
            "created_at_ms": 1_770_000_000_000,
            "item_type": "userMessage",
            "item_json": json.dumps(
                {
                    "type": "userMessage",
                    "id": "item-secret-1",
                    "content": [{"type": "text", "text": raw_user_prompt}],
                }
            ),
        }
    ]
    _create_synthetic_projection(projection_path, items=items)

    # 1. Check discovery preview redactions
    result = discover_history(
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )
    session_index = next(s for s in result.sessions if s.session_id == thread_id)
    assert secret_key not in (session_index.first_prompt_preview or "")
    assert secret_pass not in (session_index.first_prompt_preview or "")
    assert injected_marker not in (session_index.first_prompt_preview or "")
    assert "[redacted: api key]" in (session_index.first_prompt_preview or "")
    assert "[redacted: password]" in (session_index.first_prompt_preview or "")
    assert session_index.injected_context_messages == 1
    assert secret_key not in (session_index.source_title or "")
    assert "[redacted: api key]" in (session_index.source_title or "")

    # 2. Check import record redactions
    exported = import_history_session(
        thread_id,
        codex_root=codex_root,
        catalog_path=catalog_path,
        thread_history_path=projection_path,
    )
    dumped_json = exported.model_dump_json()
    assert secret_key not in dumped_json
    assert secret_pass not in dumped_json
    assert injected_marker not in dumped_json
    assert exported.session.injected_context_messages == 1


def test_smoke_summary_and_cli_aggregate_counts(tmp_path: Path) -> None:
    catalog_path = tmp_path / "state_5.sqlite"
    projection_path = tmp_path / "thread_history_1.sqlite"

    _create_synthetic_catalog(
        catalog_path,
        [
            {
                "id": "thread-1",
                "rollout_path": str(tmp_path / "missing-1.jsonl"),
            },
            {
                "id": "thread-2",
                "rollout_path": str(tmp_path / "missing-2.jsonl"),
            },
        ],
    )
    _create_synthetic_projection(
        projection_path,
        items=[
            {
                "thread_id": "thread-1",
                "turn_id": "turn-1",
                "item_id": "item-1",
                "rollout_ordinal": 1,
                "created_at_ms": 1_770_000_000_000,
                "item_type": "userMessage",
                "item_json": json.dumps(
                    {
                        "type": "userMessage",
                        "id": "item-1",
                        "content": [{"type": "text", "text": "Prompt"}],
                    }
                ),
            }
        ],
    )

    summary = thread_history_smoke_summary(projection_path, catalog_path=catalog_path)
    assert summary.threads == 1
    assert summary.catalog_threads == 2
    assert summary.projection_threads == 1
    assert summary.overlap_threads == 1
    assert summary.missing_rollout_catalog_threads == 2
    assert summary.recovered_missing_rollout_threads == 1

    # CLI command invocation
    cli_result = CliRunner().invoke(
        app,
        [
            "replay-thread-history-smoke",
            str(projection_path),
            "--catalog",
            str(catalog_path),
        ],
    )
    assert cli_result.exit_code == 0, cli_result.output
    output_dict: Mapping[str, object] = json.loads(cli_result.output)
    assert output_dict["catalog_threads"] == 2
    assert output_dict["projection_threads"] == 1
    assert output_dict["overlap_threads"] == 1
    assert output_dict["missing_rollout_catalog_threads"] == 2
    assert output_dict["recovered_missing_rollout_threads"] == 1
    assert str(tmp_path) not in cli_result.output
