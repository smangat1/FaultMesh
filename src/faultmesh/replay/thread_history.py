"""Read-only access to Codex's projected thread-history SQLite database."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Literal, cast

from faultmesh.replay.history_context import strip_injected_context

_REQUIRED_ITEM_COLUMNS = frozenset(
    {"thread_id", "turn_id", "item_id", "rollout_ordinal", "item_json"}
)
_OPTIONAL_ITEM_COLUMNS = frozenset(
    {
        "item_type",
        "updated_at_ordinal",
        "created_at_ms",
        "started_at_ms",
        "completed_at_ms",
    }
)
_TURN_COLUMNS = frozenset(
    {
        "thread_id",
        "turn_id",
        "rollout_ordinal",
        "status",
        "error_json",
        "started_at",
        "completed_at",
        "duration_ms",
        "first_user_item_id",
        "final_agent_item_id",
        "rollout_byte_offset",
        "rollout_end_ordinal",
        "rollout_end_byte_offset",
        "root_turn_id",
    }
)
_REQUIRED_TURN_COLUMNS = frozenset({"thread_id", "turn_id", "rollout_ordinal"})
_REALTIME_COLUMNS = frozenset(
    {"thread_id", "item_id", "rollout_ordinal", "created_at_ms", "item_type", "item_json"}
)
_PROBED_TABLES = (
    "thread_items",
    "thread_turns",
    "thread_realtime_items",
    "thread_history_projection_state",
    "_sqlx_migrations",
)


class ThreadHistoryError(RuntimeError):
    """Base class for projected thread-history reader errors."""


class ThreadHistoryOpenError(ThreadHistoryError):
    """The requested database could not be opened and read immutably."""


class ThreadHistorySchemaError(ThreadHistoryError):
    """The database lacks the minimum schema needed for item iteration."""


class ThreadHistoryDataError(ThreadHistoryError):
    """A required row value has an unusable type."""


ItemJsonError = Literal["not_text", "invalid_json", "non_object"]


@dataclass(frozen=True)
class ThreadHistorySchema:
    """Capability report produced without assuming a specific migration level."""

    tables: frozenset[str]
    table_columns: Mapping[str, frozenset[str]]
    missing_required: tuple[str, ...]
    missing_optional: tuple[str, ...]
    migration_versions: tuple[int, ...]
    warnings: tuple[str, ...]

    @property
    def items_available(self) -> bool:
        return not self.missing_required

    @property
    def turns_available(self) -> bool:
        columns = self.table_columns.get("thread_turns", frozenset())
        return "thread_turns" in self.tables and columns >= _REQUIRED_TURN_COLUMNS

    @property
    def realtime_items_available(self) -> bool:
        columns = self.table_columns.get("thread_realtime_items", frozenset())
        return "thread_realtime_items" in self.tables and columns >= _REALTIME_COLUMNS

    @property
    def latest_migration_version(self) -> int | None:
        return self.migration_versions[-1] if self.migration_versions else None

    def columns_for(self, table: str) -> frozenset[str]:
        return self.table_columns.get(table, frozenset())


@dataclass(frozen=True)
class ThreadHistoryItem:
    """Latest observed snapshot of one projected history item."""

    thread_id: str
    turn_id: str | None
    item_id: str
    rollout_ordinal: int
    item_json: dict[str, object] | None
    item_json_error: ItemJsonError | None
    item_type: str | None
    updated_at_ordinal: int | None
    created_at_ms: int | None
    started_at_ms: int | None
    completed_at_ms: int | None


@dataclass(frozen=True)
class ThreadHistoryTurn:
    """Projected turn metadata when the optional turn table is usable."""

    thread_id: str
    turn_id: str
    rollout_ordinal: int
    status: str | None
    error_json: str | None
    started_at: int | None
    completed_at: int | None
    duration_ms: int | None
    first_user_item_id: str | None
    final_agent_item_id: str | None
    rollout_byte_offset: int | None
    rollout_end_ordinal: int | None
    rollout_end_byte_offset: int | None
    root_turn_id: str | None


@dataclass(frozen=True)
class ThreadHistoryTurnGap:
    """A recorded turn for which the projection contains no item rows."""

    thread_id: str
    turn_id: str
    rollout_ordinal: int


@dataclass(frozen=True)
class ThreadHistoryThreadFacts:
    """Bounded discovery facts for one thread, derived through indexed lookups."""

    thread_id: str
    item_count: int
    turn_count: int
    user_message_count: int
    first_user_message: str | None
    injected_context_messages: int
    created_at_ms_min: int | None
    created_at_ms_max: int | None

    @property
    def exists(self) -> bool:
        return self.item_count > 0 or self.turn_count > 0


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _required_str(value: object, field: str) -> str:
    if isinstance(value, str) and value:
        return value
    raise ThreadHistoryDataError(f"thread history row has invalid {field}")


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _required_int(value: object, field: str) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        raise ThreadHistoryDataError(f"thread history row has invalid {field}")
    return parsed


def _decode_item_json(value: object) -> tuple[dict[str, object] | None, ItemJsonError | None]:
    if not isinstance(value, str):
        return None, "not_text"
    try:
        decoded = cast(object, json.loads(value))
    except json.JSONDecodeError:
        return None, "invalid_json"
    if not isinstance(decoded, dict):
        return None, "non_object"
    return cast(dict[str, object], decoded), None


def _selected_column(columns: frozenset[str], name: str) -> str:
    return f'"{name}"' if name in columns else f'NULL AS "{name}"'


def thread_history_item_text(payload: dict[str, object]) -> str | None:
    """Join projected text content without applying presentation or redaction policy."""
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


class ThreadHistoryReader:
    """Immutable SQLite reader for one caller-supplied thread-history path."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path).expanduser().resolve()
        self._connection: sqlite3.Connection | None = None
        try:
            uri = f"file:{self.path}?mode=ro&immutable=1"
            connection = sqlite3.connect(uri, uri=True)
            connection.row_factory = sqlite3.Row
            self._connection = connection
            self.schema = self._probe_schema(connection)
        except (OSError, sqlite3.Error) as error:
            self.close()
            raise ThreadHistoryOpenError(
                "thread history database could not be read immutably"
            ) from error

    def __enter__(self) -> ThreadHistoryReader:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def _connection_or_raise(self) -> sqlite3.Connection:
        if self._connection is None:
            raise ThreadHistoryOpenError("thread history reader is closed")
        return self._connection

    @staticmethod
    def _probe_schema(connection: sqlite3.Connection) -> ThreadHistorySchema:
        table_rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        tables = frozenset(
            value
            for row in table_rows
            for value in [row["name"]]
            if isinstance(value, str)
        )
        mutable_columns: dict[str, frozenset[str]] = {}
        for table in _PROBED_TABLES:
            if table not in tables:
                continue
            rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
            mutable_columns[table] = frozenset(
                value
                for row in rows
                for value in [row["name"]]
                if isinstance(value, str)
            )

        item_columns = mutable_columns.get("thread_items", frozenset())
        missing_required: tuple[str, ...]
        if "thread_items" not in tables:
            missing_required = ("thread_items",)
        else:
            missing_required = tuple(
                f"thread_items.{name}" for name in sorted(_REQUIRED_ITEM_COLUMNS - item_columns)
            )

        missing_optional: list[str] = [
            f"thread_items.{name}" for name in sorted(_OPTIONAL_ITEM_COLUMNS - item_columns)
        ]
        for table, expected in (
            ("thread_turns", _TURN_COLUMNS),
            ("thread_realtime_items", _REALTIME_COLUMNS),
        ):
            if table not in tables:
                missing_optional.append(table)
                continue
            actual = mutable_columns.get(table, frozenset())
            missing_optional.extend(f"{table}.{name}" for name in sorted(expected - actual))
        if "thread_history_projection_state" not in tables:
            missing_optional.append("thread_history_projection_state")

        warnings: list[str] = []
        migration_versions: tuple[int, ...] = ()
        migration_columns = mutable_columns.get("_sqlx_migrations", frozenset())
        if "_sqlx_migrations" not in tables:
            missing_optional.append("_sqlx_migrations")
        elif "version" not in migration_columns:
            missing_optional.append("_sqlx_migrations.version")
        else:
            version_rows = connection.execute(
                'SELECT "version" FROM "_sqlx_migrations" ORDER BY "version"'
            ).fetchall()
            parsed_versions = tuple(
                value
                for row in version_rows
                for value in [_optional_int(row["version"])]
                if value is not None
            )
            migration_versions = parsed_versions
            if len(parsed_versions) != len(version_rows):
                warnings.append("_sqlx_migrations contains a non-integer version")

        return ThreadHistorySchema(
            tables=tables,
            table_columns=MappingProxyType(mutable_columns),
            missing_required=missing_required,
            missing_optional=tuple(sorted(missing_optional)),
            migration_versions=migration_versions,
            warnings=tuple(warnings),
        )

    def _require_items(self) -> None:
        if self.schema.items_available:
            return
        missing = ", ".join(self.schema.missing_required)
        raise ThreadHistorySchemaError(
            f"thread history schema is missing required fields: {missing}"
        )

    def iter_items(self, *, thread_id: str | None = None) -> Iterator[ThreadHistoryItem]:
        """Yield the latest snapshot per item, ordered by thread and rollout ordinal."""
        self._require_items()
        connection = self._connection_or_raise()
        columns = self.schema.columns_for("thread_items")
        selected_optional = [
            _selected_column(columns, name)
            for name in (
                "item_type",
                "updated_at_ordinal",
                "created_at_ms",
                "started_at_ms",
                "completed_at_ms",
            )
        ]
        effective_ordinal = (
            'COALESCE("updated_at_ordinal", "rollout_ordinal")'
            if "updated_at_ordinal" in columns
            else '"rollout_ordinal"'
        )
        where = 'WHERE "thread_id" = ?' if thread_id is not None else ""
        parameters: tuple[object, ...] = (thread_id,) if thread_id is not None else ()
        query = f"""
            WITH snapshots AS (
                SELECT
                    "thread_id", "turn_id", "item_id", "rollout_ordinal", "item_json",
                    {", ".join(selected_optional)},
                    ROW_NUMBER() OVER (
                        PARTITION BY "thread_id", "item_id"
                        ORDER BY {effective_ordinal} DESC, "rollout_ordinal" DESC
                    ) AS snapshot_rank
                FROM "thread_items"
                {where}
            )
            SELECT * FROM snapshots
            WHERE snapshot_rank = 1
            ORDER BY "thread_id", "rollout_ordinal", "item_id"
        """
        try:
            rows = connection.execute(query, parameters)
            for row in rows:
                decoded, decode_error = _decode_item_json(row["item_json"])
                column_type = _optional_str(row["item_type"])
                payload_type = _optional_str(decoded.get("type")) if decoded is not None else None
                yield ThreadHistoryItem(
                    thread_id=_required_str(row["thread_id"], "thread_id"),
                    turn_id=_optional_str(row["turn_id"]),
                    item_id=_required_str(row["item_id"], "item_id"),
                    rollout_ordinal=_required_int(row["rollout_ordinal"], "rollout_ordinal"),
                    item_json=decoded,
                    item_json_error=decode_error,
                    item_type=column_type or payload_type,
                    updated_at_ordinal=_optional_int(row["updated_at_ordinal"]),
                    created_at_ms=_optional_int(row["created_at_ms"]),
                    started_at_ms=_optional_int(row["started_at_ms"]),
                    completed_at_ms=_optional_int(row["completed_at_ms"]),
                )
        except sqlite3.Error as error:
            raise ThreadHistoryOpenError("thread history items could not be read") from error

    def iter_turns(self, *, thread_id: str | None = None) -> Iterator[ThreadHistoryTurn]:
        """Yield optional turn metadata, or no rows when the capability is unavailable."""
        if not self.schema.turns_available:
            return
        connection = self._connection_or_raise()
        columns = self.schema.columns_for("thread_turns")
        optional_names = (
            "status",
            "error_json",
            "started_at",
            "completed_at",
            "duration_ms",
            "first_user_item_id",
            "final_agent_item_id",
            "rollout_byte_offset",
            "rollout_end_ordinal",
            "rollout_end_byte_offset",
            "root_turn_id",
        )
        selected_optional = [_selected_column(columns, name) for name in optional_names]
        where = 'WHERE "thread_id" = ?' if thread_id is not None else ""
        parameters: tuple[object, ...] = (thread_id,) if thread_id is not None else ()
        query = f"""
            SELECT "thread_id", "turn_id", "rollout_ordinal",
                   {", ".join(selected_optional)}
            FROM "thread_turns"
            {where}
            ORDER BY "thread_id", "rollout_ordinal", "turn_id"
        """
        try:
            rows = connection.execute(query, parameters)
            for row in rows:
                yield ThreadHistoryTurn(
                    thread_id=_required_str(row["thread_id"], "thread_id"),
                    turn_id=_required_str(row["turn_id"], "turn_id"),
                    rollout_ordinal=_required_int(row["rollout_ordinal"], "rollout_ordinal"),
                    status=_optional_str(row["status"]),
                    error_json=_optional_str(row["error_json"]),
                    started_at=_optional_int(row["started_at"]),
                    completed_at=_optional_int(row["completed_at"]),
                    duration_ms=_optional_int(row["duration_ms"]),
                    first_user_item_id=_optional_str(row["first_user_item_id"]),
                    final_agent_item_id=_optional_str(row["final_agent_item_id"]),
                    rollout_byte_offset=_optional_int(row["rollout_byte_offset"]),
                    rollout_end_ordinal=_optional_int(row["rollout_end_ordinal"]),
                    rollout_end_byte_offset=_optional_int(row["rollout_end_byte_offset"]),
                    root_turn_id=_optional_str(row["root_turn_id"]),
                )
        except sqlite3.Error as error:
            raise ThreadHistoryOpenError("thread history turns could not be read") from error

    def iter_turn_gaps(self) -> Iterator[ThreadHistoryTurnGap]:
        """Yield recorded turns that have no projected items without failing other threads."""
        if not self.schema.turns_available or not self.schema.items_available:
            return
        covered_turns = {
            (item.thread_id, item.turn_id)
            for item in self.iter_items()
            if item.turn_id is not None
        }
        for turn in self.iter_turns():
            if (turn.thread_id, turn.turn_id) not in covered_turns:
                yield ThreadHistoryTurnGap(
                    thread_id=turn.thread_id,
                    turn_id=turn.turn_id,
                    rollout_ordinal=turn.rollout_ordinal,
                )

    def thread_facts(self, thread_id: str) -> ThreadHistoryThreadFacts:
        """Summarize one thread without mapping or retaining non-prompt item content."""
        items = list(self.iter_items(thread_id=thread_id))
        turns = list(self.iter_turns(thread_id=thread_id))
        user_message_count = 0
        first_user_message: str | None = None
        injected_context_messages = 0
        timestamp_values: list[int] = []
        for item in items:
            timestamp_values.extend(
                value
                for value in (item.created_at_ms, item.started_at_ms, item.completed_at_ms)
                if value is not None
            )
            if item.item_type != "userMessage":
                continue
            user_message_count += 1
            if item.item_json is None:
                continue
            raw_text = thread_history_item_text(item.item_json)
            if raw_text is None:
                continue
            prompt, injected = strip_injected_context(raw_text)
            injected_context_messages += injected
            if first_user_message is None and prompt is not None:
                first_user_message = prompt
        for turn in turns:
            for value in (turn.started_at, turn.completed_at):
                if value is not None:
                    ms = value if value > 10_000_000_000 else value * 1000
                    timestamp_values.append(ms)
        return ThreadHistoryThreadFacts(
            thread_id=thread_id,
            item_count=len(items),
            turn_count=len(turns),
            user_message_count=user_message_count,
            first_user_message=first_user_message,
            injected_context_messages=injected_context_messages,
            created_at_ms_min=min(timestamp_values) if timestamp_values else None,
            created_at_ms_max=max(timestamp_values) if timestamp_values else None,
        )

    def has_thread(self, thread_id: str) -> bool:
        """Return True if thread_id has projected items or turns."""
        return self.thread_facts(thread_id).exists
