from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from faultmesh.replay import thread_history
from faultmesh.replay.thread_history import (
    ThreadHistoryOpenError,
    ThreadHistoryReader,
    ThreadHistorySchemaError,
)

MAPPED_ITEM_TYPES = {
    "agentMessage",
    "collabAgentToolCall",
    "commandExecution",
    "contextCompaction",
    "dynamicToolCall",
    "fileChange",
    "imageGeneration",
    "imageView",
    "mcpToolCall",
    "plan",
    "reasoning",
    "sleep",
    "subAgentActivity",
    "userMessage",
    "webSearch",
}


def _payloads() -> dict[str, dict[str, object]]:
    return {
        "userMessage": {
            "type": "userMessage",
            "id": "prompt-item",
            "content": [{"type": "text", "text": "Synthetic prompt"}],
        },
        "commandExecution": {
            "type": "commandExecution",
            "id": "command-item",
            "command": "synthetic-command --check",
            "aggregatedOutput": "Synthetic command output",
            "commandActions": [{"type": "read", "path": "synthetic.txt"}],
            "status": "completed",
            "exitCode": 0,
            "durationMs": 3,
            "cwd": "/synthetic/project",
        },
        "fileChange": {
            "type": "fileChange",
            "id": "file-item",
            "changes": [
                {
                    "path": "synthetic.py",
                    "kind": {"type": "update", "move_path": None},
                    "diff": "synthetic diff",
                }
            ],
            "status": "completed",
        },
        "mcpToolCall": {
            "type": "mcpToolCall",
            "id": "mcp-item",
            "server": "synthetic-server",
            "tool": "synthetic-tool",
            "arguments": {"query": "fabricated"},
            "result": {"content": [], "structuredContent": {"ok": True}, "_meta": {}},
            "status": "completed",
        },
        "dynamicToolCall": {
            "type": "dynamicToolCall",
            "id": "dynamic-item",
            "namespace": "synthetic",
            "tool": "lookup",
            "arguments": {"query": "fabricated"},
            "contentItems": [{"type": "text", "text": "Synthetic result"}],
            "status": "completed",
            "success": True,
        },
        "agentMessage": {
            "type": "agentMessage",
            "id": "answer-item",
            "phase": "synthetic-terminal",
            "text": "Synthetic answer",
        },
        "reasoning": {
            "type": "reasoning",
            "id": "reasoning-item",
            "summary": "Synthetic summary",
            "content": "Synthetic private reasoning placeholder",
        },
        "collabAgentToolCall": {
            "type": "collabAgentToolCall",
            "id": "collab-item",
            "tool": "spawn_agent",
            "status": "completed",
            "agentsStates": {},
            "receiverThreadIds": [],
        },
        "webSearch": {
            "type": "webSearch",
            "id": "search-item",
            "query": "fabricated query",
            "results": [],
        },
        "imageView": {"type": "imageView", "id": "view-item", "path": "synthetic.png"},
        "imageGeneration": {
            "type": "imageGeneration",
            "id": "generation-item",
            "status": "completed",
            "result": "synthetic result",
        },
        "subAgentActivity": {
            "type": "subAgentActivity",
            "id": "activity-item",
            "kind": "synthetic",
            "agentThreadId": "synthetic-agent",
            "agentPath": "synthetic-agent-path",
        },
        "plan": {"type": "plan", "id": "plan-item", "text": "Synthetic initial plan"},
        "contextCompaction": {"type": "contextCompaction", "id": "compaction-item"},
        "sleep": {"type": "sleep", "id": "sleep-item", "durationMs": 1},
        "syntheticUnknown": {
            "type": "syntheticUnknown",
            "id": "unknown-item",
            "opaque": "Synthetic ignored content",
        },
    }


