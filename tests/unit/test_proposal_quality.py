from __future__ import annotations

import json
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from faultmesh.agents import ProposalConfiguration, ScoutAgent
from faultmesh.agents.examples import few_shot_examples
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.inference.backends import BackendResult
from faultmesh.inference.client import InferenceClient
from faultmesh.proposal_quality import (
    DocumentedContractProposer,
    ProposalGenerator,
    deduplicate_proposals,
)
from faultmesh.schemas import FunctionMetadata, ProjectIndex, ProposedHypothesis
from faultmesh.verification import PreconditionCompiler, SpecificationValidator


@dataclass
class SequenceBackend:
    responses: list[str]
    prompts: list[str]

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        assert json_schema
        self.prompts.append(prompt)
        response = self.responses[len(self.prompts) - 1]
        return BackendResult(response, "sequence", "test", "test", 2.0)


def _target(tmp_path: Path) -> tuple[ProjectIndex, FunctionMetadata]:
    source = (
        "def bounded(value: int, maximum: int) -> int:\n"
        '    """Return a value that never exceeds maximum."""\n'
        "    return min(value, maximum)\n"
    )
    (tmp_path / "target.py").write_text(source, encoding="utf-8")
    index = ProjectAnalyzer().analyze(tmp_path)
    return index, index.functions[0]


def _response(preconditions: list[str]) -> str:
    return json.dumps(
        {
            "schema_version": "1.0",
            "hypotheses": [
                {
                    "description": "result is bounded",
                    "source_references": [
                        {"path": "wrong.py", "start_line": 1, "end_line": 1}
                    ],
                    "preconditions": preconditions,
                    "expected_behavior": "result <= maximum",
                    "violation_condition": "result > maximum",
                    "confidence": 0.8,
                    "property_spec": {
                        "schema_version": "1.1",
                        "target": {"path": "wrong.py", "start_line": 1, "end_line": 1},
                        "qualified_name": "wrong",
                        "arguments": [
                            {"name": "value", "strategy": {"kind": "integers"}},
                            {"name": "maximum", "strategy": {"kind": "integers"}},
                        ],
                        "constraints": [],
                        "oracle": {"kind": "result_le_arg", "argument": "maximum"},
                        "oracle_explanation": "never exceeds maximum",
                        "contract_citation": "never exceeds maximum",
                        "evidence": [
                            {"path": "wrong.py", "start_line": 1, "end_line": 1}
                        ],
                        "max_examples": 200,
                        "seed": 1,
                    },
                }
            ],
        }
    )


def test_few_shots_pass_production_schema_compiler_and_validator(tmp_path: Path) -> None:
    for example in few_shot_examples():
        target = tmp_path / example.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(example.source, encoding="utf-8")
    index = ProjectAnalyzer().analyze(tmp_path)
    functions = {function.qualified_name: function for function in index.functions}

    for example in few_shot_examples():
        for proposal in example.response.hypotheses:
            PreconditionCompiler().compile(proposal.preconditions, proposal.property_spec)
            assert (
                SpecificationValidator().validate(proposal.property_spec, index)
                == functions[example.qualified_name]
            )


def test_semantic_retry_preserves_rejection_and_corrects_with_same_evidence(
    tmp_path: Path,
) -> None:
    index, function = _target(tmp_path)
    backend = SequenceBackend([_response(["value is positive"]), _response([])], [])
    generator = ProposalGenerator(
        ScoutAgent(InferenceClient(backend), ContextBuilder()), max_model_calls=2
    )

    outcome = generator.generate(function, index, configuration=ProposalConfiguration.ABC)

    assert len(outcome.rejected) == 1
    assert "precondition compiler" in outcome.rejected[0].reason
    assert len(outcome.accepted) == 1
    assert outcome.accepted[0].source_references == [function.reference]
    assert outcome.metadata is not None
    assert [attempt.phase for attempt in outcome.metadata.attempts] == [
        "initial",
        "semantic_retry",
    ]
    assert outcome.metadata.model_calls == 2
    assert "value is positive" in backend.prompts[1]
    assert function.source in backend.prompts[1]


def test_semantic_retry_can_abstain_and_never_executes_rejected_property(
    tmp_path: Path,
) -> None:
    index, function = _target(tmp_path)
    empty = json.dumps({"schema_version": "1.0", "hypotheses": []})
    backend = SequenceBackend([_response(["value is positive"]), empty], [])
    generator = ProposalGenerator(
        ScoutAgent(InferenceClient(backend), ContextBuilder()), max_model_calls=2
    )

    outcome = generator.generate(function, index, configuration=ProposalConfiguration.ABC)

    assert outcome.accepted == []
    assert len(outcome.rejected) == 1
    assert outcome.abstained is False


def test_dedup_is_stable_and_respects_one_total_property_budget() -> None:
    proposal = ProposedHypothesis.model_validate(json.loads(_response([]))["hypotheses"][0])

    assert deduplicate_proposals([proposal, proposal.model_copy(deep=True)], max_properties=1) == [
        proposal
    ]


def test_transparent_baseline_reads_contracts_without_private_labels() -> None:
    root = Path(__file__).parents[2]
    private = json.loads(
        (root / "benchmarks/phase2_corpus/private/adjudication.json").read_text(
            encoding="utf-8"
        )
    )
    manifest = tomllib.loads(
        (root / "benchmarks/phase-2-pilot.lock.toml").read_text(encoding="utf-8")
    )

    for case in manifest["cases"]:
        source = root / "benchmarks" / case["buggy_path"]
        index = ProjectAnalyzer().analyze(source.parent, focus=source)
        function = next(item for item in index.functions if item.name == case["target"])
        proposals = DocumentedContractProposer().propose(function)
        kinds = {proposal.property_spec.oracle.kind for proposal in proposals}
        assert set(private["cases"][case["bug_id"]]["expected_oracles"]).issubset(kinds)
        serialized = "".join(proposal.model_dump_json() for proposal in proposals)
        assert private["context_isolation_canary"] not in serialized
