"""Versioned contracts for local capture and replay evidence."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

REPLAY_SCHEMA_VERSION = "replay-store-1.0"
CAPTURE_SCHEMA_VERSION = "replay-capture-1.0"
EXPORT_SCHEMA_VERSION = "replay-export-1.0"


class ReplayModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CaptureLimits(ReplayModel):
    max_files: int = Field(default=2_000, ge=1, le=100_000)
    max_file_bytes: int = Field(default=512 * 1024, ge=1, le=32 * 1024 * 1024)
    max_snapshot_bytes: int = Field(default=32 * 1024 * 1024, ge=1)
    max_store_bytes: int = Field(default=512 * 1024 * 1024, ge=1)
    max_text_field_bytes: int = Field(default=64 * 1024, ge=128, le=4 * 1024 * 1024)


class SessionStatus(StrEnum):
    ACTIVE = "active"
    STOPPED = "stopped"


class RecordKind(StrEnum):
    INITIAL_SNAPSHOT = "initial_snapshot"
    PRE_TOOL = "pre_tool"
    POST_TOOL = "post_tool"
    CHECKPOINT = "checkpoint"
    GAP = "gap"
    UNSUPPORTED = "unsupported"


class AttributionStatus(StrEnum):
    NOT_APPLICABLE = "not_applicable"
    TOOL_BOUNDARY = "tool_boundary"
    OBSERVED_CHECKPOINT = "observed_checkpoint"
    UNKNOWN = "unknown"


class Completeness(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    MISSING = "missing"
    UNSUPPORTED = "unsupported"


class ImportSource(StrEnum):
    CODEX = "codex"
    CLAUDE_CODE = "claude_code"


class TestState(StrEnum):
    PASSED = "pass"
    FAILED = "fail"
    ERROR = "error"
    SKIPPED = "skipped"
    NOT_OBSERVED = "not_observed"
    INCOMPLETE = "incomplete"


class TestAssociation(StrEnum):
    CONTENT_IDENTITY = "content_identity"
    CONTROLLED_NO_WRITE = "controlled_no_write"
    NEARBY_UNVERIFIED = "nearby_in_time_state_unverified"
    NONE = "none"


class SkipReason(StrEnum):
    IGNORED_DIRECTORY = "ignored_directory"
    IGNORED_ARTIFACT = "ignored_artifact"
    SECRET_LIKE_NAME = "secret_like_name"
    SYMLINK = "symlink"
    NON_PYTHON_SOURCE = "non_python_source"
    NON_UTF8 = "non_utf8"
    BINARY = "binary"
    FILE_TOO_LARGE = "file_too_large"
    SNAPSHOT_LIMIT = "snapshot_limit"
    FILE_LIMIT = "file_limit"
    CHANGED_DURING_READ = "changed_during_read"
    READ_ERROR = "read_error"


class SkippedPath(ReplayModel):
    path: str
    reason: SkipReason | str
    detail: str | None = None

    @field_validator("path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("path must be project-relative")
        return value


class CapturedFile(ReplayModel):
    path: str
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)
    mtime_ns: int = Field(ge=0)
    parse_ok: bool
    parse_error: str | None = None

    @field_validator("path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("path must be project-relative")
        return value


class SnapshotManifest(ReplayModel):
    schema_version: Literal["replay-store-1.0"] = "replay-store-1.0"
    id: str = Field(pattern=r"^manifest:[0-9a-f]{64}$")
    files: list[CapturedFile]
    skipped: list[SkippedPath] = Field(default_factory=list)
    partial: bool = False

    @model_validator(mode="after")
    def unique_paths(self) -> SnapshotManifest:
        paths = [item.path for item in self.files]
        if len(paths) != len(set(paths)):
            raise ValueError("manifest file paths must be unique")
        return self


class CaptureFilePayload(ReplayModel):
    path: str
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)
    mtime_ns: int = Field(ge=0)
    content_base64: str

    @field_validator("path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("path must be project-relative")
        return value


class CaptureEnvelope(ReplayModel):
    schema_version: Literal["replay-capture-1.0"] = "replay-capture-1.0"
    record_id: str
    record_type: RecordKind
    source_sequence: int | None = Field(default=None, ge=0)
    source_timestamp: datetime | None = None
    captured_at: datetime
    project_root_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    codex_version: str
    session_id: str
    turn_id: str | None = None
    tool_use_id: str | None = None
    tool_name: str | None = None
    files: list[CaptureFilePayload] = Field(default_factory=list)
    skipped: list[SkippedPath] = Field(default_factory=list)
    partial: bool = False
    truncated: bool = False
    raw_tool_input: object | None = None
    raw_tool_response: object | None = None
    redaction_applied: bool = False
    gap_reason: str | None = None


class ReplaySession(ReplayModel):
    schema_version: Literal["replay-store-1.0"] = "replay-store-1.0"
    id: str
    created_at: datetime
    stopped_at: datetime | None = None
    status: SessionStatus
    project_root_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    codex_version: str
    raw_logging: bool = False
    limits: CaptureLimits
    import_source: ImportSource | None = Field(
        default=None,
        description="History provider for an imported read-only session.",
    )
    format_version: str | None = Field(
        default=None,
        description="Source format version reported by the history provider.",
    )
    source_file_sha256: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
        description="Digest of the local source log; its private path is never exported.",
    )


class ReplayRecord(ReplayModel):
    schema_version: Literal["replay-store-1.0"] = "replay-store-1.0"
    id: str
    session_id: str
    sequence: int = Field(ge=1)
    source_identity: str
    source_offset: int = Field(ge=0)
    source_sequence: int | None = Field(default=None, ge=0)
    record_type: RecordKind
    captured_at: datetime
    source_timestamp: datetime | None = None
    provenance: str
    completeness: Completeness
    attribution_status: AttributionStatus
    turn_id: str | None = None
    tool_use_id: str | None = None
    tool_name: str | None = None
    checkpoint_id: str | None = None
    manifest_id: str | None = None
    before_manifest_id: str | None = None
    after_manifest_id: str | None = None
    partial: bool = False
    truncated: bool = False
    redaction_applied: bool = False
    tool_input: object | None = None
    tool_response: object | None = None
    gap_reason: str | None = None
    test_refs: list[str] = Field(default_factory=list)
    source_item_id: str | None = Field(
        default=None,
        description="Stable source-native item identity used for history deduplication.",
    )
    prompt_id: str | None = Field(
        default=None,
        description="Source-native user prompt identity, when the format provides one.",
    )
    prompt_text: str | None = Field(
        default=None,
        description="User prompt after typed secret redaction and before persistence.",
    )
    file_state: Literal["unknown"] | None = Field(
        default=None,
        description="History evidence cannot reconstruct exact before or after file bytes.",
    )
    edit_patch: str | None = Field(
        default=None,
        description="Source-provided edit patch after typed secret redaction.",
    )
    edit_command: str | None = Field(
        default=None,
        description="Source-provided file-writing command after typed secret redaction.",
    )
    redaction_types: list[str] | None = Field(
        default=None,
        description="Typed labels for secret classes redacted from imported evidence.",
    )


class TestCounts(ReplayModel):
    passed: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    errors: int | None = Field(default=None, ge=0)
    skipped: int | None = Field(default=None, ge=0)


class TestCaseEvidence(ReplayModel):
    node_id: str
    state: TestState


class StructuredTestEvidence(ReplayModel):
    schema_version: Literal["replay-store-1.0"] = "replay-store-1.0"
    id: str
    session_id: str
    observed_at: datetime
    state: TestState
    suite_scope: str
    source: Literal["structured_fixture", "version_tested_parser", "command_observation"]
    command_record_id: str | None = None
    command_exit_code: int | None = None
    associated_manifest_id: str | None = None
    association: TestAssociation = TestAssociation.NONE
    counts: TestCounts | None = None
    tests: list[TestCaseEvidence] = Field(default_factory=list)
    output_missing: bool = False
    partial: bool = False

    @model_validator(mode="after")
    def honest_command_evidence(self) -> StructuredTestEvidence:
        if self.source == "command_observation" and (self.counts is not None or self.tests):
            raise ValueError("command observations cannot contain structured pytest counts")
        if self.source == "command_observation" and self.state not in {
            TestState.NOT_OBSERVED,
            TestState.INCOMPLETE,
        }:
            raise ValueError("command observations cannot claim a test outcome")
        if (
            self.association
            in {
                TestAssociation.CONTENT_IDENTITY,
                TestAssociation.CONTROLLED_NO_WRITE,
            }
            and self.associated_manifest_id is None
        ):
            raise ValueError("verified test association requires a manifest identity")
        return self


class ChangedFileView(ReplayModel):
    path: str
    change: Literal["added", "modified", "deleted", "unchanged"]
    before_sha256: str | None = None
    after_sha256: str | None = None
    unified_diff: str | None = None


class ChangedSymbolView(ReplayModel):
    path: str
    qualified_name: str
    kind: str
    change: Literal["added", "modified", "deleted"]
    before_content_sha256: str | None = None
    after_content_sha256: str | None = None
    verified: bool


class TimelineEntry(ReplayModel):
    sequence: int
    record_id: str
    record_type: RecordKind
    captured_at: datetime
    completeness: Completeness
    attribution_status: AttributionStatus
    tool_name: str | None = None
    tool_use_id: str | None = None
    before_manifest_id: str | None = None
    after_manifest_id: str | None = None
    changed_files: list[ChangedFileView] = Field(default_factory=list)
    changed_symbols: list[ChangedSymbolView] = Field(default_factory=list)
    test_evidence: list[StructuredTestEvidence] = Field(default_factory=list)
    prompt_or_tool_evidence_redacted: bool = False
    gap_reason: str | None = None


class CheckpointFileView(ReplayModel):
    path: str
    content_sha256: str
    size: int
    text: str
    parse_ok: bool
    parse_error: str | None = None


class CheckpointView(ReplayModel):
    schema_version: Literal["replay-store-1.0"] = "replay-store-1.0"
    session_id: str
    sequence: int
    record: ReplayRecord
    selected_manifest_id: str | None
    files: list[CheckpointFileView]
    changed_files: list[ChangedFileView]
    changed_symbols: list[ChangedSymbolView]
    test_evidence: list[StructuredTestEvidence]
    limitations: list[str]


class ReplayExport(ReplayModel):
    schema_version: Literal["replay-export-1.0"] = "replay-export-1.0"
    exported_at: datetime
    session: ReplaySession
    records: list[ReplayRecord]
    manifests: list[SnapshotManifest]
    content_base64_by_sha256: dict[str, str]
    tests: list[StructuredTestEvidence]
    timeline: list[TimelineEntry]
    limitations: list[str]
