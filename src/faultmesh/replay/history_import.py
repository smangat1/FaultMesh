"""On-demand conversion of one local history session into a replay export."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.claude_history import parse_claude_history
from faultmesh.replay.codex_history import parse_codex_history
from faultmesh.replay.history_discovery import (
    DEFAULT_MAX_SOURCE_BYTES,
    HistoryTool,
    discover_history,
    find_history_source,
)
from faultmesh.replay.models import ReplayExport, ReplayRecord, ReplaySession, TimelineEntry

HISTORY_IMPORT_LIMITATIONS = [
    "History import is read-only and does not inspect or modify a project checkout.",
    "Historical prompts and steps are source evidence after best-effort typed redaction.",
    "Historical file bytes are unknown; no manifests, checkpoints, or byte reconstruction exist.",
    "Patch and command evidence does not prove resulting file state, causality, or correctness.",
    "Unsupported versions and corrupt source records remain visible as unsupported or gap steps.",
]


class HistorySmokeSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    sessions_found: int = Field(ge=0)
    ok: int = Field(ge=0)
    partial: int = Field(ge=0)
    unsupported: int = Field(ge=0)
    imports_validated: int = Field(ge=0)
    import_failures: int = Field(ge=0)
    redactions_by_type: dict[str, int]


def _timeline_entry(record: ReplayRecord) -> TimelineEntry:
    return TimelineEntry(
        sequence=record.sequence,
        record_id=record.id,
        record_type=record.record_type,
        captured_at=record.captured_at,
        completeness=record.completeness,
        attribution_status=record.attribution_status,
        tool_name=record.tool_name,
        tool_use_id=record.tool_use_id,
        before_manifest_id=None,
        after_manifest_id=None,
        changed_files=[],
        changed_symbols=[],
        test_evidence=[],
        prompt_or_tool_evidence_redacted=record.redaction_applied,
        gap_reason=record.gap_reason,
    )


def _build_export(session: ReplaySession, records: tuple[ReplayRecord, ...]) -> ReplayExport:
    exported = ReplayExport(
        exported_at=max(
            (record.captured_at for record in records),
            default=session.stopped_at or session.created_at,
        ),
        session=session,
        records=list(records),
        manifests=[],
        content_base64_by_sha256={},
        tests=[],
        timeline=[_timeline_entry(record) for record in records],
        limitations=HISTORY_IMPORT_LIMITATIONS,
    )
    return ReplayExport.model_validate_json(exported.model_dump_json())


def import_history_session(
    session_id: str,
    *,
    tool: HistoryTool | None = None,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    zstd_executable: Path | str | None = None,
    allow_zstd_lookup: bool = True,
) -> ReplayExport:
    """Parse and validate one selected session; listing alone never calls this function."""
    source_tool, source = find_history_source(
        session_id,
        tool=tool,
        codex_root=codex_root,
        claude_root=claude_root,
        max_source_bytes=max_source_bytes,
        zstd_executable=zstd_executable,
        allow_zstd_lookup=allow_zstd_lookup,
    )
    if source_tool == "codex":
        codex_parsed = parse_codex_history(
            source,
            zstd_executable=zstd_executable,
            allow_zstd_lookup=allow_zstd_lookup,
            max_source_bytes=max_source_bytes,
        )
        return _build_export(codex_parsed.session, codex_parsed.records)
    claude_parsed = parse_claude_history(source, max_source_bytes=max_source_bytes)
    return _build_export(claude_parsed.session, claude_parsed.records)


def real_history_smoke_summary(
    *,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
) -> HistorySmokeSummary:
    """List and import real local logs while returning aggregate, content-free metrics only."""
    discovered = discover_history(codex_root=codex_root, claude_root=claude_root)
    status_counts = {"ok": 0, "partial": 0, "unsupported": 0}
    for session in discovered.sessions:
        status_counts[session.parse_status] += 1
    imports_validated = 0
    import_failures = 0
    redactions: dict[str, int] = {}
    for session in discovered.sessions:
        try:
            exported = import_history_session(
                session.session_id,
                tool=session.tool,
                codex_root=codex_root,
                claude_root=claude_root,
            )
        except (KeyError, OSError, ValueError):
            import_failures += 1
            continue
        imports_validated += 1
        for record in exported.records:
            for label in record.redaction_types or []:
                redactions[label] = redactions.get(label, 0) + 1
    return HistorySmokeSummary(
        sessions_found=len(discovered.sessions),
        ok=status_counts["ok"],
        partial=status_counts["partial"],
        unsupported=status_counts["unsupported"],
        imports_validated=imports_validated,
        import_failures=import_failures,
        redactions_by_type=dict(sorted(redactions.items())),
    )
