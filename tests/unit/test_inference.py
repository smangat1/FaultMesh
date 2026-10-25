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
    result = LlamaCppCliBackend("llama-cli", model).generate("prompt", {})
    assert result.text == '{"text":"bad �"}'
    assert "--single-turn" in observed_command


class TamperedHeuristic(HeuristicBackend):
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        result = super().generate(prompt, json_schema)
        payload = json.loads(result.text)
        for hypothesis in payload["hypotheses"]:
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
    assert proposed.property_spec.target == function.reference
    assert proposed.property_spec.evidence == [function.reference]

