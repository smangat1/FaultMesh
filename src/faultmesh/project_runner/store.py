"""Durable append-only store for project runs and exact test cases."""

from __future__ import annotations

import builtins
import sqlite3
from pathlib import Path

from faultmesh.project_runner.models import ProjectTestRun, TestCaseRecord

RUN_STORE_SCHEMA_VERSION = 2


class RunStoreError(RuntimeError):
    pass


class RunStore:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        try:
            self.connection.execute("PRAGMA foreign_keys = ON")
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
                    "CREATE TABLE test_cases ("
                    "run_id TEXT NOT NULL REFERENCES runs(id), "
                    "node_id TEXT NOT NULL, record_json TEXT NOT NULL, "
                    "PRIMARY KEY (run_id, node_id))"
                )
                self.connection.execute(
                    "INSERT INTO schema_metadata VALUES (?)", (RUN_STORE_SCHEMA_VERSION,)
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise
            return
        if tables != {"schema_metadata", "runs", "test_cases"}:
            raise RunStoreError(
                "run store schema is unsupported; choose a fresh V2 artifact_root"
            )
        row = self.connection.execute("SELECT version FROM schema_metadata").fetchone()
        if row is None or row["version"] != RUN_STORE_SCHEMA_VERSION:
            raise RunStoreError(
                "run store version is unsupported; choose a fresh V2 artifact_root"
            )

    def add(
        self, run: ProjectTestRun, test_cases: list[TestCaseRecord] | None = None
    ) -> None:
        cases = test_cases or []
        if run.test_case_count != len(cases):
            raise RunStoreError("run test_case_count does not match supplied test cases")
        node_ids = [case.node_id for case in cases]
        if len(node_ids) != len(set(node_ids)):
            raise RunStoreError("test case node IDs must be unique within a run")
        if any(case.run_id != run.id for case in cases):
            raise RunStoreError("test case belongs to a different run")
        try:
            with self.connection:
                self.connection.execute(
                    "INSERT INTO runs VALUES (?, ?, ?)",
                    (run.id, run.started_at.isoformat(), run.model_dump_json()),
                )
                self.connection.executemany(
                    "INSERT INTO test_cases VALUES (?, ?, ?)",
                    [
                        (case.run_id, case.node_id, case.model_dump_json())
                        for case in cases
                    ],
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

    def get_test(self, run_id: str, node_id: str) -> TestCaseRecord:
        row = self.connection.execute(
            "SELECT record_json FROM test_cases WHERE run_id = ? AND node_id = ?",
            (run_id, node_id),
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown test case: {run_id}/{node_id}")
        return TestCaseRecord.model_validate_json(row["record_json"])

    def list_tests(self, run_id: str) -> builtins.list[TestCaseRecord]:
        if self.connection.execute(
            "SELECT 1 FROM runs WHERE id = ?", (run_id,)
        ).fetchone() is None:
            raise KeyError(f"unknown test run: {run_id}")
        rows = self.connection.execute(
            "SELECT record_json FROM test_cases WHERE run_id = ? ORDER BY node_id",
            (run_id,),
        ).fetchall()
        return [TestCaseRecord.model_validate_json(row["record_json"]) for row in rows]
