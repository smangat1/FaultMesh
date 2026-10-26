"""SQLite evidence storage with explicit ownership and schema checks."""

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

EVIDENCE_SCHEMA_VERSION = 2


class EvidenceStoreError(RuntimeError):
    pass


class LegacyEvidenceStoreError(EvidenceStoreError):
    pass


class EvidenceSchemaError(EvidenceStoreError):
    pass


class EvidenceConflict(EvidenceStoreError):
    pass


class EvidenceOwnershipError(EvidenceStoreError):
    pass


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


SCHEMA_STATEMENTS = (
    """
    CREATE TABLE schema_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL,
        initialized_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE investigations (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        focus TEXT,
        created_at TEXT NOT NULL,
        project_index_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE graph_nodes (
        storage_id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL REFERENCES investigations(id),
        node_kind TEXT NOT NULL,
        logical_id TEXT NOT NULL,
        UNIQUE (investigation_id, logical_id),
        UNIQUE (storage_id, investigation_id)
    )
    """,
    """
    CREATE TABLE entities (
        storage_id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        logical_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        qualified_name TEXT,
        payload_json TEXT NOT NULL,
        UNIQUE (investigation_id, logical_id),
        FOREIGN KEY (storage_id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    "CREATE INDEX entities_investigation ON entities(investigation_id, kind)",
    """
    CREATE TABLE hypotheses (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    """
    CREATE TABLE revisions (
        hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
        revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (hypothesis_id, revision)
    )
    """,
    """
    CREATE TABLE experiments (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
        outcome TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    """
    CREATE TABLE incidents (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    """
    CREATE TABLE inference_calls (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        function_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    """
    CREATE TABLE edges (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL REFERENCES investigations(id),
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (investigation_id, source_id, target_id, relation),
        FOREIGN KEY (source_id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id),
        FOREIGN KEY (target_id, investigation_id)
            REFERENCES graph_nodes(storage_id, investigation_id)
    )
    """,
    "CREATE INDEX edges_investigation ON edges(investigation_id, relation)",
)

REQUIRED_TABLES = {
    "schema_metadata",
    "investigations",
    "graph_nodes",
    "entities",
    "hypotheses",
    "revisions",
    "experiments",
    "incidents",
    "inference_calls",
    "edges",
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


class EvidenceStore:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        try:
            self.connection.execute("PRAGMA foreign_keys = ON")
            self._open_schema()
            self.connection.execute("PRAGMA journal_mode = WAL")
        except Exception:
            self.connection.close()
            raise

    def __enter__(self) -> EvidenceStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def _open_schema(self) -> None:
        tables = self._table_names()
        if not tables:
            self._initialize_schema()
            return
        if "schema_metadata" not in tables:
            raise LegacyEvidenceStoreError(
                f"legacy evidence database is not modified automatically: {self.path}. "
                "Choose a fresh artifact_directory in .faultmesh.toml."
            )
        row = self.connection.execute(
            "SELECT version FROM schema_metadata WHERE singleton = 1"
        ).fetchone()
        if row is None or row["version"] != EVIDENCE_SCHEMA_VERSION:
            actual = "missing" if row is None else str(row["version"])
            raise EvidenceSchemaError(
                f"unsupported evidence schema {actual}; expected {EVIDENCE_SCHEMA_VERSION}. "
                "Choose a fresh artifact_directory instead of rewriting this database."
            )
        missing = REQUIRED_TABLES - tables
        if missing:
            names = ", ".join(sorted(missing))
            raise EvidenceSchemaError(f"evidence schema is incomplete; missing: {names}")

    def _table_names(self) -> set[str]:
        rows = self.connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        return {str(row["name"]) for row in rows}

    def _initialize_schema(self) -> None:
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            for statement in SCHEMA_STATEMENTS:
                self.connection.execute(statement)
            self.connection.execute(
                "INSERT INTO schema_metadata VALUES (1, ?, ?)",
                (EVIDENCE_SCHEMA_VERSION, _now()),
            )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _entity_storage_id(investigation_id: str, logical_id: str) -> str:
        return f"entity:{investigation_id}:{logical_id}"

    def _require_investigation(self, investigation_id: str) -> None:
        row = self.connection.execute(
            "SELECT 1 FROM investigations WHERE id = ?", (investigation_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown investigation: {investigation_id}")

    def _register_node(
        self,
        storage_id: str,
        investigation_id: str,
        node_kind: str,
        logical_id: str,
    ) -> None:
        self._require_investigation(investigation_id)
        try:
            self.connection.execute(
                "INSERT INTO graph_nodes VALUES (?, ?, ?, ?)",
                (storage_id, investigation_id, node_kind, logical_id),
            )
        except sqlite3.IntegrityError as exc:
            raise EvidenceConflict(
                f"graph node already exists or conflicts: {investigation_id}/{logical_id}"
            ) from exc

    def _add_entity(
        self,
        investigation_id: str,
        logical_id: str,
        kind: str,
        path: str,
        qualified_name: str | None,
        payload_json: str,
    ) -> str:
        storage_id = self._entity_storage_id(investigation_id, logical_id)
        self._register_node(storage_id, investigation_id, kind, logical_id)
        try:
            self.connection.execute(
                "INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    storage_id,
                    investigation_id,
                    logical_id,
                    kind,
                    path,
                    qualified_name,
                    payload_json,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise EvidenceConflict(
                f"entity already exists or conflicts: {investigation_id}/{logical_id}"
            ) from exc
        return storage_id

    def add_entity(
        self,
        investigation_id: str,
        *,
        logical_id: str,
        kind: str,
        path: str,
        qualified_name: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> str:
        with self.connection:
            return self._add_entity(
                investigation_id,
                logical_id,
                kind,
                path,
                qualified_name,
                json.dumps(payload or {}, sort_keys=True),
            )

    def list_entities(self, investigation_id: str) -> list[dict[str, str | None]]:
        rows = self.connection.execute(
            "SELECT storage_id, logical_id, kind, path, qualified_name "
            "FROM entities WHERE investigation_id = ? ORDER BY logical_id",
            (investigation_id,),
        ).fetchall()
        return [dict(row) for row in rows]

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
                module_logical_id = f"src:{module.path}"
                module_id = self._add_entity(
                    investigation_id,
                    module_logical_id,
                    "module",
                    module.path,
                    None,
                    module.model_dump_json(),
                )
                for function in module.functions:
                    function_logical_id = f"fn:{module.path}:{function.qualified_name}"
                    function_id = self._add_entity(
                        investigation_id,
                        function_logical_id,
                        "function",
                        module.path,
                        function.qualified_name,
                        function.model_dump_json(),
                    )
                    self._add_edge(module_id, function_id, "DEFINES", None)
            for document in project_index.documentation:
                self._add_entity(
                    investigation_id,
                    f"doc:{document.path}",
                    "documentation",
                    document.path,
                    None,
                    document.model_dump_json(),
                )
        return investigation_id

    def add_inference_call(
        self, investigation_id: str, function_name: str, metadata: InferenceMetadata
    ) -> str:
        call_id = f"call-{uuid4().hex[:12]}"
        with self.connection:
            self._register_node(call_id, investigation_id, "inference_call", call_id)
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
            self._register_node(
                hypothesis.id,
                hypothesis.investigation_id,
                "hypothesis",
                hypothesis.id,
            )
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
                logical_id = f"fn:{reference.path}:{hypothesis.property_spec.qualified_name}"
                entity_id = self._entity_storage_id(hypothesis.investigation_id, logical_id)
                self._add_edge(hypothesis.id, entity_id, "SUPPORTED_BY", None)

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
            self._register_node(
                result.id,
                hypothesis.investigation_id,
                "experiment",
                result.id,
            )
            self.connection.execute(
                "INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?)",
                (
                    result.id,
                    hypothesis.investigation_id,
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
            self._add_edge(result.hypothesis_id, result.id, "TESTED_BY", None)

    def get_experiment(self, experiment_id: str) -> ExperimentResult:
        row = self.connection.execute(
            "SELECT payload_json FROM experiments WHERE id = ?", (experiment_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown experiment: {experiment_id}")
        return ExperimentResult.model_validate_json(row["payload_json"])

    def add_incident(self, incident: Incident) -> None:
        hypothesis = self.get_hypothesis(incident.hypothesis_id)
        if hypothesis.investigation_id != incident.investigation_id:
            raise EvidenceOwnershipError(
                "incident and hypothesis belong to different investigations"
            )
        with self.connection:
            self._register_node(
                incident.id,
                incident.investigation_id,
                "incident",
                incident.id,
            )
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
            self._add_edge(incident.hypothesis_id, incident.id, "REPRODUCED_AS", None)

    def update_incident(self, incident: Incident) -> None:
        with self.connection:
            cursor = self.connection.execute(
                "UPDATE incidents SET payload_json = ? "
                "WHERE id = ? AND investigation_id = ?",
                (incident.model_dump_json(), incident.id, incident.investigation_id),
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

    def _node_investigation(self, storage_id: str) -> str:
        row = self.connection.execute(
            "SELECT investigation_id FROM graph_nodes WHERE storage_id = ?",
            (storage_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown graph node: {storage_id}")
        return str(row["investigation_id"])

    def _add_edge(
        self,
        source_id: str,
        target_id: str,
        relation: str,
        payload: dict[str, Any] | None,
    ) -> str:
        source_investigation = self._node_investigation(source_id)
        target_investigation = self._node_investigation(target_id)
        if source_investigation != target_investigation:
            raise EvidenceOwnershipError(
                "edge endpoints belong to different investigations: "
                f"{source_investigation} != {target_investigation}"
            )
        edge_id = f"edge-{uuid4().hex[:12]}"
        try:
            self.connection.execute(
                "INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)",
                (
                    edge_id,
                    source_investigation,
                    source_id,
                    target_id,
                    relation,
                    json.dumps(payload or {}, sort_keys=True),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise EvidenceConflict(
                f"edge already exists or conflicts: {source_id} {relation} {target_id}"
            ) from exc
        return edge_id

    def add_edge(
        self,
        source_id: str,
        target_id: str,
        relation: str,
        payload: dict[str, Any] | None = None,
    ) -> str:
        with self.connection:
            return self._add_edge(source_id, target_id, relation, payload)

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
