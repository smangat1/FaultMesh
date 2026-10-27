import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from faultmesh.agents import ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.inference.backends import BackendResult, HeuristicBackend, LlamaCppCliBackend
from faultmesh.inference.client import InferenceClient, InferenceValidationError
from faultmesh.inference.client import ModelCallBudget
from faultmesh.schemas import (
    FunctionMetadata,
    ParameterMetadata,
    SourceReference,
    scout_response_json_schema,
    scout_response_json_schema_for,
)


@dataclass
class InvalidBackend:
    calls: int = 0

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        self.calls += 1
        return BackendResult("not json", "invalid", "none", "test", 1.0)


def test_invalid_model_output_gets_bounded_repair_attempts() -> None:
    backend = InvalidBackend()
    with pytest.raises(InferenceValidationError):
        InferenceClient(backend, max_repair_attempts=2).scout("prompt")
    assert backend.calls == 3


def test_total_call_budget_subordinates_json_repair_limit() -> None:
    backend = InvalidBackend()
    budget = ModelCallBudget(2)

    with pytest.raises(InferenceValidationError) as captured:
        InferenceClient(backend, max_repair_attempts=2).scout("original", budget=budget)

    assert backend.calls == 2
    assert budget.used == 2
    assert [attempt.raw_response for attempt in captured.value.attempts] == [
        "not json",
        "not json",
    ]
    assert captured.value.attempts[0].phase == "initial"
    assert captured.value.attempts[1].phase == "json_repair"


@dataclass
class VersionRepairBackend:
    prompts: list[str]

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del json_schema
        self.prompts.append(prompt)
        return BackendResult("not json", "invalid", "none", "test", 1.0)


def test_repair_prompt_explains_typed_property_schema_version() -> None:
    backend = VersionRepairBackend(prompts=[])

    with pytest.raises(InferenceValidationError):
        InferenceClient(backend, max_repair_attempts=1).scout("original prompt")

    assert 'property_spec.schema_version "1.1"' in backend.prompts[1]


def test_model_facing_schema_requires_explicit_typed_contract_fields() -> None:
    schema = scout_response_json_schema()
    property_schema = schema["$defs"]["PropertySpec"]

    assert "schema_version" in property_schema["required"]
    assert "contract_citation" in property_schema["required"]
    assert "default" not in property_schema["properties"]["schema_version"]
    assert property_schema["properties"]["contract_citation"] == {
        "type": "string",
        "minLength": 8,
    }


@pytest.mark.parametrize(
    ("annotation", "expected_strategy", "expected_oracle"),
    [
        ("int", "IntegerStrategy", "result_le_arg"),
        ("str", "TextStrategy", "result_length_le_arg"),
        ("list[int]", "IntegerListStrategy", "ResultListNondecreasingOracle"),
    ],
)
def test_function_schema_specializes_arguments_and_oracles(
    annotation: str, expected_strategy: str, expected_oracle: str
) -> None:
    function = FunctionMetadata(
        name="target",
        qualified_name="target",
        reference=SourceReference(path="target.py", start_line=1, end_line=2),
        parameters=[
            ParameterMetadata(
                name="value",
                annotation=annotation,
                kind="positional",
            )
        ],
        return_annotation=annotation,
        source="def target(value):\n    return value\n",
    )

    schema = scout_response_json_schema_for(function)
    property_schema = schema["$defs"]["PropertySpec"]
    arguments = property_schema["properties"]["arguments"]
    serialized_oracle = json.dumps(property_schema["properties"]["oracle"])

    assert property_schema["properties"]["schema_version"]["const"] == "1.1"
    assert arguments["minItems"] == len(function.parameters)
    assert any(
        item["properties"]["strategy"]["$ref"].endswith(expected_strategy)
        for item in arguments["prefixItems"]
    )
    assert expected_oracle in serialized_oracle


def test_llama_cli_backend_replaces_invalid_output_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"placeholder")
    observed_command: list[str] = []

    def completed(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        del kwargs
        observed_command.extend(args[0])
        return subprocess.CompletedProcess(args[0], 0, b'{"text":"bad \xff"}', b"")

    monkeypatch.setattr(subprocess, "run", completed)
    monkeypatch.setattr(
        "faultmesh.inference.backends.platform.platform", lambda: "test-platform"
    )
    result = LlamaCppCliBackend("llama-cli", model).generate("prompt", {})
    assert result.text == '{"text":"bad �"}'
    assert "--single-turn" in observed_command


class TamperedHeuristic(HeuristicBackend):
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        result = super().generate(prompt, json_schema)
        payload = json.loads(result.text)
        for hypothesis in payload["hypotheses"]:
            hypothesis["property_spec"]["qualified_name"] = "invented.other"
            hypothesis["source_references"][0]["content_hash"] = "invented"
            hypothesis["property_spec"]["target"]["content_hash"] = "invented"
            hypothesis["property_spec"]["evidence"][0]["content_hash"] = "invented"
        return BackendResult(
            json.dumps(payload),
            result.backend,
            result.model,
            result.hardware,
            result.latency_ms,
        )


def test_scout_deterministically_grounds_model_source_identity() -> None:
    example = Path(__file__).parents[2] / "examples" / "buggy_python_project"
    function = next(
        item
        for item in ProjectAnalyzer().analyze(example).functions
        if item.name == "bounded_increment"
    )
    inferred = ScoutAgent(
        InferenceClient(TamperedHeuristic()), ContextBuilder()
    ).inspect(function)
    proposed = inferred.response.hypotheses[0]
    assert proposed.source_references == [function.reference]
    assert proposed.property_spec.qualified_name == function.qualified_name
    assert proposed.property_spec.target == function.reference
    assert proposed.property_spec.evidence == [function.reference]

