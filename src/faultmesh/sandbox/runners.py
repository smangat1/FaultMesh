"""Execution policies for the isolated verification worker."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Protocol

from faultmesh.schemas import ExperimentOutcome, ExperimentResult, VerificationManifest


class SandboxError(RuntimeError):
    pass


class SandboxRunner(Protocol):
    name: str

    def run(self, repository: Path, manifest: VerificationManifest) -> ExperimentResult: ...


def _timeout_text(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _parse_result(
    completed: subprocess.CompletedProcess[str], manifest: VerificationManifest
) -> ExperimentResult:
    if completed.returncode != 0:
        return ExperimentResult(
            hypothesis_id=manifest.hypothesis_id,
            outcome=ExperimentOutcome.ENVIRONMENT_ERROR,
            observed=f"verification worker exited with status {completed.returncode}",
            expected=manifest.property_spec.oracle_explanation,
            stdout=completed.stdout[-10_000:],
            stderr=completed.stderr[-10_000:],
            seed=manifest.property_spec.seed,
        )
    try:
        return ExperimentResult.model_validate_json(completed.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError) as exc:
        raise SandboxError(f"verification worker returned invalid JSON: {exc}") from exc


class LocalSubprocessSandbox:
    """Best-effort resource-limited host runner for explicitly trusted repositories only."""

    name = "local-subprocess-UNSAFE"

    def __init__(self, *, timeout_seconds: int = 30) -> None:
        self.timeout_seconds = timeout_seconds

    def run(self, repository: Path, manifest: VerificationManifest) -> ExperimentResult:
        with tempfile.TemporaryDirectory(prefix="faultmesh-job-") as temporary:
            manifest_path = Path(temporary) / "manifest.json"
            manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
            command = [
                sys.executable,
                "-I",
                "-m",
                "faultmesh.verification.worker",
                "--repository",
                str(repository.resolve()),
                "--manifest",
                str(manifest_path),
            ]
            environment = {
                "PATH": os.environ.get("PATH", ""),
                "LANG": os.environ.get("LANG", "C.UTF-8"),
                "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
                "PYTHONHASHSEED": "0",
            }
            try:
                completed = subprocess.run(
                    command,
                    cwd=repository,
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return ExperimentResult(
                    hypothesis_id=manifest.hypothesis_id,
                    outcome=ExperimentOutcome.TIMEOUT,
                    observed=f"verification exceeded {self.timeout_seconds} seconds",
                    expected=manifest.property_spec.oracle_explanation,
                    stdout=_timeout_text(exc.stdout)[-10_000:],
                    stderr=_timeout_text(exc.stderr)[-10_000:],
                    seed=manifest.property_spec.seed,
                )
            return _parse_result(completed, manifest)


class DockerSandbox:
    name = "docker"

    def __init__(
        self,
        *,
        image: str = "faultmesh-sandbox:0.1.0",
        timeout_seconds: int = 30,
        memory: str = "512m",
        cpus: str = "1.0",
    ) -> None:
        self.image = image
        self.timeout_seconds = timeout_seconds
        self.memory = memory
        self.cpus = cpus

    @staticmethod
    def available() -> bool:
        return shutil.which("docker") is not None

    def run(self, repository: Path, manifest: VerificationManifest) -> ExperimentResult:
        if not self.available():
            raise SandboxError(
                "Docker is unavailable. For a trusted repository only, rerun with "
                "--allow-local-execution."
            )
        job_root = repository.resolve() / ".faultmesh"
        job_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="docker-job-", dir=job_root
        ) as temporary:
            manifest_path = Path(temporary) / "manifest.json"
            manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
            command = [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--pids-limit",
                "64",
                "--memory",
                self.memory,
                "--cpus",
                self.cpus,
                "--user",
                "65534:65534",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=64m",
                "--volume",
                f"{repository.resolve()}:/workspace:ro",
                "--volume",
                f"{manifest_path.resolve()}:/job/manifest.json:ro",
                "--workdir",
                "/workspace",
                self.image,
                "python",
                "-I",
                "-m",
                "faultmesh.verification.worker",
                "--repository",
                "/workspace",
                "--manifest",
                "/job/manifest.json",
            ]
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return ExperimentResult(
                    hypothesis_id=manifest.hypothesis_id,
                    outcome=ExperimentOutcome.TIMEOUT,
                    observed=f"Docker verification exceeded {self.timeout_seconds} seconds",
                    expected=manifest.property_spec.oracle_explanation,
                    stdout=_timeout_text(exc.stdout)[-10_000:],
                    stderr=_timeout_text(exc.stderr)[-10_000:],
                    seed=manifest.property_spec.seed,
                )
            return _parse_result(completed, manifest)

