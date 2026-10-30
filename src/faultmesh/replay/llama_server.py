"""Managed loopback-only llama-server lifecycle for local replay narration."""

from __future__ import annotations

import atexit
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict


class _Process(Protocol):
    def poll(self) -> int | None: ...
    def terminate(self) -> None: ...
    def wait(self, timeout: float | None = None) -> int: ...
    def kill(self) -> None: ...


class LlamaServerStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    message: str
    endpoint: str | None = None
    port: int | None = None


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _health_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as response:  # noqa: S310
            status = getattr(response, "status", None)
            return isinstance(status, int) and status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


class LlamaServer:
    def __init__(
        self,
        executable: str,
        model_path: Path,
        *,
        context_size: int = 8_192,
        startup_timeout: float = 60,
        port_factory: Callable[[], int] = _free_loopback_port,
        health_check: Callable[[str], bool] = _health_ready,
        process_factory: Callable[..., _Process] | None = None,
    ) -> None:
        self.executable = executable
        self.model_path = model_path.expanduser().resolve()
        self.context_size = context_size
        self.startup_timeout = startup_timeout
        self._port_factory = port_factory
        self._health_check = health_check
        self._process_factory = process_factory or subprocess.Popen
        self._process: _Process | None = None
        self._status = LlamaServerStatus(ready=False, message="Narration engine is stopped.")
        atexit.register(self.stop)

    @property
    def status(self) -> LlamaServerStatus:
        return self._status

    def start(self) -> LlamaServerStatus:
        if self._process is not None and self._process.poll() is None:
            return self._status
        executable = (
            str(Path(self.executable).resolve())
            if Path(self.executable).is_file()
            else shutil.which(self.executable)
        )
        if executable is None:
            self._status = LlamaServerStatus(
                ready=False, message="Narration engine not installed."
            )
            return self._status
        if not self.model_path.is_file():
            self._status = LlamaServerStatus(
                ready=False, message="The selected narration model could not be found."
            )
            return self._status
        port = self._port_factory()
        command = [
            executable,
            "--model",
            str(self.model_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--ctx-size",
            str(self.context_size),
            "--no-webui",
        ]
        try:
            self._process = self._process_factory(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
            )
        except OSError:
            self._status = LlamaServerStatus(
                ready=False, message="Narration engine could not be started."
            )
            return self._status
        health_url = f"http://127.0.0.1:{port}/health"
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                self._status = LlamaServerStatus(
                    ready=False, message="Narration engine stopped during startup."
                )
                return self._status
            if self._health_check(health_url):
                self._status = LlamaServerStatus(
                    ready=True,
                    message="Local narration engine is ready.",
                    endpoint=f"http://127.0.0.1:{port}/v1/chat/completions",
                    port=port,
                )
                return self._status
            time.sleep(0.05)
        self.stop()
        self._status = LlamaServerStatus(
            ready=False, message="Narration engine did not become ready in time."
        )
        return self._status

    def stop(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        self._status = LlamaServerStatus(ready=False, message="Narration engine is stopped.")

    close = stop

    def __enter__(self) -> LlamaServer:
        return self

    def __exit__(self, *args: object) -> None:
        self.stop()
