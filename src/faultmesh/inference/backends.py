"""Interchangeable local inference backends."""

from __future__ import annotations

import json
import os
import platform
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from faultmesh.schemas import FunctionMetadata


@dataclass(frozen=True)
class BackendResult:
    text: str
    backend: str
    model: str
    hardware: str
    latency_ms: float
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class InferenceBackend(Protocol):
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult: ...


class LlamaCppServerBackend:
    """llama.cpp OpenAI-compatible HTTP adapter; only localhost is allowed by default."""

    def __init__(
        self,
        endpoint: str,
        model: str = "local-model",
        *,
        timeout_seconds: int = 120,
        allow_remote_endpoint: bool = False,
    ) -> None:
        self.endpoint = endpoint
        self.model = model
        self.timeout_seconds = timeout_seconds
        if not allow_remote_endpoint and not any(
            endpoint.startswith(prefix)
            for prefix in ("http://127.0.0.1:", "http://localhost:", "http://[::1]:")
        ):
            raise ValueError("llama-server endpoint must be loopback unless explicitly allowed")

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "scout_response", "schema": json_schema},
            },
        }
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310
                body = json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"llama.cpp server inference failed: {exc}") from exc
        elapsed = (time.perf_counter() - started) * 1000
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("llama.cpp server returned an unexpected response shape") from exc
        usage = body.get("usage", {})
        return BackendResult(
            text=content,
            backend="llama.cpp-server",
            model=body.get("model", self.model),
            hardware=platform.platform(),
            latency_ms=elapsed,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )


class LlamaCppCliBackend:
    """llama.cpp CLI adapter using grammar-constrained JSON output."""

    def __init__(
        self,
        executable: str,
        model_path: Path,
        *,
        timeout_seconds: int = 120,
        context_size: int = 8192,
    ) -> None:
        self.executable = executable
        self.model_path = model_path.resolve()
        self.timeout_seconds = timeout_seconds
        self.context_size = context_size

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        if not self.model_path.is_file():
            raise FileNotFoundError(f"GGUF model not found: {self.model_path}")
        command = [
            self.executable,
            "--model",
            str(self.model_path),
            "--prompt",
            prompt,
            "--n-predict",
            "2048",
            "--ctx-size",
            str(self.context_size),
            "--temp",
            "0",
            "--json-schema",
            json.dumps(json_schema, separators=(",", ":")),
            "--no-display-prompt",
            "--single-turn",
        ]
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                timeout=self.timeout_seconds,
                env={"PATH": os.environ.get("PATH", "")},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"llama.cpp CLI inference failed: {exc}") from exc
        elapsed = (time.perf_counter() - started) * 1000
        stdout = completed.stdout.decode("utf-8", errors="replace")
        stderr = completed.stderr.decode("utf-8", errors="replace")
        if completed.returncode != 0:
            raise RuntimeError(
                f"llama.cpp CLI exited {completed.returncode}: {stderr[-1000:]}"
            )
        return BackendResult(
            text=stdout,
            backend="llama.cpp-cli",
            model=self.model_path.name,
            hardware=platform.platform(),
            latency_ms=elapsed,
        )


class HeuristicBackend:
    """Deterministic, docstring-grounded backend for tests and constrained offline use.

    This is not a mock: it implements a small transparent inference rule. It recognizes a documented
    integer upper-bound contract and emits the same schema used by model backends.
    """

    def __init__(self) -> None:
        self._function: FunctionMetadata | None = None

    def bind(self, function: FunctionMetadata) -> HeuristicBackend:
        self._function = function
        return self

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        started = time.perf_counter()
        function = self._function
        hypotheses: list[dict[str, Any]] = []
        if function is not None and not function.is_method and not function.is_async:
            docstring = (function.docstring or "").lower()
            parameter_names = [parameter.name for parameter in function.parameters]
            maximum = next(
                (
                    name
                    for name in parameter_names
                    if name in {"maximum", "max_value", "upper", "limit"}
                ),
                None,
            )
            integer_parameters = [
                parameter.name
                for parameter in function.parameters
                if parameter.annotation in {"int", None}
                and parameter.kind in {"positional", "keyword_only"}
            ]
            contract_words = ("never exceed", "at most", "no greater than", "upper bound")
            if maximum and all(name in integer_parameters for name in parameter_names) and any(
                phrase in docstring for phrase in contract_words
            ):
                other = next((name for name in parameter_names if name != maximum), None)
                constraints = []
                if other:
                    constraints.append({"kind": "le", "left": other, "right": maximum})
                reference = function.reference.model_dump(mode="json")
                hypotheses.append(
                    {
                        "description": (
                            f"{function.qualified_name} may return a value above the documented "
                            f"upper bound {maximum} at a boundary input."
                        ),
                        "source_references": [reference],
                        "preconditions": [
                            "All arguments are integers in [0, 100]",
                            *([f"{other} <= {maximum}"] if other else []),
                        ],
                        "expected_behavior": f"The result is less than or equal to {maximum}.",
                        "violation_condition": f"The result is greater than {maximum}.",
                        "confidence": 0.78,
                        "property_spec": {
                            "schema_version": "1.0",
                            "target": reference,
                            "qualified_name": function.qualified_name,
                            "arguments": [
                                {
                                    "name": name,
                                    "strategy": {
                                        "kind": "integers",
                                        "minimum": 0,
                                        "maximum": 100,
                                    },
                                }
                                for name in parameter_names
                            ],
                            "constraints": constraints,
                            "oracle": {"kind": "result_le_arg", "argument": maximum},
                            "oracle_explanation": (
                                f"The function docstring states that the result must never exceed "
                                f"{maximum}."
                            ),
                            "evidence": [reference],
                            "max_examples": 200,
                            "seed": 1,
                        },
                    }
                )
        elapsed = (time.perf_counter() - started) * 1000
        return BackendResult(
            text=json.dumps({"schema_version": "1.0", "hypotheses": hypotheses}),
            backend="deterministic-heuristic",
            model="documented-upper-bound-v1",
            hardware=platform.platform(),
            latency_ms=elapsed,
            prompt_tokens=None,
            completion_tokens=None,
        )

