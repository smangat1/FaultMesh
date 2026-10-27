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
from faultmesh.schemas import scout_response_json_schema


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

