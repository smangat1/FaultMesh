"""Versioned models for the static project structure export."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SymbolKind(StrEnum):
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    ASYNC_FUNCTION = "async_function"
    ASYNC_METHOD = "async_method"
    NESTED_FUNCTION = "nested_function"
    NESTED_ASYNC_FUNCTION = "nested_async_function"


class EdgeKind(StrEnum):
    IMPORTS = "imports"
    POSSIBLE_CALL = "possible_call"
    DEFINES = "defines"
    CONTAINS = "contains"


class EdgeConfidence(StrEnum):
    RESOLVED = "resolved"
    AMBIGUOUS = "ambiguous"
    UNRESOLVED = "unresolved"


class ChangeStatus(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"


class FileChangeKind(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"
    RENAMED = "renamed"
    COPIED = "copied"
    UNTRACKED = "untracked"
    UNCHANGED = "unchanged"


class DocstringMetadata(StrictModel):
    text: str
    source: Literal["docstring"] = "docstring"


class FileNode(StrictModel):
    id: str
    path: str
    module: str
    content_sha256: str
    line_count: int = Field(ge=0)
    is_test: bool
    is_test_heuristic: Literal[True] = True
    parse_error: str | None = None
    removed: bool = False
    revision_side: Literal["head", "base"] = "head"

    @field_validator("path")
    @classmethod
    def safe_path(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("file path must be project-relative")
        return value


class SymbolNode(StrictModel):
    id: str
    path: str
    qualified_name: str
    name: str
    kind: SymbolKind
    disambiguator: int = Field(ge=1)
    parent_id: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    content_sha256: str
    signature: str | None = None
    parameter_names: list[str] = Field(default_factory=list)
    decorators: list[str] = Field(default_factory=list)
    docstring: DocstringMetadata | None = None
    bases: list[str] = Field(default_factory=list)
    removed: bool = False
    revision_side: Literal["head", "base"] = "head"


class StaticEdge(StrictModel):
    id: str
    layer: Literal["static"] = "static"
    kind: EdgeKind
    source_id: str
    target_id: str | None = None
    callsite_path: str
    callsite_line: int = Field(ge=1)
    resolution_reason: str
    confidence: EdgeConfidence
    external_module: str | None = None
    removed: bool = False
    revision_side: Literal["head", "base"] = "head"


class UnresolvedReference(StrictModel):
    path: str
    line: int = Field(ge=1)
    text: str
    reason: str


class SkipRecord(StrictModel):
    path: str
    reason: str
    count: int = Field(ge=1)


class ParseErrorRecord(StrictModel):
    path: str
    line: int | None = Field(default=None, ge=1)
    message: str


class StructureIndex(StrictModel):
    files: list[FileNode]
    symbols: list[SymbolNode]
    skips: list[SkipRecord]
    parse_errors: list[ParseErrorRecord]


class RelationshipIndex(StrictModel):
    edges: list[StaticEdge]
    unresolved: list[UnresolvedReference]
    external_modules: list[str]


class FileGitStatus(StrictModel):
    path: str
    status: FileChangeKind
    old_path: str | None = None
    similarity: int | None = Field(default=None, ge=0, le=100)
    untracked: bool = False
    python: bool = True


class SymbolGitStatus(StrictModel):
    symbol_id: str
    status: ChangeStatus
    old_symbol_id: str | None = None
    method: Literal["line-range overlap and source-segment hash"] = (
        "line-range overlap and source-segment hash"
    )


class GitComparison(StrictModel):
    available: bool
    error: str | None = None
    base: str | None = None
    head: str | None = None
    head_is_worktree: bool = False
    detached: bool | None = None
    shallow: bool | None = None
    dirty: bool | None = None
    worktree_content_sha256: str | None = None
    files: list[FileGitStatus] = Field(default_factory=list)
    symbols: list[SymbolGitStatus] = Field(default_factory=list)
    non_python_changes: int = Field(default=0, ge=0)
    skipped_submodules: int = Field(default=0, ge=0)


class ImpactNeighbor(StrictModel):
    changed_symbol_id: str
    neighbor_symbol_id: str
    edge_id: str
    direction: Literal["incoming", "outgoing"]
    label: Literal["possible_static_impact"] = "possible_static_impact"


class CoverageOverlayEntry(StrictModel):
    run_id: str
    test_id: str
    structure_symbol_id: str
    path: str
    qualified_name: str
    stale: bool
    phases: list[str]
    executed_lines: list[int]


class CoverageOverlayUnmatched(StrictModel):
    run_id: str
    test_id: str
    path: str
    qualified_name: str
    reason: str


class CoverageOverlay(StrictModel):
    layer: Literal["observed_coverage"] = "observed_coverage"
    entries: list[CoverageOverlayEntry]
    unmatched: list[CoverageOverlayUnmatched]


class StructureCounts(StrictModel):
    files: int = Field(ge=0)
    current_files: int = Field(default=0, ge=0)
    ghost_files: int = Field(default=0, ge=0)
    symbols: int = Field(ge=0)
    current_symbols: int = Field(default=0, ge=0)
    ghost_symbols: int = Field(default=0, ge=0)
    edges_by_kind_and_confidence: dict[str, int]
    unresolved: int = Field(ge=0)
    external_modules: int = Field(ge=0)
    skipped: int = Field(ge=0)
    parse_errors: int = Field(ge=0)


class StructureEnvelope(StrictModel):
    project_name: str
    base_sha: str | None = None
    head_sha: str | None = None
    head_is_worktree: bool = False
    dirty: bool | None = None
    content_sha256: str


class StructureExport(StrictModel):
    schema_version: Literal["3.0"] = "3.0"
    envelope: StructureEnvelope
    files: list[FileNode]
    symbols: list[SymbolNode]
    edges: list[StaticEdge]
    unresolved: list[UnresolvedReference]
    external_modules: list[str]
    git: GitComparison
    skips: list[SkipRecord]
    parse_errors: list[ParseErrorRecord]
    limitations: list[str]
    counts: StructureCounts
    possible_impact: list[ImpactNeighbor] = Field(default_factory=list)
    coverage_overlay: CoverageOverlay | None = None
