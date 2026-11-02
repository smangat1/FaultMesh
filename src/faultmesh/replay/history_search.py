"""Local cross-session search over redacted prompt indexes."""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.history_discovery import (
    DEFAULT_MAX_SOURCE_BYTES,
    HistoryDiscoveryResult,
    HistorySessionIndex,
    discover_history,
)
from faultmesh.replay.history_import import import_history_session
from faultmesh.replay.history_prompts import (
    HistoryPromptIndex,
    HistoryPromptSummary,
    build_history_prompt_index,
)
from faultmesh.replay.models import ImportSource
from faultmesh.replay.store import ReplayStore, default_replay_root
from faultmesh.replay.views import export_session

HistorySearchField = Literal["session_title", "prompt_text", "changed_file"]


class HistorySearchPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_id: str
    first_line: str | None = None
    start_sequence: int = Field(ge=1)
    end_sequence: int = Field(ge=1)
    changed_files: list[str]
    changed_file_count: int = Field(ge=0)
    started_at: str
    ended_at: str
    matched_in: list[HistorySearchField]


class HistorySearchSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    tool: Literal["codex", "claude_code"]
    source: Literal["history", "replay_store"]
    title: str
    project_display_name: str
    started_at: str
    ended_at: str
    prompts: list[HistorySearchPrompt]


class HistorySearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["history-search-1.0"] = "history-search-1.0"
    query: str
    sessions: list[HistorySearchSession]
    match_count: int = Field(ge=0)
    indexed_session_count: int = Field(ge=0)


class HistorySearchRefreshSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["history-search-refresh-1.0"] = "history-search-refresh-1.0"
    discovered_sessions: int = Field(ge=0)
    indexed_sessions: int = Field(ge=0)
    cached_sessions: int = Field(ge=0)
    failed_sessions: int = Field(ge=0)


def _validate_query(query: str) -> str:
    normalized = query.strip()
    if not normalized:
        raise ValueError("history search query must not be empty")
    if len(normalized) > 200:
        raise ValueError("history search query exceeds 200 characters")
    if any(ord(character) < 32 for character in normalized):
        raise ValueError("history search query contains control characters")
    return normalized


def _parse_cached_index(payload: str, session_id: str) -> HistoryPromptIndex | None:
    try:
        parsed = HistoryPromptIndex.model_validate_json(payload)
    except ValueError:
        return None
    return parsed if parsed.session_id == session_id else None


def _match_prompt(
    query: str,
    *,
    title: str,
    prompt: HistoryPromptSummary,
) -> list[HistorySearchField]:
    needle = query.casefold()
    fields: list[HistorySearchField] = []
    if needle in title.casefold():
        fields.append("session_title")
    prompt_text = prompt.search_text or prompt.first_line
    if prompt_text is not None and needle in prompt_text.casefold():
        fields.append("prompt_text")
    if any(needle in path.casefold() for path in prompt.changed_files):
        fields.append("changed_file")
    return fields


def _search_index(
    query: str,
    *,
    session_id: str,
    tool: Literal["codex", "claude_code"],
    source: Literal["history", "replay_store"],
    title: str,
    searchable_title: str | None = None,
    project_display_name: str,
    started_at: str,
    ended_at: str,
    index: HistoryPromptIndex,
) -> HistorySearchSession | None:
    matches: list[HistorySearchPrompt] = []
    for prompt in index.prompts:
        matched_in = _match_prompt(
            query,
            title=searchable_title if searchable_title is not None else title,
            prompt=prompt,
        )
        if not matched_in:
            continue
        matches.append(
            HistorySearchPrompt(
                prompt_id=prompt.prompt_id,
                first_line=prompt.first_line,
                start_sequence=prompt.start_sequence,
                end_sequence=prompt.end_sequence,
                changed_files=prompt.changed_files,
                changed_file_count=prompt.changed_file_count,
                started_at=prompt.started_at,
                ended_at=prompt.ended_at,
                matched_in=matched_in,
            )
        )
    if not matches:
        return None
    matches.sort(key=lambda item: (item.started_at, item.prompt_id), reverse=True)
    return HistorySearchSession(
        session_id=session_id,
        tool=tool,
        source=source,
        title=title,
        project_display_name=project_display_name,
        started_at=started_at,
        ended_at=ended_at,
        prompts=matches,
    )


def _history_title(session: HistorySessionIndex) -> str:
    return session.source_title or session.first_prompt_preview or "Untitled session"


