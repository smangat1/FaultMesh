from pathlib import Path

import pytest

from faultmesh.agents import ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.evidence import EvidenceStore, InvalidStatusTransition
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

