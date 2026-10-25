"""SQLite-backed typed evidence graph and guarded state machine."""

from __future__ import annotations

import json
import sqlite3
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from faultmesh.schemas import (
    ExperimentResult,
    HypothesisRecord,
    HypothesisRevision,
    Incident,
    InferenceMetadata,
    ProjectIndex,
    VerificationStatus,
)


class InvalidStatusTransition(ValueError):
    pass


ALLOWED_TRANSITIONS: dict[VerificationStatus, set[VerificationStatus]] = {
    VerificationStatus.PROPOSED: {
        VerificationStatus.TESTABLE,
        VerificationStatus.REJECTED,
        VerificationStatus.UNSUPPORTED,
    },
    VerificationStatus.TESTABLE: {
        VerificationStatus.TESTED,
        VerificationStatus.INCONCLUSIVE,
        VerificationStatus.REJECTED,
        VerificationStatus.UNSUPPORTED,
    },
    VerificationStatus.TESTED: {
        VerificationStatus.REPRODUCED,
        VerificationStatus.INCONCLUSIVE,
        VerificationStatus.FLAKY,
        VerificationStatus.REJECTED,
    },
    VerificationStatus.REPRODUCED: {
        VerificationStatus.VERIFIED,
        VerificationStatus.FLAKY,
        VerificationStatus.INCONCLUSIVE,
    },
    VerificationStatus.VERIFIED: set(),
    VerificationStatus.REJECTED: set(),
    VerificationStatus.INCONCLUSIVE: set(),
    VerificationStatus.FLAKY: set(),
    VerificationStatus.UNSUPPORTED: set(),
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


class EvidenceStore:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    def __enter__(self) -> EvidenceStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def _migrate(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS investigations (
                id TEXT PRIMARY KEY,
                repository TEXT NOT NULL,
                focus TEXT,
                created_at TEXT NOT NULL,
                project_index_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                investigation_id TEXT NOT NULL REFERENCES investigations(id),
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                qualified_name TEXT,
                payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS entities_investigation
                ON entities(investigation_id, kind);
            CREATE TABLE IF NOT EXISTS hypotheses (
                id TEXT PRIMARY KEY,
                investigation_id TEXT NOT NULL REFERENCES investigations(id),
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS revisions (
                hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
                revision INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                PRIMARY KEY (hypothesis_id, revision)
            );
            CREATE TABLE IF NOT EXISTS experiments (
                id TEXT PRIMARY KEY,
                hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
                outcome TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                investigation_id TEXT NOT NULL REFERENCES investigations(id),
                hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS inference_calls (
                id TEXT PRIMARY KEY,
                investigation_id TEXT NOT NULL REFERENCES investigations(id),
                function_name TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS edges (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (source_id, target_id, relation)
            );
            """
        )
        self.connection.commit()

    def create_investigation(
        self, project_index: ProjectIndex, *, focus: str | None = None
    ) -> str:
        investigation_id = f"inv-{uuid4().hex[:12]}"
        with self.connection:
            self.connection.execute(
                "INSERT INTO investigations VALUES (?, ?, ?, ?, ?)",
                (
                    investigation_id,
                    project_index.root,
                    focus,
                    _now(),
                    project_index.model_dump_json(),
                ),
            )
            for module in project_index.modules:
                module_id = f"src:{module.path}"
                self.connection.execute(
                    "INSERT OR REPLACE INTO entities VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        module_id,
                        investigation_id,
                        "module",
                        module.path,
                        None,
                        module.model_dump_json(),
                    ),
                )
                for function in module.functions:
                    function_id = f"fn:{module.path}:{function.qualified_name}"
                    self.connection.execute(
                        "INSERT OR REPLACE INTO entities VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            function_id,
                            investigation_id,
                            "function",
                            module.path,
                            function.qualified_name,
                            function.model_dump_json(),
                        ),
                    )
                    self.add_edge(module_id, function_id, "DEFINES", commit=False)
            for document in project_index.documentation:
                self.connection.execute(
                    "INSERT OR REPLACE INTO entities VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        f"doc:{document.path}",
                        investigation_id,
                        "documentation",
                        document.path,
                        None,
                        document.model_dump_json(),
                    ),
                )
        return investigation_id

    def add_inference_call(
        self, investigation_id: str, function_name: str, metadata: InferenceMetadata
    ) -> str:
        call_id = f"call-{uuid4().hex[:12]}"
        with self.connection:
            self.connection.execute(
                "INSERT INTO inference_calls VALUES (?, ?, ?, ?, ?)",
                (call_id, investigation_id, function_name, metadata.model_dump_json(), _now()),
            )
        return call_id

    def add_hypothesis(self, hypothesis: HypothesisRecord) -> None:
        revision = HypothesisRevision(
            revision=1,
            actor=hypothesis.originating_agent,
            reason="initial proposal",
            snapshot=hypothesis.model_dump(mode="json", exclude={"revisions"}),
        )
        hypothesis.revisions = [revision]
        hypothesis.updated_at = revision.changed_at
        with self.connection:
            self.connection.execute(
                "INSERT INTO hypotheses VALUES (?, ?, ?, ?, ?, ?)",
                (
                    hypothesis.id,
                    hypothesis.investigation_id,
                    hypothesis.verification_status.value,
                    hypothesis.model_dump_json(),
                    hypothesis.created_at.isoformat(),
                    hypothesis.updated_at.isoformat(),
                ),
            )
            self.connection.execute(
                "INSERT INTO revisions VALUES (?, ?, ?)",
                (hypothesis.id, 1, revision.model_dump_json()),
            )
            for reference in hypothesis.source_references:
                self.add_edge(
                    hypothesis.id,
                    f"fn:{reference.path}:{hypothesis.property_spec.qualified_name}",
                    "SUPPORTED_BY",
                    commit=False,
                )

    def get_hypothesis(self, hypothesis_id: str) -> HypothesisRecord:
        row = self.connection.execute(
            "SELECT payload_json FROM hypotheses WHERE id = ?", (hypothesis_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown hypothesis: {hypothesis_id}")
        return HypothesisRecord.model_validate_json(row["payload_json"])

    def transition(
        self,
        hypothesis_id: str,
        status: VerificationStatus,
        *,
        actor: str,
        reason: str,
    ) -> HypothesisRecord:
        hypothesis = self.get_hypothesis(hypothesis_id)
        current = hypothesis.verification_status
        if status not in ALLOWED_TRANSITIONS[current]:
            raise InvalidStatusTransition(f"cannot transition {current.value} -> {status.value}")
        hypothesis.verification_status = status
        hypothesis.updated_at = datetime.now(UTC)
        revision_number = len(hypothesis.revisions) + 1
        revision = HypothesisRevision(
            revision=revision_number,
            actor=actor,
            reason=reason,
            snapshot=hypothesis.model_dump(mode="json", exclude={"revisions"}),
        )
        hypothesis.revisions.append(revision)
        with self.connection:
            self.connection.execute(
                "UPDATE hypotheses SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?",
                (
                    status.value,
                    hypothesis.model_dump_json(),
                    hypothesis.updated_at.isoformat(),
                    hypothesis_id,
                ),
            )
            self.connection.execute(
                "INSERT INTO revisions VALUES (?, ?, ?)",
                (hypothesis_id, revision_number, revision.model_dump_json()),
            )
        return hypothesis

    def add_experiment(self, result: ExperimentResult) -> None:
        hypothesis = self.get_hypothesis(result.hypothesis_id)
        hypothesis.experiment_ids.append(result.id)
        hypothesis.updated_at = datetime.now(UTC)
        with self.connection:
            self.connection.execute(
                "INSERT INTO experiments VALUES (?, ?, ?, ?, ?)",
                (
                    result.id,
                    result.hypothesis_id,
                    result.outcome.value,
                    result.model_dump_json(),
                    result.created_at.isoformat(),
                ),
            )
            self.connection.execute(
                "UPDATE hypotheses SET payload_json = ?, updated_at = ? WHERE id = ?",
                (
                    hypothesis.model_dump_json(),
                    hypothesis.updated_at.isoformat(),
                    hypothesis.id,
                ),
            )
            self.add_edge(result.hypothesis_id, result.id, "TESTED_BY", commit=False)

    def get_experiment(self, experiment_id: str) -> ExperimentResult:
        row = self.connection.execute(
            "SELECT payload_json FROM experiments WHERE id = ?", (experiment_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown experiment: {experiment_id}")
        return ExperimentResult.model_validate_json(row["payload_json"])

    def add_incident(self, incident: Incident) -> None:
        with self.connection:
            self.connection.execute(
                "INSERT INTO incidents VALUES (?, ?, ?, ?, ?)",
                (
                    incident.id,
                    incident.investigation_id,
                    incident.hypothesis_id,
                    incident.model_dump_json(),
                    incident.created_at.isoformat(),
                ),
            )
            self.add_edge(incident.hypothesis_id, incident.id, "REPRODUCED_AS", commit=False)

    def update_incident(self, incident: Incident) -> None:
        with self.connection:
            cursor = self.connection.execute(
                "UPDATE incidents SET payload_json = ? WHERE id = ?",
                (incident.model_dump_json(), incident.id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown incident: {incident.id}")

    def get_incident(self, incident_id: str) -> Incident:
        row = self.connection.execute(
            "SELECT payload_json FROM incidents WHERE id = ?", (incident_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown incident: {incident_id}")
        return Incident.model_validate_json(row["payload_json"])

    def list_incidents(self) -> list[Incident]:
        return [
            Incident.model_validate_json(row["payload_json"])
            for row in self.connection.execute(
                "SELECT payload_json FROM incidents ORDER BY created_at"
            )
        ]

    def add_edge(
        self,
        source_id: str,
        target_id: str,
        relation: str,
        payload: dict[str, Any] | None = None,
        *,
        commit: bool = True,
    ) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO edges VALUES (?, ?, ?, ?)",
            (source_id, target_id, relation, json.dumps(payload or {}, sort_keys=True)),
        )
        if commit:
            self.connection.commit()

    def traverse(self, start_id: str, *, max_depth: int = 3) -> list[tuple[str, str, str]]:
        """Return breadth-first `(source, relation, target)` graph edges."""
        found: list[tuple[str, str, str]] = []
        queue: deque[tuple[str, int]] = deque([(start_id, 0)])
        seen = {start_id}
        while queue:
            node, depth = queue.popleft()
            if depth >= max_depth:
                continue
            rows = self.connection.execute(
                "SELECT source_id, relation, target_id FROM edges "
                "WHERE source_id = ? OR target_id = ? ORDER BY relation, target_id",
                (node, node),
            )
            for row in rows:
                edge = (row["source_id"], row["relation"], row["target_id"])
                found.append(edge)
                neighbor = row["target_id"] if row["source_id"] == node else row["source_id"]
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append((neighbor, depth + 1))
        return found