def _create_full_database(path: Path) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            """
            CREATE TABLE thread_items (
                thread_id TEXT,
                turn_id TEXT,
                item_id TEXT,
                rollout_ordinal INTEGER,
                created_at_ms INTEGER,
                item_json TEXT,
                item_type TEXT,
                updated_at_ordinal INTEGER,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
            );
            CREATE TABLE thread_turns (
                thread_id TEXT,
                turn_id TEXT,
                rollout_ordinal INTEGER,
                status TEXT,
                error_json TEXT,
                started_at INTEGER,
                completed_at INTEGER,
                duration_ms INTEGER,
                first_user_item_id TEXT,
                final_agent_item_id TEXT,
                rollout_byte_offset INTEGER,
                rollout_end_ordinal INTEGER,
                rollout_end_byte_offset INTEGER,
                root_turn_id TEXT
            );
            CREATE TABLE thread_realtime_items (
                thread_id TEXT,
                item_id TEXT,
                rollout_ordinal INTEGER,
                created_at_ms INTEGER,
                item_type TEXT,
                item_json TEXT,
                PRIMARY KEY(thread_id, item_id)
            );
            CREATE TABLE thread_history_projection_state (
                thread_id TEXT PRIMARY KEY,
                next_rollout_byte_offset INTEGER,
                next_rollout_ordinal INTEGER
            );
            CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT,
                success BOOLEAN
            );
            """
        )
        connection.executemany(
            "INSERT INTO _sqlx_migrations VALUES (?, ?, ?)",
            [(1, "synthetic-one", True), (8, "synthetic-eight", True)],
        )
        connection.executemany(
            "INSERT INTO thread_turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    "thread-complete",
                    "turn-complete",
                    1,
                    "completed",
                    None,
                    1_000,
                    2_000,
                    1_000,
                    "prompt-item",
                    "answer-item",
                    0,
                    100,
                    500,
                    "turn-complete",
                ),
                (
                    "thread-partial",
                    "turn-without-items",
                    2,
                    "completed",
                    None,
                    2_000,
                    3_000,
                    1_000,
                    None,
                    None,
                    500,
                    101,
                    600,
                    "turn-without-items",
                ),
            ],
        )
        rows: list[tuple[object, ...]] = []
        for ordinal, (item_type, payload) in enumerate(_payloads().items(), start=1):
            rows.append(
                (
                    "thread-complete",
                    "turn-complete",
                    str(payload["id"]),
                    ordinal,
                    1_700_000_000_000 + ordinal,
                    json.dumps(payload),
                    item_type,
                    ordinal,
                    None,
                    None,
                )
            )
        first_plan = next(row for row in rows if row[6] == "plan")
        latest_plan = dict(_payloads()["plan"], text="Synthetic latest plan")
        rows.append(
            (
                first_plan[0],
                first_plan[1],
                first_plan[2],
                first_plan[3],
                first_plan[4],
                json.dumps(latest_plan),
                first_plan[6],
                100,
                first_plan[8],
                first_plan[9],
            )
        )
        connection.executemany(
            "INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows
        )
        connection.commit()


def _create_minimal_database(path: Path) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.execute(
            "CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, "
            "rollout_ordinal INTEGER, item_json TEXT)"
        )
        connection.execute(
            "INSERT INTO thread_items VALUES (?, ?, ?, ?, ?)",
            (
                "minimal-thread",
                "minimal-turn",
                "minimal-item",
                7,
                json.dumps(
                    {
                        "type": "userMessage",
                        "id": "minimal-item",
                        "content": [{"type": "text", "text": "Synthetic minimal prompt"}],
                    }
                ),
            ),
        )
        connection.commit()