def _sort_timestamp(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _stored_index_digest(session_id: str, source_digest: str | None) -> str:
    if source_digest is not None:
        return source_digest
    return hashlib.sha256(f"replay-store:{session_id}".encode()).hexdigest()


def _search_discovered_sessions(
    query: str,
    discovered: HistoryDiscoveryResult,
    store: ReplayStore,
) -> tuple[list[HistorySearchSession], set[tuple[str, str]], int]:
    results: list[HistorySearchSession] = []
    seen: set[tuple[str, str]] = set()
    indexed_count = 0
    for session in discovered.sessions:
        if session.tool not in {"codex", "claude_code"}:
            continue
        payload = store.get_history_prompt_index(session.source_file_sha256)
        if payload is None:
            continue
        index = _parse_cached_index(payload, session.session_id)
        if index is None:
            continue
        indexed_count += 1
        key = (session.tool, session.session_id)
        seen.add(key)
        result = _search_index(
            query,
            session_id=session.session_id,
            tool=session.tool,
            source="history",
            title=_history_title(session),
            searchable_title=session.source_title or "",
            project_display_name=session.project_display_name,
            started_at=session.started_at.isoformat(),
            ended_at=session.ended_at.isoformat(),
            index=index,
        )
        if result is not None:
            results.append(result)
    return results, seen, indexed_count


def _search_imported_store_sessions(
    query: str,
    store: ReplayStore,
    seen: set[tuple[str, str]],
) -> tuple[list[HistorySearchSession], int]:
    results: list[HistorySearchSession] = []
    indexed_count = 0
    for session in store.list_sessions():
        if session.import_source is None:
            continue
        tool: Literal["codex", "claude_code"] = (
            "codex" if session.import_source == ImportSource.CODEX else "claude_code"
        )
        key = (tool, session.id)
        if key in seen:
            continue
        try:
            exported = export_session(store, session.id)
            index = build_history_prompt_index(
                session.id,
                _stored_index_digest(session.id, session.source_file_sha256),
                exported,
            )
        except (KeyError, OSError, ValueError):
            continue
        indexed_count += 1
        started = session.timeline_started_at or session.created_at
        ended = session.timeline_ended_at or session.stopped_at or session.created_at
        result = _search_index(
            query,
            session_id=session.id,
            tool=tool,
            source="replay_store",
            title=session.source_title or "Untitled session",
            project_display_name="Imported replay",
            started_at=started.isoformat(),
            ended_at=ended.isoformat(),
            index=index,
        )
        if result is not None:
            results.append(result)
    return results, indexed_count


def search_history(
    query: str,
    *,
    store_root: Path | None = None,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    thread_history_path: Path | None = None,
    catalog_path: Path | None = None,
) -> HistorySearchResult:
    """Search current cached prompt indexes and imported replay-store sessions."""
    normalized = _validate_query(query)
    discovered = discover_history(
        codex_root=codex_root,
        claude_root=claude_root,
        max_source_bytes=max_source_bytes,
        thread_history_path=thread_history_path,
        catalog_path=catalog_path,
    )
    with ReplayStore(store_root or default_replay_root()) as store:
        results, seen, indexed_count = _search_discovered_sessions(
            normalized, discovered, store
        )
        imported, imported_count = _search_imported_store_sessions(normalized, store, seen)
    results.extend(imported)
    results.sort(
        key=lambda item: (_sort_timestamp(item.ended_at), item.session_id),
        reverse=True,
    )
    return HistorySearchResult(
        query=normalized,
        sessions=results,
        match_count=sum(len(session.prompts) for session in results),
        indexed_session_count=indexed_count + imported_count,
    )


def refresh_history_search_index(
    *,
    store_root: Path | None = None,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    thread_history_path: Path | None = None,
    catalog_path: Path | None = None,
) -> HistorySearchRefreshSummary:
    """Refresh missing prompt indexes after discovery, outside the home-list critical path."""
    discovered = discover_history(
        codex_root=codex_root,
        claude_root=claude_root,
        max_source_bytes=max_source_bytes,
        thread_history_path=thread_history_path,
        catalog_path=catalog_path,
    )
    indexed = 0
    cached = 0
    failed = 0
    with ReplayStore(store_root or default_replay_root()) as store:
        for session in discovered.sessions:
            payload = store.get_history_prompt_index(session.source_file_sha256)
            if payload is not None:
                parsed = _parse_cached_index(payload, session.session_id)
                if parsed is not None and parsed.search_ready:
                    cached += 1
                    continue
            try:
                exported = import_history_session(
                    session.session_id,
                    tool=session.tool,
                    codex_root=codex_root,
                    claude_root=claude_root,
                    max_source_bytes=max_source_bytes,
                    thread_history_path=thread_history_path,
                    catalog_path=catalog_path,
                    reconstruct_file_state=False,
                )
                prompt_index = build_history_prompt_index(
                    session.session_id,
                    session.source_file_sha256,
                    exported,
                )
                store.cache_history_prompt_index(
                    session.source_file_sha256,
                    session.session_id,
                    prompt_index.model_dump_json(),
                )
            except (KeyError, OSError, ValueError):
                failed += 1
                continue
            indexed += 1
    return HistorySearchRefreshSummary(
        discovered_sessions=len(discovered.sessions),
        indexed_sessions=indexed,
        cached_sessions=cached,
        failed_sessions=failed,
    )
