import sqlite3
from pathlib import Path

import pytest

from faultmesh.agents import ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.evidence import (
    EvidenceConflict,
    EvidenceOwnershipError,
    EvidenceStore,
    InvalidStatusTransition,
    LegacyEvidenceStoreError,
)
from faultmesh.evidence import store as store_module
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.schemas import HypothesisRecord, VerificationStatus

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def _hypothesis(investigation_id: str) -> HypothesisRecord:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    function = next(item for item in index.functions if item.name == "bounded_increment")
    proposed = ScoutAgent(InferenceClient(HeuristicBackend()), ContextBuilder()).inspect(
        function
    ).response.hypotheses[0]
    return HypothesisRecord(
        investigation_id=investigation_id,
        description=proposed.description,
        source_references=proposed.source_references,
        preconditions=proposed.preconditions,
        expected_behavior=proposed.expected_behavior,
        violation_condition=proposed.violation_condition,
        originating_agent="test",
        confidence=proposed.confidence,
        property_spec=proposed.property_spec,
    )


def test_store_guards_transitions_and_persists_graph(tmp_path: Path) -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    path = tmp_path / "evidence.sqlite3"
    with EvidenceStore(path) as store:
        investigation_id = store.create_investigation(index)
        hypothesis = _hypothesis(investigation_id)
        store.add_hypothesis(hypothesis)
        with pytest.raises(InvalidStatusTransition):
            store.transition(
                hypothesis.id,
                VerificationStatus.VERIFIED,
                actor="test",
                reason="illegal skip",
            )
        store.transition(
            hypothesis.id,
            VerificationStatus.TESTABLE,
            actor="validator",
            reason="valid",
        )
        assert store.traverse(hypothesis.id)
    with EvidenceStore(path) as reopened:
        restored = reopened.get_hypothesis(hypothesis.id)
        assert restored.verification_status == VerificationStatus.TESTABLE
        assert len(restored.revisions) == 2


def test_repeated_analysis_keeps_investigation_entities_independent(tmp_path: Path) -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    with EvidenceStore(tmp_path / "evidence.sqlite3") as store:
        first = store.create_investigation(index)
        first_entities = store.list_entities(first)
        second = store.create_investigation(index)
        second_entities = store.list_entities(second)

        assert [item["logical_id"] for item in first_entities] == [
            item["logical_id"] for item in second_entities
        ]
        assert {item["storage_id"] for item in first_entities}.isdisjoint(
            {item["storage_id"] for item in second_entities}
        )
        assert store.list_entities(first) == first_entities


def test_entity_and_edge_conflicts_are_explicit(tmp_path: Path) -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    with EvidenceStore(tmp_path / "evidence.sqlite3") as store:
        investigation_id = store.create_investigation(index)
        source = store.add_entity(
            investigation_id,
            logical_id="test:source",
            kind="test",
            path="tests/source.py",
        )
        target = store.add_entity(
            investigation_id,
            logical_id="test:target",
            kind="test",
            path="tests/target.py",
        )

        with pytest.raises(EvidenceConflict, match="graph node already exists"):
            store.add_entity(
                investigation_id,
                logical_id="test:source",
                kind="test",
                path="tests/different.py",
            )

        store.add_edge(source, target, "OBSERVED")
        with pytest.raises(EvidenceConflict, match="edge already exists"):
            store.add_edge(source, target, "OBSERVED")


def test_cross_investigation_edges_are_rejected(tmp_path: Path) -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    with EvidenceStore(tmp_path / "evidence.sqlite3") as store:
        first = store.create_investigation(index)
        second = store.create_investigation(index)
        first_node = str(store.list_entities(first)[0]["storage_id"])
        second_node = str(store.list_entities(second)[0]["storage_id"])

        with pytest.raises(EvidenceOwnershipError, match="different investigations"):
            store.add_edge(first_node, second_node, "INVALID")


def test_legacy_database_is_rejected_without_rewrite(tmp_path: Path) -> None:
    path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE investigations (id TEXT PRIMARY KEY)")
    connection.commit()
    connection.close()
    before = path.read_bytes()

    with pytest.raises(LegacyEvidenceStoreError, match="fresh artifact_directory"):
        EvidenceStore(path)

    assert path.read_bytes() == before
    assert not path.with_name(f"{path.name}-wal").exists()


def test_schema_initialization_rolls_back_on_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "failed.sqlite3"
    monkeypatch.setattr(
        store_module,
        "SCHEMA_STATEMENTS",
        (*store_module.SCHEMA_STATEMENTS, "CREATE TABLE invalid ("),
    )

    with pytest.raises(sqlite3.OperationalError):
        EvidenceStore(path)

    connection = sqlite3.connect(path)
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()
    connection.close()
    assert tables == []

