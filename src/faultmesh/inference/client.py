"""Validated structured inference with bounded repair."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from faultmesh.inference.backends import BackendResult, InferenceBackend
from faultmesh.schemas import InferenceMetadata, ScoutResponse


class InferenceValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class ValidatedInference:
    response: ScoutResponse
    metadata: InferenceMetadata


def _extract_json(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end < start:
        raise ValueError("response did not contain a JSON object")
    return stripped[start : end + 1]


class InferenceClient:
    def __init__(self, backend: InferenceBackend, *, max_repair_attempts: int = 2) -> None:
        self.backend = backend
        self.max_repair_attempts = max_repair_attempts

    def scout(self, prompt: str) -> ValidatedInference:
        schema: dict[str, Any] = ScoutResponse.model_json_schema()
        total_latency = 0.0
        latest: BackendResult | None = None
        current_prompt = prompt
        errors: list[str] = []
        for attempt in range(self.max_repair_attempts + 1):
            latest = self.backend.generate(current_prompt, schema)
            total_latency += latest.latency_ms
            try:
                response = ScoutResponse.model_validate_json(_extract_json(latest.text))
            except (ValueError, ValidationError, json.JSONDecodeError) as exc:
                errors.append(str(exc))
                if attempt >= self.max_repair_attempts:
                    break
                current_prompt = (
                    "Return only corrected JSON conforming to the supplied schema. "
                    f"The previous response failed validation: {str(exc)[:1500]}\n"
                    f"Previous response:\n{latest.text[:6000]}"
                )
                continue
            return ValidatedInference(
                response=response,
                metadata=InferenceMetadata(
                    backend=latest.backend,
                    model=latest.model,
                    hardware=latest.hardware,
                    latency_ms=total_latency,
                    prompt_tokens=latest.prompt_tokens,
                    completion_tokens=latest.completion_tokens,
                    repair_attempts=attempt,
                ),
            )
        raise InferenceValidationError(
            "model did not produce a valid ScoutResponse after repair attempts: "
            + " | ".join(errors)
        )

