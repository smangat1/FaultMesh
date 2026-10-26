"""Build a pinned pytest image and run a project without host execution."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from faultmesh.project_runner.config import ResolvedRunConfig, load_run_config
from faultmesh.project_runner.models import (
    ContainerEnvironment,
    EnvironmentIdentity,
    ProjectTestRun,
    PytestSummary,
    RunArtifacts,
    RunOutcome,
    RunTermination,
    TargetIdentity,
)
from faultmesh.project_runner.store import RunStore


class ProjectRunnerError(RuntimeError):
    pass


@dataclass(frozen=True)
class ContainerExecution:
    exit_code: int | None
    termination: RunTermination
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool


class _BoundedBuffer:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.data = bytearray()
        self.total = 0

    def read(self, stream: BinaryIO) -> None:
        while True:
            chunk = stream.read(65_536)
            if not chunk:
                return
            self.total += len(chunk)
            remaining = self.limit - len(self.data)
            if remaining > 0:
                self.data.extend(chunk[:remaining])

    @property
    def truncated(self) -> bool:
        return self.total > len(self.data)

    def text(self) -> str:
        return self.data.decode("utf-8", errors="replace")


class DockerClient:
    def preflight(self) -> str:
        if shutil.which("docker") is None:
            raise ProjectRunnerError("Docker CLI is not installed or not on PATH")
        completed = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            raise ProjectRunnerError(f"Docker daemon is unavailable: {detail}")
        version = completed.stdout.strip()
        if not version:
            raise ProjectRunnerError("Docker daemon returned no server version")
        return version

    @staticmethod
    def dockerfile(environment: ContainerEnvironment) -> str:
        install = [
            "python",
            "-m",
            "pip",
            "install",
            "--no-cache-dir",
            *environment.dependency_pins,
        ]
        return "\n".join(
            [
                f"FROM {environment.base_image}",
                f"RUN {json.dumps(install)}",
                "USER 65534:65534",
                "WORKDIR /workspace",
                "ENTRYPOINT []",
                "",
            ]
        )

    def prepare_image(self, environment: ContainerEnvironment, run_dir: Path) -> str:
        definition = self.dockerfile(environment)
        dockerfile = run_dir / "Dockerfile"
        dockerfile.write_text(definition, encoding="utf-8")
        key = hashlib.sha256(definition.encode()).hexdigest()[:16]
        tag = f"faultmesh-pytest:{key}"
        inspected = subprocess.run(
            ["docker", "image", "inspect", tag, "--format", "{{.Id}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if inspected.returncode == 0 and inspected.stdout.strip():
            return inspected.stdout.strip()
        built = subprocess.run(
            [
                "docker",
                "build",
                "--pull=false",
                "--file",
                str(dockerfile),
                "--tag",
                tag,
                str(run_dir),
            ],
            capture_output=True,
            text=True,
            timeout=900,
            check=False,
        )
        if built.returncode != 0:
            detail = (built.stderr or built.stdout)[-20_000:]
            raise ProjectRunnerError(f"container image build failed: {detail}")
        inspected = subprocess.run(
            ["docker", "image", "inspect", tag, "--format", "{{.Id}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        image_id = inspected.stdout.strip()
        if inspected.returncode != 0 or not image_id:
            raise ProjectRunnerError("built image could not be inspected")
        return image_id

    @staticmethod
    def run_command(
        resolved: ResolvedRunConfig,
        run_id: str,
        image_id: str,
        run_dir: Path,
    ) -> list[str]:
        config = resolved.config
        workdir = "/workspace"
        if config.test.working_directory != ".":
            workdir = f"/workspace/{config.test.working_directory}"
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            f"faultmesh-{run_id}",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            str(config.limits.pids),
            "--memory",
            config.limits.memory,
            "--cpus",
            str(config.limits.cpus),
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=128m",
            "--env",
            "HOME=/tmp",
            "--env",
            "PYTHONDONTWRITEBYTECODE=1",
        ]
        if config.test.pythonpath:
            pythonpath = ":".join(f"/workspace/{item}" for item in config.test.pythonpath)
            command.extend(["--env", f"PYTHONPATH={pythonpath}"])
        command.extend(
            [
            "--volume",
            f"{resolved.target_root}:/workspace:ro",
            "--volume",
            f"{run_dir}:/output:rw",
            "--workdir",
            workdir,
            image_id,
            *config.test.argv,
            "--json-report",
            "--json-report-file=/output/pytest-report.json",
            ]
        )
        return command

    def run(
        self,
        resolved: ResolvedRunConfig,
        run_id: str,
        image_id: str,
        run_dir: Path,
    ) -> ContainerExecution:
        command = self.run_command(resolved, run_id, image_id, run_dir)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None
        assert process.stderr is not None
        stdout = _BoundedBuffer(resolved.config.limits.max_output_bytes)
        stderr = _BoundedBuffer(resolved.config.limits.max_output_bytes)
        stdout_thread = threading.Thread(target=stdout.read, args=(process.stdout,), daemon=True)
        stderr_thread = threading.Thread(target=stderr.read, args=(process.stderr,), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        termination = RunTermination.EXITED
        exit_code: int | None
        try:
            exit_code = process.wait(timeout=resolved.config.limits.timeout_seconds)
        except subprocess.TimeoutExpired:
            termination = RunTermination.TIMEOUT
            exit_code = None
            self._stop_container(run_id, process)
        except KeyboardInterrupt:
            termination = RunTermination.CANCELLED
            exit_code = None
            self._stop_container(run_id, process)
        finally:
            stdout_thread.join(timeout=10)
            stderr_thread.join(timeout=10)
            subprocess.run(
                ["docker", "rm", "-f", f"faultmesh-{run_id}"],
                capture_output=True,
                timeout=20,
                check=False,
            )
        return ContainerExecution(
            exit_code=exit_code,
            termination=termination,
            stdout=stdout.text(),
            stderr=stderr.text(),
            stdout_truncated=stdout.truncated,
            stderr_truncated=stderr.truncated,
        )

    @staticmethod
    def _stop_container(run_id: str, process: subprocess.Popen[bytes]) -> None:
        subprocess.run(
            ["docker", "stop", "--time", "2", f"faultmesh-{run_id}"],
            capture_output=True,
            timeout=20,
            check=False,
        )
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


def _git(target: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(target), *arguments],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise ProjectRunnerError(
            f"target Git query failed ({' '.join(arguments)}): {completed.stderr.strip()}"
        )
    return completed.stdout.strip()


def _content_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = path.relative_to(root)
        if ".git" in relative.parts:
            continue
        encoded = relative.as_posix().encode()
        if path.is_symlink():
            digest.update(b"L\0" + encoded + b"\0" + os.readlink(path).encode() + b"\0")
        elif path.is_file():
            digest.update(b"F\0" + encoded + b"\0")
            with path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b"\0")
    return digest.hexdigest()


def _target_identity(resolved: ResolvedRunConfig) -> TargetIdentity:
    revision = _git(resolved.target_root, "rev-parse", "HEAD")
    if revision != resolved.config.revision:
        raise ProjectRunnerError(
            f"target revision mismatch: expected {resolved.config.revision}, found {revision}"
        )
    status = _git(resolved.target_root, "status", "--porcelain=v1", "--untracked-files=all")
    origin = subprocess.run(
        ["git", "-C", str(resolved.target_root), "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    return TargetIdentity(
        root_name=resolved.target_root.name,
        origin_url=origin.stdout.strip() if origin.returncode == 0 else None,
        revision=revision,
        dirty=bool(status),
        content_sha256=_content_hash(resolved.target_root),
    )


def parse_pytest_report(path: Path, exit_code: int) -> tuple[PytestSummary, RunOutcome]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ProjectRunnerError(f"pytest report is missing or malformed: {exc}") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("summary"), dict):
        raise ProjectRunnerError("pytest report does not contain a summary object")
    report_exit = raw.get("exitcode")
    if report_exit != exit_code:
        raise ProjectRunnerError(
            f"pytest report exit code {report_exit!r} does not match process {exit_code}"
        )
    values = raw["summary"]

    def count(name: str) -> int | None:
        value = values.get(name)
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    summary = PytestSummary(
        collected=count("collected") if count("collected") is not None else count("total"),
        passed=count("passed"),
        failed=count("failed"),
        skipped=count("skipped"),
        errors=count("error") if count("error") is not None else count("errors"),
        xfailed=count("xfailed"),
        xpassed=count("xpassed"),
    )
    if exit_code == 0:
        if summary.collected in {None, 0}:
            return summary, RunOutcome.NO_TESTS
        return summary, RunOutcome.PASSED
    if exit_code == 1:
        return summary, RunOutcome.FAILED
    if exit_code == 5:
        return summary, RunOutcome.NO_TESTS
    if exit_code in {2, 3, 4}:
        return summary, RunOutcome.COLLECTION_ERROR
    return summary, RunOutcome.INFRASTRUCTURE_ERROR


class ProjectTestRunner:
    def __init__(self, docker: DockerClient | None = None) -> None:
        self.docker = docker or DockerClient()

    def run(self, config_path: Path) -> ProjectTestRun:
        resolved = load_run_config(config_path)
        before = _target_identity(resolved)
        run_id = f"run-{uuid4().hex[:12]}"
        run_dir = resolved.artifact_root / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        started = datetime.now(UTC)
        monotonic_start = time.monotonic()
        stdout = ""
        stderr = ""
        stdout_truncated = False
        stderr_truncated = False
        exit_code: int | None = None
        summary: PytestSummary | None = None
        termination = RunTermination.INFRASTRUCTURE
        outcome = RunOutcome.INFRASTRUCTURE_ERROR
        error: str | None = None
        image_id: str | None = None
        docker_version: str | None = None
        dockerfile = run_dir / "Dockerfile"
        dockerfile.write_text(
            self.docker.dockerfile(resolved.config.environment), encoding="utf-8"
        )
        (run_dir / "config.json").write_text(
            resolved.config.model_dump_json(indent=2), encoding="utf-8"
        )
        try:
            docker_version = self.docker.preflight()
            image_id = self.docker.prepare_image(resolved.config.environment, run_dir)
            execution = self.docker.run(resolved, run_id, image_id, run_dir)
            exit_code = execution.exit_code
            termination = execution.termination
            stdout = execution.stdout
            stderr = execution.stderr
            stdout_truncated = execution.stdout_truncated
            stderr_truncated = execution.stderr_truncated
            if termination == RunTermination.TIMEOUT:
                outcome = RunOutcome.TIMEOUT
                error = f"test command exceeded {resolved.config.limits.timeout_seconds} seconds"
            elif termination == RunTermination.CANCELLED:
                outcome = RunOutcome.CANCELLED
                error = "test run was cancelled"
            elif exit_code is None:
                outcome = RunOutcome.INFRASTRUCTURE_ERROR
                error = "container exited without a process status"
            else:
                try:
                    summary, outcome = parse_pytest_report(
                        run_dir / "pytest-report.json", exit_code
                    )
                except ProjectRunnerError as exc:
                    outcome = RunOutcome.MALFORMED_REPORT
                    error = str(exc)
        except (OSError, subprocess.SubprocessError, ProjectRunnerError) as exc:
            error = str(exc)
        finished = datetime.now(UTC)
        after = _target_identity(resolved)
        if after != before:
            outcome = RunOutcome.INFRASTRUCTURE_ERROR
            termination = RunTermination.INFRASTRUCTURE
            error = "target checkout changed during the container run"
        stdout_path = run_dir / "stdout.txt"
        stderr_path = run_dir / "stderr.txt"
        stdout_path.write_text(stdout, encoding="utf-8")
        stderr_path.write_text(stderr, encoding="utf-8")
        relative_dir = run_dir.relative_to(resolved.artifact_root)
        report_path = run_dir / "pytest-report.json"
        artifacts = RunArtifacts(
            directory=relative_dir.as_posix(),
            run_record=(relative_dir / "run.json").as_posix(),
            config=(relative_dir / "config.json").as_posix(),
            stdout=(relative_dir / "stdout.txt").as_posix(),
            stderr=(relative_dir / "stderr.txt").as_posix(),
            pytest_report=(
                (relative_dir / "pytest-report.json").as_posix()
                if report_path.is_file()
                else None
            ),
            dockerfile=(relative_dir / "Dockerfile").as_posix(),
        )
        run = ProjectTestRun(
            id=run_id,
            config_version=resolved.config.schema_version,
            target=before,
            command=[
                *resolved.config.test.argv,
                "--json-report",
                "--json-report-file=/output/pytest-report.json",
            ],
            working_directory=resolved.config.test.working_directory,
            limits=resolved.config.limits,
            environment=EnvironmentIdentity(
                base_image=resolved.config.environment.base_image,
                resolved_image_id=image_id,
                registry_digest=None,
                dependency_pins=resolved.config.environment.dependency_pins,
                docker_server_version=docker_version,
            ),
            started_at=started,
            finished_at=finished,
            duration_ms=int((time.monotonic() - monotonic_start) * 1000),
            exit_code=exit_code,
            termination=termination,
            outcome=outcome,
            summary=summary,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
            error=error,
            artifacts=artifacts,
        )
        (run_dir / "run.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")
        with RunStore(resolved.artifact_root / "runs.sqlite3") as store:
            store.add(run)
        return run


def run_project_tests(config_path: Path | str) -> ProjectTestRun:
    return ProjectTestRunner().run(Path(config_path))
