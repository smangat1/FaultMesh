"""Load the narrow V1 project runner configuration."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

from faultmesh.project_runner.models import ProjectRunConfig


@dataclass(frozen=True)
class ResolvedRunConfig:
    config: ProjectRunConfig
    config_path: Path
    target_root: Path
    artifact_root: Path


def load_run_config(path: Path) -> ResolvedRunConfig:
    config_path = path.resolve()
    with config_path.open("rb") as handle:
        raw = tomllib.load(handle)
    config = ProjectRunConfig.model_validate(raw.get("project_run", raw))
    base = config_path.parent
    target_root = (base / config.target_root).resolve()
    artifact_root = (base / config.artifact_root).resolve()
    if not target_root.is_dir():
        raise ValueError(f"target_root is not a directory: {target_root}")
    if target_root == artifact_root or target_root in artifact_root.parents:
        raise ValueError("artifact_root must not be inside target_root")
    workdir = (target_root / config.test.working_directory).resolve()
    if not workdir.is_dir() or not workdir.is_relative_to(target_root):
        raise ValueError("working_directory must resolve inside target_root")
    return ResolvedRunConfig(config, config_path, target_root, artifact_root)
