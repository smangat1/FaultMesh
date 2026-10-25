"""Project configuration with conservative defaults."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class FaultMeshConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = "llama-server"
    llama_endpoint: str = "http://127.0.0.1:8080/v1/chat/completions"
    llama_model: str = "local-model"
    llama_cli: str = "llama-completion"
    model_path: Path | None = None
    max_context_characters: int = Field(default=12_000, ge=1_000, le=100_000)
    max_examples: int = Field(default=200, ge=1, le=10_000)
    confirmation_runs: int = Field(default=3, ge=1, le=100)
    timeout_seconds: int = Field(default=30, ge=1, le=600)
    docker_image: str = "faultmesh-sandbox:0.1.0"
    artifact_directory: Path = Path(".faultmesh")

    @classmethod
    def load(cls, repository: Path) -> FaultMeshConfig:
        path = repository / ".faultmesh.toml"
        if not path.exists():
            return cls()
        with path.open("rb") as handle:
            raw = tomllib.load(handle)
        return cls.model_validate(raw.get("faultmesh", {}))

