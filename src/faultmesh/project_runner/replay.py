"""Read, export, and replay one recorded pytest failure."""

from __future__ import annotations

from pathlib import Path

from faultmesh.project_runner.config import load_run_config, load_stored_run_config
from faultmesh.project_runner.models import (
    ProjectTestRun,
    ReplayProvenance,
    RunEvidenceExport,
    SourceSnapshot,
    TestCaseRecord,
    TestOutcome,
)
from faultmesh.project_runner.observation import ObservationError, read_json_artifact
from faultmesh.project_runner.runner import (
    ProjectRunnerError,
    ProjectTestRunner,
    _effective_environment,
    _target_identity,
)
from faultmesh.project_runner.store import RunStore


def open_run_store(config_path: Path | str) -> RunStore:
    stored = load_stored_run_config(Path(config_path))
    return RunStore(stored.artifact_root / "runs.sqlite3")


def export_run(config_path: Path | str, run_id: str) -> RunEvidenceExport:
    stored = load_stored_run_config(Path(config_path))
    with RunStore(stored.artifact_root / "runs.sqlite3") as store:
        run = store.get(run_id)
        tests = store.list_tests(run_id)
    if len(tests) != run.test_case_count:
        raise ProjectRunnerError("stored test count does not match the run record")
    snapshot = None
    missing: list[str] = []
    if run.artifacts.source_snapshot is not None:
        run_dir = stored.artifact_root / run.artifacts.directory
        try:
            raw = read_json_artifact(
                stored.artifact_root / run.artifacts.source_snapshot,
                run_dir,
                run.limits.max_evidence_bytes,
            )
            snapshot = SourceSnapshot.model_validate(raw)
        except (ObservationError, ValueError) as exc:
            missing.append(str(exc))
    elif run.observation_requested:
        missing.append("run has no source snapshot artifact reference")
    return RunEvidenceExport(
        run=run, tests=tests, source_snapshot=snapshot, missing_artifacts=missing
    )


def get_test_case(config_path: Path | str, run_id: str, node_id: str) -> TestCaseRecord:
    with open_run_store(config_path) as store:
        return store.get_test(run_id, node_id)


def replay_argv(command: list[str], node_id: str) -> list[str]:
    if command[:3] != ["python", "-m", "pytest"]:
        raise ProjectRunnerError("recorded command is not a supported pytest argv")
    safe_flags = {
        "-q",
        "-v",
        "-vv",
        "-s",
        "-x",
        "--disable-warnings",
        "--strict-markers",
    }
    safe_prefixes = ("--tb=", "--color=", "--capture=", "--maxfail=")
    result = command[:3]
    index = 3
    while index < len(command):
        value = command[index]
        if value in {"--json-report"} or value.startswith("--json-report-file="):
            index += 1
            continue
        if value == "-p":
            if index + 1 >= len(command) or command[index + 1] != "faultmesh_observer":
                raise ProjectRunnerError("recorded custom pytest plugins cannot be replayed safely")
            index += 2
            continue
        if value in safe_flags or value.startswith(safe_prefixes):
            result.append(value)
            index += 1
            continue
        if value.startswith("-"):
            raise ProjectRunnerError(f"recorded pytest option cannot be replayed safely: {value}")
        # Positional suite and node selectors are replaced by the exact recorded node.
        index += 1
    result.append(node_id)
    return result


def replay_failed_test(
    config_path: Path | str,
    parent_run_id: str,
    node_id: str,
    *,
    runner: ProjectTestRunner | None = None,
) -> ProjectTestRun:
    path = Path(config_path)
    with open_run_store(path) as store:
        parent = store.get(parent_run_id)
        original = store.get_test(parent_run_id, node_id)
    if original.outcome not in {TestOutcome.FAILED, TestOutcome.ERROR}:
        raise ProjectRunnerError("only a recorded failed or erroring test can be replayed")
    if original.failure_fingerprint is None:
        raise ProjectRunnerError("recorded test has no failure fingerprint")
    if not parent.observation_requested:
        raise ProjectRunnerError("the parent run has no V2 observation evidence")
    if parent.environment.resolved_image_id is None:
        raise ProjectRunnerError("the parent run has no immutable local image ID")

    resolved = load_run_config(path)
    current = _target_identity(resolved)
    if current.revision != parent.target.revision:
        raise ProjectRunnerError(
            "checkout revision mismatch: "
            f"expected {parent.target.revision}, found {current.revision}"
        )
    if current.content_sha256 != parent.target.content_sha256:
        raise ProjectRunnerError("checkout content hash differs from the recorded parent run")
    environment = _effective_environment(resolved.config.environment, True)
    if environment.base_image != parent.environment.base_image:
        raise ProjectRunnerError("configured base image differs from the recorded parent run")
    if environment.dependency_pins != parent.environment.dependency_pins:
        raise ProjectRunnerError("dependency inputs differ from the recorded parent run")

    argv = replay_argv(parent.command, node_id)
    provenance = ReplayProvenance(
        parent_run_id=parent_run_id,
        parent_test_id=node_id,
        original_failure_fingerprint=original.failure_fingerprint,
        original_installed_packages=parent.environment.installed_packages,
    )
    active_runner = runner or ProjectTestRunner()
    return active_runner.run(
        path,
        observe=True,
        argv=argv,
        replay=provenance,
        required_image_id=parent.environment.resolved_image_id,
    )
