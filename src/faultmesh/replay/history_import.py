"""On-demand conversion of one local history session into a replay export."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.claude_history import parse_claude_history
from faultmesh.replay.codex_history import parse_codex_history
from faultmesh.replay.history_discovery import (
    DEFAULT_MAX_SOURCE_BYTES,
    HistoryState,
    HistoryTool,
    _read_catalog,
    default_codex_catalog_path,
    default_codex_history_root,
    default_codex_thread_history_path,
    discover_history,
    find_history_source,
)
from faultmesh.replay.models import ReplayExport, ReplayRecord, ReplaySession, TimelineEntry
from faultmesh.replay.thread_history import ThreadHistoryError, ThreadHistoryReader
from faultmesh.replay.thread_history_import import parse_thread_history_thread

HISTORY_IMPORT_LIMITATIONS = [
    "History import is read-only and does not inspect or modify a project checkout.",
    "Historical prompts and steps are source evidence after best-effort typed redaction.",
    "Historical file bytes are unknown; no manifests, checkpoints, or byte reconstruction exist.",
    "Patch and command evidence does not prove resulting file state, causality, or correctness.",
    "Unsupported versions and corrupt source records remain visible as unsupported or gap steps.",
]


class HistorySourcesMissingError(KeyError):
    """A Codex session has neither a rollout file nor projected thread history."""


BothHistorySourcesMissingError = HistorySourcesMissingError


def _missing_sources_error(session_id: str) -> HistorySourcesMissingError:
    return HistorySourcesMissingError(
        f"unknown history session: Codex session {session_id!r} is missing "
        "from both rollout history and the thread history projection"
    )


class HistorySmokeSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    sessions_found: int = Field(ge=0)
    ok: int = Field(ge=0)
    partial: int = Field(ge=0)
    unsupported: int = Field(ge=0)
    imports_validated: int = Field(ge=0)
    import_failures: int = Field(ge=0)
    redactions_by_type: dict[str, int]
    sessions_by_tree: dict[str, int] = Field(default_factory=dict)
    sessions_by_tool: dict[str, int] = Field(default_factory=dict)
    sessions_by_parse_status: dict[str, int] = Field(default_factory=dict)
    injected_context_messages: int = Field(default=0, ge=0)
    system_temp_sessions: int = Field(default=0, ge=0)
    sqlite_matched_sessions: int = Field(default=0, ge=0)
    out_of_order_steps: int = Field(default=0, ge=0)
    missing_timestamp_fallbacks: int = Field(default=0, ge=0)
    timeline_started_at: str | None = None
    timeline_ended_at: str | None = None


def _timeline_entry(record: ReplayRecord) -> TimelineEntry:
    return TimelineEntry(
        sequence=record.sequence,
        record_id=record.id,
        record_type=record.record_type,
        captured_at=record.captured_at,
        timestamp_inferred=record.timestamp_inferred,
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
    timeline_started_at = min(
        (record.captured_at for record in records), default=session.created_at
    )
    timeline_ended_at = max(
        (record.captured_at for record in records),
        default=session.stopped_at or session.created_at,
    )
    session = session.model_copy(
        update={
            "timeline_started_at": timeline_started_at,
            "timeline_ended_at": timeline_ended_at,
        }
    )
    exported = ReplayExport(
        exported_at=timeline_ended_at,
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
    thread_history_path: Path | None = None,
    catalog_path: Path | None = None,
) -> ReplayExport:
    """Parse and validate one selected session; listing alone never calls this function."""
    discovered = discover_history(
        codex_root=codex_root,
        claude_root=claude_root,
        max_source_bytes=max_source_bytes,
        zstd_executable=zstd_executable,
        allow_zstd_lookup=allow_zstd_lookup,
        thread_history_path=thread_history_path,
        catalog_path=catalog_path,
    )
    indexed = next(
        (
            session
            for session in discovered.sessions
            if session.session_id == session_id and (tool is None or session.tool == tool)
        ),
        None,
    )
    projection_only = (
        indexed is not None
        and indexed.tool == "codex"
        and indexed.unsupported_reason == "rollout_file_missing"
    )
    source_tool: HistoryTool | None = None
    source: Path | None = None
    if not projection_only:
        try:
            source_tool, source = find_history_source(
                session_id,
                tool=tool,
                codex_root=codex_root,
                claude_root=claude_root,
                max_source_bytes=max_source_bytes,
                zstd_executable=zstd_executable,
                allow_zstd_lookup=allow_zstd_lookup,
            )
        except KeyError:
            if tool == "claude_code" or (indexed is not None and indexed.tool == "claude_code"):
                raise
    if source_tool is None or source is None:
        active_codex_root = codex_root or default_codex_history_root()
        resolved_catalog_path = (
            catalog_path
            if catalog_path is not None
            else (
                active_codex_root.parent / "state_5.sqlite"
                if codex_root is not None
                else default_codex_catalog_path()
            )
        )
        resolved_projection_path = (
            thread_history_path
            if thread_history_path is not None
            else (
                active_codex_root.parent / "thread_history_1.sqlite"
                if codex_root is not None
                else default_codex_thread_history_path()
            )
        )
        catalog_threads, _catalog_status, _catalog_message = _read_catalog(resolved_catalog_path)
        catalog_thread = next(
            (thread for thread in catalog_threads if thread.session_id == session_id), None
        )
        try:
            with ThreadHistoryReader(resolved_projection_path) as reader:
                if not reader.has_thread(session_id):
                    raise _missing_sources_error(session_id)
        except (OSError, ThreadHistoryError) as error:
            raise _missing_sources_error(session_id) from error

        exported = import_thread_history_session(
            resolved_projection_path,
            session_id,
            cwd=catalog_thread.cwd if catalog_thread is not None else None,
            title=catalog_thread.title if catalog_thread is not None else None,
            history_state=(
                indexed.history_state
                if indexed is not None
                else (
                    "archived"
                    if catalog_thread is not None and catalog_thread.archived
                    else "active"
                )
            ),
        )
        if indexed is not None and indexed.source_title is not None:
            updated_session = exported.session.model_copy(
                update={"source_title": indexed.source_title}
            )
            return _build_export(updated_session, tuple(exported.records))
        return exported
    if source_tool == "codex":
        codex_parsed = parse_codex_history(
            source,
            zstd_executable=zstd_executable,
            allow_zstd_lookup=allow_zstd_lookup,
            max_source_bytes=max_source_bytes,
        )
        session = codex_parsed.session.model_copy(
            update={
                "history_state": indexed.history_state if indexed else None,
                "source_title": indexed.source_title if indexed else None,
            }
        )
        return _build_export(session, codex_parsed.records)
    claude_parsed = parse_claude_history(source, max_source_bytes=max_source_bytes)
    return _build_export(claude_parsed.session, claude_parsed.records)


def import_thread_history_session(
    database: Path | str,
    thread_id: str,
    *,
    cwd: str | None = None,
    title: str | None = None,
    history_state: HistoryState | None = None,
) -> ReplayExport:
    """Import one projected Codex thread when its rollout file is unavailable."""
    parsed = parse_thread_history_thread(database, thread_id, cwd=cwd, title=title)
    session = parsed.session
    if history_state is not None:
        session = session.model_copy(update={"history_state": history_state})
    return _build_export(session, parsed.records)


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
    sessions_by_tree: dict[str, int] = {}
    sessions_by_tool: dict[str, int] = {}
    injected_context_messages = 0
    system_temp_sessions = 0
    sqlite_matched_sessions = 0
    out_of_order_steps = 0
    missing_timestamp_fallbacks = 0
    captured_times: list[datetime] = []
    for session in discovered.sessions:
        tree = session.history_state or "not_applicable"
        sessions_by_tree[tree] = sessions_by_tree.get(tree, 0) + 1
        sessions_by_tool[session.tool] = sessions_by_tool.get(session.tool, 0) + 1
        system_temp_sessions += session.project_visibility == "system_temp"
        sqlite_matched_sessions += session.catalog_matched is True
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
        injected_context_messages += exported.session.injected_context_messages or 0
        out_of_order_steps += exported.session.out_of_order_steps or 0
        missing_timestamp_fallbacks += exported.session.missing_timestamp_fallbacks or 0
        captured_times.extend(record.captured_at for record in exported.records)
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
        sessions_by_tree=dict(sorted(sessions_by_tree.items())),
        sessions_by_tool=dict(sorted(sessions_by_tool.items())),
        sessions_by_parse_status=dict(sorted(status_counts.items())),
        injected_context_messages=injected_context_messages,
        system_temp_sessions=system_temp_sessions,
        sqlite_matched_sessions=sqlite_matched_sessions,
        out_of_order_steps=out_of_order_steps,
        missing_timestamp_fallbacks=missing_timestamp_fallbacks,
        timeline_started_at=min(captured_times).isoformat() if captured_times else None,
        timeline_ended_at=max(captured_times).isoformat() if captured_times else None,
    )
