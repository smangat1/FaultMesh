"""Local GGUF registry, resumable download, discovery, and narration settings."""

from __future__ import annotations

import hashlib
import shutil
import urllib.parse
import urllib.request
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.narration import LocalModelInventory, inventory_local_models
from faultmesh.replay.narration_runner import default_narration_cache_dir

REGISTRY_HOST = "huggingface.co"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelArtifact(_StrictModel):
    url: str
    filename: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(gt=0)


class RecommendedModel(_StrictModel):
    id: str
    display_name: str
    preset: Literal["medium-3b", "large-7b"]
    recommended: bool = False
    artifacts: tuple[ModelArtifact, ...]


MODEL_REGISTRY: tuple[RecommendedModel, ...] = (
    RecommendedModel(
        id="qwen2.5-3b-instruct-q4-k-m",
        display_name="Qwen2.5 3B Instruct Q4_K_M",
        preset="medium-3b",
        recommended=True,
        artifacts=(
            ModelArtifact(
                url=(
                    "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/"
                    "qwen2.5-3b-instruct-q4_k_m.gguf"
                ),
                filename="qwen2.5-3b-instruct-q4_k_m.gguf",
                sha256="626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
                size_bytes=2_104_932_768,
            ),
        ),
    ),
    RecommendedModel(
        id="qwen2.5-7b-instruct-q4-k-m",
        display_name="Qwen2.5 7B Instruct Q4_K_M",
        preset="large-7b",
        artifacts=(
            ModelArtifact(
                url=(
                    "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/"
                    "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
                ),
                filename="qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
                sha256="dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
                size_bytes=3_993_201_344,
            ),
            ModelArtifact(
                url=(
                    "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/"
                    "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
                ),
                filename="qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
                sha256="539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a",
                size_bytes=689_872_288,
            ),
        ),
    ),
)


class ModelSettings(_StrictModel):
    selected_model_path: str | None = None
    preset: Literal["small-1.5b", "medium-3b", "large-7b"] = "medium-3b"
    llama_server_executable: str = "llama-server"
    narration_enabled: bool = True


class ModelStatus(_StrictModel):
    ready: bool
    status: Literal["ready", "setup_required", "engine_missing", "model_missing"]
    message: str
    preset: str
    model_filename: str | None = None


def default_model_settings_path() -> Path:
    return default_narration_cache_dir().parent / "model-settings.json"


def default_model_dir() -> Path:
    return default_narration_cache_dir().parent / "models"


def load_model_settings(path: Path | None = None) -> ModelSettings:
    target = (path or default_model_settings_path()).expanduser().resolve()
    if not target.is_file():
        return ModelSettings()
    return ModelSettings.model_validate_json(target.read_text(encoding="utf-8"))


def save_model_settings(settings: ModelSettings, path: Path | None = None) -> Path:
    target = (path or default_model_settings_path()).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = target.with_name(f".{target.name}.tmp")
    temporary.write_text(settings.model_dump_json(indent=2) + "\n", encoding="utf-8")
    with suppress(OSError):
        temporary.chmod(0o600)
    temporary.replace(target)
    return target


def model_status(settings: ModelSettings) -> ModelStatus:
    if settings.selected_model_path is None:
        return ModelStatus(
            ready=False,
            status="setup_required",
            message="Choose or download a local narration model.",
            preset=settings.preset,
        )
    model_path = Path(settings.selected_model_path).expanduser()
    if not model_path.is_file():
        return ModelStatus(
            ready=False,
            status="model_missing",
            message="The selected narration model could not be found.",
            preset=settings.preset,
            model_filename=model_path.name,
        )
    executable = settings.llama_server_executable
    executable_exists = Path(executable).is_file() or shutil.which(executable) is not None
    if not executable_exists:
        return ModelStatus(
            ready=False,
            status="engine_missing",
            message="Narration engine not installed.",
            preset=settings.preset,
            model_filename=model_path.name,
        )
    return ModelStatus(
        ready=True,
        status="ready",
        message="Local narration is ready.",
        preset=settings.preset,
        model_filename=model_path.name,
    )


def find_existing_models(search_roots: list[Path]) -> LocalModelInventory:
    return inventory_local_models(search_roots)


def _artifact_for_url(url: str) -> ModelArtifact:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("model downloads require HTTPS")
    if parsed.hostname != REGISTRY_HOST:
        raise ValueError("model download host is not allowed")
    artifact = next(
        (
            item
            for model in MODEL_REGISTRY
            for item in model.artifacts
            if item.url == url
        ),
        None,
    )
    if artifact is None:
        raise ValueError("model URL is not present in the verified registry")
    return artifact


def download_model(
    url: str,
    dest: Path,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Download one verified registry artifact, resuming through a sibling .part file."""
    artifact = _artifact_for_url(url)
    destination = dest.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    partial = destination.with_name(destination.name + ".part")
    existing = partial.stat().st_size if partial.is_file() else 0
    if existing > artifact.size_bytes:
        partial.unlink()
        existing = 0
    request = urllib.request.Request(url)
    if existing:
        request.add_header("Range", f"bytes={existing}-")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            status = getattr(response, "status", 200)
            if existing and status != 206:
                existing = 0
                mode = "wb"
            else:
                mode = "ab" if existing else "wb"
            downloaded = existing
            with partial.open(mode) as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    downloaded += len(chunk)
                    if on_progress is not None:
                        on_progress(downloaded, artifact.size_bytes)
    except Exception:
        raise
    digest = hashlib.sha256()
    with partial.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if partial.stat().st_size != artifact.size_bytes or digest.hexdigest() != artifact.sha256:
        partial.unlink(missing_ok=True)
        raise ValueError("downloaded model failed size or SHA-256 verification")
    partial.replace(destination)
    return destination
