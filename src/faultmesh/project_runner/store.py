"""Durable append-only store for V1 project test runs."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from faultmesh.project_runner.models import ProjectTestRun

RUN_STORE_SCHEMA_VERSION = 1


class RunStoreError(RuntimeError):
    pass


class RunStore:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        try:
            self._open_schema()
        except Exception:
            self.connection.close()
            raise

    def __enter__(self) -> RunStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def _open_schema(self) -> None:
        tables = {
            str(row["name"])
            for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if not tables:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                self.connection.execute(
                    "CREATE TABLE schema_metadata (version INTEGER NOT NULL)"
                )
                self.connection.execute(
                    "CREATE TABLE runs ("
                    "id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record_json TEXT NOT NULL)"
                )
                self.connection.execute(
                    "INSERT INTO schema_metadata VALUES (?)", (RUN_STORE_SCHEMA_VERSION,)
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise
            return
        if tables != {"schema_metadata", "runs"}:
            raise RunStoreError("run store schema is unknown; choose a fresh artifact_root")
        row = self.connection.execute("SELECT version FROM schema_metadata").fetchone()
        if row is None or row["version"] != RUN_STORE_SCHEMA_VERSION:
            raise RunStoreError("run store version is unsupported; choose a fresh artifact_root")

    def add(self, run: ProjectTestRun) -> None:
        try:
            with self.connection:
                self.connection.execute(
                    "INSERT INTO runs VALUES (?, ?, ?)",
                    (run.id, run.started_at.isoformat(), run.model_dump_json()),
                )
        except sqlite3.IntegrityError as exc:
            raise RunStoreError(f"run already exists: {run.id}") from exc

    def get(self, run_id: str) -> ProjectTestRun:
        row = self.connection.execute(
            "SELECT record_json FROM runs WHERE id = ?", (run_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown test run: {run_id}")
        return ProjectTestRun.model_validate_json(row["record_json"])

    def list(self) -> list[ProjectTestRun]:
        rows = self.connection.execute(
            "SELECT record_json FROM runs ORDER BY created_at, id"
        ).fetchall()
        return [ProjectTestRun.model_validate_json(row["record_json"]) for row in rows]
