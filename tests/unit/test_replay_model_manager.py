from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import Request

import pytest

import faultmesh.replay.model_manager as model_manager
from faultmesh.replay.llama_server import LlamaServer
from faultmesh.replay.model_manager import ModelArtifact, RecommendedModel, download_model


class FakeResponse:
    def __init__(self, data: bytes, *, status: int = 200) -> None:
        self._data = data
        self._offset = 0
        self.status = status

    def read(self, size: int) -> bytes:
        chunk = self._data[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None


def _registry(monkeypatch: pytest.MonkeyPatch, content: bytes) -> ModelArtifact:
    artifact = ModelArtifact(
        url="https://huggingface.co/synthetic/model.gguf",
        filename="model.gguf",
        sha256=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
    )
    monkeypatch.setattr(
        model_manager,
        "MODEL_REGISTRY",
        (
            RecommendedModel(
                id="synthetic",
                display_name="Synthetic",
                preset="medium-3b",
                artifacts=(artifact,),
            ),
        ),
    )
    return artifact


def test_download_rejects_non_https_and_unknown_host(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="HTTPS"):
        download_model("http://huggingface.co/model.gguf", tmp_path / "model.gguf")
    with pytest.raises(ValueError, match="host"):
        download_model("https://example.com/model.gguf", tmp_path / "model.gguf")


def test_download_verifies_sha256_and_cleans_part_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content = b"synthetic verified model bytes"
    artifact = _registry(monkeypatch, content)
    monkeypatch.setattr(
        model_manager.urllib.request,
        "urlopen",
        lambda request, timeout: FakeResponse(content),
    )
    destination = tmp_path / artifact.filename
    assert download_model(artifact.url, destination) == destination
    assert destination.read_bytes() == content

    bad_destination = tmp_path / "bad.gguf"
    monkeypatch.setattr(
        model_manager.urllib.request,
        "urlopen",
        lambda request, timeout: FakeResponse(b"x" * len(content)),
    )
    with pytest.raises(ValueError, match="verification"):
        download_model(artifact.url, bad_destination)
    assert not bad_destination.with_name("bad.gguf.part").exists()


def test_download_resumes_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content = b"synthetic resumable model"
    artifact = _registry(monkeypatch, content)
    destination = tmp_path / artifact.filename
    partial = destination.with_name(destination.name + ".part")
    partial.write_bytes(content[:10])
    ranges: list[str | None] = []

    def open_range(request: Request, timeout: int) -> FakeResponse:
        del timeout
        ranges.append(request.get_header("Range"))
        return FakeResponse(content[10:], status=206)

    monkeypatch.setattr(model_manager.urllib.request, "urlopen", open_range)
    download_model(artifact.url, destination)
    assert ranges == ["bytes=10-"]
    assert destination.read_bytes() == content


@dataclass
class FakeProcess:
    command: list[str]
    returncode: int | None = None
    terminated: bool = False
    killed: bool = False

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout: float | None = None) -> int:
        del timeout
        return self.returncode or 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


@dataclass
class ProcessFactory:
    processes: list[FakeProcess] = field(default_factory=list)

    def __call__(self, command: list[str], **kwargs: Any) -> FakeProcess:
        del kwargs
        process = FakeProcess(command)
        self.processes.append(process)
        return process


def _server(tmp_path: Path, factory: ProcessFactory) -> LlamaServer:
    executable = tmp_path / "llama-server"
    executable.write_text("synthetic", encoding="utf-8")
    model = tmp_path / "model.gguf"
    model.write_bytes(b"synthetic")
    return LlamaServer(
        str(executable),
        model,
        port_factory=lambda: 43123,
        health_check=lambda url: url == "http://127.0.0.1:43123/health",
        process_factory=factory,
    )


def test_server_binds_loopback_only(tmp_path: Path) -> None:
    factory = ProcessFactory()
    server = _server(tmp_path, factory)
    status = server.start()
    command = factory.processes[0].command
    assert status.ready is True
    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert command[command.index("--port") + 1] == "43123"
    server.close()


def test_server_stops_on_close(tmp_path: Path) -> None:
    factory = ProcessFactory()
    server = _server(tmp_path, factory)
    server.start()
    server.close()
    assert factory.processes[0].terminated is True


def test_missing_executable_gives_plain_status(tmp_path: Path) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"synthetic")
    status = LlamaServer("definitely-missing-llama-server", model).start()
    assert status.ready is False
    assert status.message == "Narration engine not installed."