@pytest.fixture
def full_database(tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "thread-history.sqlite"
    _create_full_database(path)
    yield path


def test_schema_probe_reports_capabilities_and_migration_ledger(full_database: Path) -> None:
    with ThreadHistoryReader(full_database) as reader:
        schema = reader.schema

    assert schema.items_available is True
    assert schema.turns_available is True
    assert schema.realtime_items_available is True
    assert schema.missing_required == ()
    assert schema.migration_versions == (1, 8)
    assert schema.latest_migration_version == 8
    assert "created_at_ms" in schema.columns_for("thread_items")


def test_reader_is_immutable_and_does_not_create_sidecars(full_database: Path) -> None:
    before = {entry.name: entry.stat().st_mtime_ns for entry in full_database.parent.iterdir()}

    with ThreadHistoryReader(full_database) as reader:
        assert len(list(reader.iter_items())) == len(_payloads())

    after = {entry.name: entry.stat().st_mtime_ns for entry in full_database.parent.iterdir()}
    assert after == before
    assert not full_database.with_name(f"{full_database.name}-wal").exists()
    assert not full_database.with_name(f"{full_database.name}-shm").exists()


def test_latest_snapshots_are_kept_and_rows_are_ordered(full_database: Path) -> None:
    with ThreadHistoryReader(full_database) as reader:
        items = list(reader.iter_items())

    assert [(item.thread_id, item.rollout_ordinal) for item in items] == sorted(
        (item.thread_id, item.rollout_ordinal) for item in items
    )
    assert {item.item_type for item in items} == MAPPED_ITEM_TYPES | {"syntheticUnknown"}
    assert len(items) == len(_payloads())
    plan = next(item for item in items if item.item_type == "plan")
    assert plan.updated_at_ordinal == 100
    assert plan.item_json is not None
    assert plan.item_json["text"] == "Synthetic latest plan"


def test_thread_filter_turn_iteration_and_partial_turn_detection(full_database: Path) -> None:
    with ThreadHistoryReader(full_database) as reader:
        filtered = list(reader.iter_items(thread_id="thread-complete"))
        turns = list(reader.iter_turns())
        gaps = list(reader.iter_turn_gaps())

    assert len(filtered) == len(_payloads())
    assert [turn.thread_id for turn in turns] == ["thread-complete", "thread-partial"]
    assert [(gap.thread_id, gap.turn_id, gap.rollout_ordinal) for gap in gaps] == [
        ("thread-partial", "turn-without-items", 2)
    ]


def test_missing_optional_schema_degrades_and_derives_item_type(tmp_path: Path) -> None:
    path = tmp_path / "minimal.sqlite"
    _create_minimal_database(path)

    with ThreadHistoryReader(path) as reader:
        items = list(reader.iter_items())
        assert list(reader.iter_turns()) == []
        assert list(reader.iter_turn_gaps()) == []
        schema = reader.schema

    assert len(items) == 1
    assert items[0].item_type == "userMessage"
    assert items[0].created_at_ms is None
    assert items[0].started_at_ms is None
    assert schema.items_available is True
    assert schema.turns_available is False
    assert schema.realtime_items_available is False
    assert "thread_items.created_at_ms" in schema.missing_optional
    assert "thread_realtime_items" in schema.missing_optional


def test_unexpected_schema_is_reported_before_iteration(tmp_path: Path) -> None:
    path = tmp_path / "unexpected.sqlite"
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("CREATE TABLE thread_items (thread_id TEXT, item_id TEXT)")
        connection.commit()

    with ThreadHistoryReader(path) as reader:
        assert reader.schema.items_available is False
        assert reader.schema.missing_required == (
            "thread_items.item_json",
            "thread_items.rollout_ordinal",
            "thread_items.turn_id",
        )
        with pytest.raises(ThreadHistorySchemaError, match="missing required fields"):
            list(reader.iter_items())


def test_missing_and_invalid_databases_raise_typed_open_errors(tmp_path: Path) -> None:
    with pytest.raises(ThreadHistoryOpenError, match="read immutably"):
        ThreadHistoryReader(tmp_path / "missing.sqlite")

    invalid = tmp_path / "invalid.sqlite"
    invalid.write_text("synthetic non-database", encoding="utf-8")
    with pytest.raises(ThreadHistoryOpenError, match="read immutably"):
        ThreadHistoryReader(invalid)


def test_locked_open_failure_is_wrapped_as_typed_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def locked_connect(*_args: object, **_kwargs: object) -> sqlite3.Connection:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(thread_history.sqlite3, "connect", locked_connect)

    with pytest.raises(ThreadHistoryOpenError, match="read immutably"):
        ThreadHistoryReader(tmp_path / "locked.sqlite")
