"""Versioned contracts for isolated project test runs."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RUN_CONFIG_VERSION: Literal["2.0"] = "2.0"
RUN_RECORD_VERSION: Literal["2.0"] = "2.0"
TEST_RECORD_VERSION: Literal["2.0"] = "2.0"
EXPORT_VERSION: Literal["2.0"] = "2.0"

_PIN = re.compile(r"^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9_.+!-]+$")
_IMAGE = re.compile(r"^[A-Za-z0-9./:_-]+@sha256:[0-9a-f]{64}$")
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_MEMORY = re.compile(r"^[1-9][0-9]*(?:m|g)$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


def _safe_relative(value: str, label: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts or normalized in {"", "."}:
        if normalized == "." and label == "working_directory":
            return normalized
        raise ValueError(f"{label} must be a non-empty relative path without '..'")
    return str(path)


class ContainerEnvironment(StrictModel):
    base_image: str
    dependency_pins: list[str] = Field(min_length=1)

    @field_validator("base_image")
    @classmethod
    def pinned_image(cls, value: str) -> str:
        if not _IMAGE.fullmatch(value):
            raise ValueError("base_image must include a full sha256 registry digest")
        return value

    @field_validator("dependency_pins")
    @classmethod
    def pinned_dependencies(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("dependency_pins must not contain duplicates")
        for value in values:
            if not _PIN.fullmatch(value):
                raise ValueError(
                    "dependency pins must use a simple name==version form; "
                    f"unsupported value: {value}"
                )
        return values


class TestCommand(StrictModel):
    argv: list[str] = Field(min_length=3)
    working_directory: str = "."
    pythonpath: list[str] = Field(default_factory=list)

    @field_validator("argv")
    @classmethod
    def pytest_argv(cls, values: list[str]) -> list[str]:
        if values[:3] != ["python", "-m", "pytest"]:
            raise ValueError("argv must begin with: python -m pytest")
        forbidden = ("--json-report", "--json-report-file", "--basetemp")
        for value in values:
            if "\x00" in value:
                raise ValueError("argv must not contain NUL bytes")
            if value.startswith(forbidden):
                raise ValueError(f"FaultMesh owns pytest output option: {value}")
        return values

    @field_validator("working_directory")
    @classmethod
    def relative_workdir(cls, value: str) -> str:
        return _safe_relative(value, "working_directory")

    @field_validator("pythonpath")
    @classmethod
    def relative_pythonpath(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("pythonpath entries must not contain duplicates")
        return [_safe_relative(value, "pythonpath") for value in values]


class RunLimits(StrictModel):
    timeout_seconds: Annotated[int, Field(ge=1, le=3600)] = 300
    memory: str = "512m"
    cpus: Annotated[float, Field(gt=0, le=8)] = 1.0
    pids: Annotated[int, Field(ge=16, le=1024)] = 128
    max_output_bytes: Annotated[int, Field(ge=1024, le=10_000_000)] = 1_000_000
    max_evidence_bytes: Annotated[int, Field(ge=1024, le=50_000_000)] = 10_000_000

    @field_validator("memory")
    @classmethod
    def valid_memory(cls, value: str) -> str:
        if not _MEMORY.fullmatch(value):
            raise ValueError("memory must look like 512m or 1g")
        return value


class ProjectRunConfig(StrictModel):
    schema_version: Literal["1.0", "2.0"] = RUN_CONFIG_VERSION
    target_root: str
    revision: str
    artifact_root: str = ".faultmesh-v1"
    environment: ContainerEnvironment
    test: TestCommand
    limits: RunLimits = Field(default_factory=RunLimits)

    @field_validator("target_root")
    @classmethod
    def relative_target(cls, value: str) -> str:
        return _safe_relative(value, "target_root")

    @field_validator("artifact_root")
    @classmethod
    def relative_artifacts(cls, value: str) -> str:
        return _safe_relative(value, "artifact_root")

    @field_validator("revision")
    @classmethod
    def full_revision(cls, value: str) -> str:
        if not _REVISION.fullmatch(value):
            raise ValueError("revision must be a full 40-character lowercase commit SHA")
        return value

    @model_validator(mode="after")
    def separate_output(self) -> ProjectRunConfig:
        target = PurePosixPath(self.target_root)
        output = PurePosixPath(self.artifact_root)
        if output == target or target in output.parents or output in target.parents:
            raise ValueError("artifact_root and target_root must be separate paths")
        return self


class RunOutcome(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    COLLECTION_ERROR = "COLLECTION_ERROR"
    INFRASTRUCTURE_ERROR = "INFRASTRUCTURE_ERROR"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    MALFORMED_REPORT = "MALFORMED_REPORT"
    NO_TESTS = "NO_TESTS"


class RunTermination(StrEnum):
    EXITED = "EXITED"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    INFRASTRUCTURE = "INFRASTRUCTURE"


class PytestSummary(StrictModel):
    collected: int | None = Field(default=None, ge=0)
    passed: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    skipped: int | None = Field(default=None, ge=0)
    errors: int | None = Field(default=None, ge=0)
    xfailed: int | None = Field(default=None, ge=0)
    xpassed: int | None = Field(default=None, ge=0)


class TargetIdentity(StrictModel):
    root_name: str
    origin_url: str | None = None
    revision: str
    dirty: bool
    content_sha256: str


class EnvironmentIdentity(StrictModel):
    base_image: str
    resolved_image_id: str | None = None
    registry_digest: str | None = None
    dependency_pins: list[str]
    installed_packages: list[str] | None = None
    docker_server_version: str | None = None


class RunArtifacts(StrictModel):
    directory: str
    run_record: str
    config: str
    stdout: str
    stderr: str
    pytest_report: str | None = None
    dockerfile: str
    tests: str | None = None
    observation_report: str | None = None
    source_snapshot: str | None = None


class TestPhase(StrEnum):
    SETUP = "setup"
    CALL = "call"
    TEARDOWN = "teardown"


class TestOutcome(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    ERROR = "ERROR"
    SKIPPED = "SKIPPED"
    XFAILED = "XFAILED"
    XPASSED = "XPASSED"
    UNKNOWN = "UNKNOWN"


class ObservationStatus(StrEnum):
    COMPLETE = "COMPLETE"
    NOT_REQUESTED = "NOT_REQUESTED"
    INCOMPLETE = "INCOMPLETE"
    INSTRUMENTATION_ERROR = "INSTRUMENTATION_ERROR"
    UNSUPPORTED = "UNSUPPORTED"


class MappingStatus(StrEnum):
    MAPPED = "MAPPED"
    UNMAPPED = "UNMAPPED"
    OUTSIDE_ROOT = "OUTSIDE_ROOT"
    PARSE_ERROR = "PARSE_ERROR"
    UNKNOWN_CONTEXT = "UNKNOWN_CONTEXT"


class TestPhaseResult(StrictModel):
    phase: TestPhase
    outcome: TestOutcome
    duration_ms: Annotated[float, Field(ge=0)] = 0.0
    failure_text: str | None = None
    failure_truncated: bool = False


class ObservedLine(StrictModel):
    line: Annotated[int, Field(ge=1)]
    phases: list[TestPhase] = Field(min_length=1)

    @field_validator("phases")
    @classmethod
    def unique_phases(cls, value: list[TestPhase]) -> list[TestPhase]:
        if len(value) != len(set(value)):
            raise ValueError("observed line phases must be unique")
        return value


class ObservedFile(StrictModel):
    path: str
    content_sha256: str
    lines: list[ObservedLine]
    mapping_status: MappingStatus = MappingStatus.MAPPED

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        return _safe_relative(value, "observed path")


class ObservedSymbol(StrictModel):
    evidence_type: Literal["TEST_EXECUTED_SYMBOL"] = "TEST_EXECUTED_SYMBOL"
    path: str
    content_sha256: str
    qualified_name: str
    start_line: Annotated[int, Field(ge=1)]
    end_line: Annotated[int, Field(ge=1)]
    executed_lines: list[Annotated[int, Field(ge=1)]]
    phases: list[TestPhase]

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        return _safe_relative(value, "symbol path")


class CollectionObservedFile(StrictModel):
    path: str
    content_sha256: str
    lines: list[Annotated[int, Field(ge=1)]]

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        return _safe_relative(value, "collection path")


class TestObservation(StrictModel):
    status: ObservationStatus
    instrumentation_version: str
    source_revision: str
    source_content_sha256: str
    files: list[ObservedFile] = Field(default_factory=list)
    symbols: list[ObservedSymbol] = Field(default_factory=list)
    unmapped: list[ObservedFile] = Field(default_factory=list)
    outside_root_files: int = Field(default=0, ge=0)
    unknown_contexts: list[str] = Field(default_factory=list)
    error: str | None = None


class TestCaseRecord(StrictModel):
    schema_version: Literal["2.0"] = TEST_RECORD_VERSION
    run_id: str
    node_id: str = Field(min_length=1, max_length=4096)
    outcome: TestOutcome
    phases: list[TestPhaseResult]
    duration_ms: Annotated[float, Field(ge=0)] = 0.0
    failure_text: str | None = None
    failure_truncated: bool = False
    failure_fingerprint: str | None = None
    observation: TestObservation | None = None


class SourceSymbolSnapshot(StrictModel):
    path: str
    qualified_name: str
    kind: Literal["function", "method", "async_function", "async_method"]
    start_line: Annotated[int, Field(ge=1)]
    end_line: Annotated[int, Field(ge=1)]
    executable_lines: list[Annotated[int, Field(ge=1)]]

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        return _safe_relative(value, "snapshot symbol path")


class SourceFileSnapshot(StrictModel):
    path: str
    content_sha256: str
    line_count: Annotated[int, Field(ge=0)]
    parse_error: str | None = None
    symbols: list[SourceSymbolSnapshot] = Field(default_factory=list)

    @field_validator("path")
    @classmethod
    def relative_path(cls, value: str) -> str:
        return _safe_relative(value, "snapshot path")


class SourceSnapshot(StrictModel):
    schema_version: Literal["2.0"] = RUN_RECORD_VERSION
    revision: str
    content_sha256: str
    files: list[SourceFileSnapshot]


class ReplayComparison(StrEnum):
    SAME_FAILURE = "SAME_FAILURE"
    DIFFERENT_FAILURE = "DIFFERENT_FAILURE"
    PASSED_ON_REPLAY = "PASSED_ON_REPLAY"
    MISSING_OR_DESELECTED = "MISSING_OR_DESELECTED"
    INCONCLUSIVE = "INCONCLUSIVE"


class ReplayProvenance(StrictModel):
    parent_run_id: str
    parent_test_id: str
    original_failure_fingerprint: str
    original_installed_packages: list[str] | None = None
    comparison: ReplayComparison | None = None


class ProjectTestRun(StrictModel):
    schema_version: Literal["2.0"] = RUN_RECORD_VERSION
    id: str
    config_version: str
    target: TargetIdentity
    command: list[str]
    working_directory: str
    limits: RunLimits
    environment: EnvironmentIdentity
    started_at: datetime
    finished_at: datetime
    duration_ms: int = Field(ge=0)
    exit_code: int | None = None
    termination: RunTermination
    outcome: RunOutcome
    summary: PytestSummary | None = None
    stdout_truncated: bool = False
    stderr_truncated: bool = False
    error: str | None = None
    artifacts: RunArtifacts
    observation_requested: bool = False
    observation_status: ObservationStatus = ObservationStatus.NOT_REQUESTED
    test_case_count: int = Field(default=0, ge=0)
    replay: ReplayProvenance | None = None
    collection_observation: list[CollectionObservedFile] = Field(default_factory=list)


class RunEvidenceExport(StrictModel):
    schema_version: Literal["2.0"] = EXPORT_VERSION
    run: ProjectTestRun
    tests: list[TestCaseRecord]
    source_snapshot: SourceSnapshot | None = None
    missing_artifacts: list[str] = Field(default_factory=list)
