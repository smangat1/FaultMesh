"""Versioned fact-only records emitted by the live spectate engine."""

from __future__ import annotations

from typing import Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from faultmesh.structure.models import FileNode, SkipRecord, SymbolNode

SCHEMA_VERSION = "spectate-1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Limits(StrictModel):
    max_files: int = Field(ge=1)
    max_file_bytes: int = Field(ge=1)
    max_diff_lines: int = Field(ge=1)
    max_events_per_second: int = Field(ge=1)
    max_line_length: int = Field(ge=1)
    max_stdout_line_bytes: int = Field(ge=1)
    debounce_ms: int = Field(ge=0)
    poll_ms: int = Field(ge=1)


class IgnoreSummary(StrictModel):
    ignored_parts: list[str]
    secret_patterns: list[str]
    python_only: Literal[True] = True
    symlinks_followed: Literal[False] = False


class FileSnapshot(StrictModel):
    id: str
    path: str
    content_sha256: str
    line_count: int = Field(ge=0)
    parse_ok: bool
    parse_error: str | None = None


class LineRange(StrictModel):
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class DiffHunk(StrictModel):
    old_start: int = Field(ge=0)
    old_count: int = Field(ge=0)
    new_start: int = Field(ge=0)
    new_count: int = Field(ge=0)
    lines: list[str]


class StructurePayload(StrictModel):
    files: list[FileNode]
    symbols: list[SymbolNode]
    skips: list[SkipRecord]


class BaseRecord(StrictModel):
    schema_version: Literal["spectate-1.0"] = "spectate-1.0"
    session_id: str = Field(min_length=1, max_length=128)
    sequence: int = Field(ge=1)
    emitted_at: str


class SessionStarted(BaseRecord):
    event: Literal["session_started"]
    root_display_name: str
    limits: Limits
    ignore: IgnoreSummary
    diff_base: Literal["previous stable snapshot"] = "previous stable snapshot"
    tests_rerun: Literal[False] = False


class InitialSnapshot(BaseRecord):
    event: Literal["initial_snapshot"]
    files: list[FileSnapshot]
    structure: StructurePayload


class FileChanged(BaseRecord):
    event: Literal["file_changed"]
    path: str
    kind: Literal["created", "modified", "deleted", "renamed"]
    from_path: str | None = None
    to_path: str | None = None
    previous_sha256: str | None = None
    new_sha256: str | None = None
    line_count: int | None = Field(default=None, ge=0)
    changed_line_ranges: list[LineRange]
    affected_file_ids: list[str]
    affected_symbol_ids: list[str]
    parse_ok: bool
    parse_error: str | None = None


class SourceRecord(BaseRecord):
    event: Literal["source"]
    path: str
    sha256: str
    text: str | None = None
    complete: bool
    skipped_reason: str | None = None


class DiffRecord(BaseRecord):
    event: Literal["diff"]
    path: str
    base: Literal["previous stable snapshot"] = "previous stable snapshot"
    base_sha256: str | None = None
    new_sha256: str | None = None
    hunks: list[DiffHunk]
    text: str
    truncated: bool = False
    skipped_reason: str | None = None


class StructureUpdate(BaseRecord):
    event: Literal["structure_update"]
    path: str
    file: FileNode | None = None
    symbols: list[SymbolNode]
    added_symbol_ids: list[str]
    modified_symbol_ids: list[str]
    removed_symbol_ids: list[str]
    changed_node_ids: list[str]
    kept_last_good_symbols: bool
    parse_ok: bool
    parse_error: str | None = None


class EvidenceStale(BaseRecord):
    event: Literal["evidence_stale"]
    path: str
    evidence_content_sha256: str
    new_content_sha256: str | None = None
    rule: Literal["containing file content_sha256"] = "containing file content_sha256"


class WatchError(BaseRecord):
    event: Literal["watch_error"]
    reason: str
    operation: str
    path: str | None = None
    recoverable: bool
    skipped_count: int = Field(default=0, ge=0)


class RootMissing(BaseRecord):
    event: Literal["root_missing"]
    reason: Literal["deleted", "renamed", "unmounted", "permission_denied"]


class SessionEnded(BaseRecord):
    event: Literal["session_ended"]
    reason: str


SpectateRecord = Annotated[
    SessionStarted
    | InitialSnapshot
    | FileChanged
    | SourceRecord
    | DiffRecord
    | StructureUpdate
    | EvidenceStale
    | WatchError
    | RootMissing
    | SessionEnded,
    Field(discriminator="event"),
]

EVENT_ADAPTER = TypeAdapter[SpectateRecord](
    cast(type[SpectateRecord], SpectateRecord)
)
