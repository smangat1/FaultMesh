"""Lightweight, redacted prompt indexes for one discovered history session."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.chapters import baseline_chapters
from faultmesh.replay.history_discovery import (
    DEFAULT_MAX_SOURCE_BYTES,
    HistoryTool,
    discover_history,
)
from faultmesh.replay.history_import import import_history_session
from faultmesh.replay.history_reconstruction import recorded_changed_file_paths
from faultmesh.replay.models import ReplayExport, ReplayRecord, StructuredTestEvidence
from faultmesh.replay.store import ReplayStore, default_replay_root


class HistoryPromptSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_id: str
    first_line: str | None = None
    start_sequence: int = Field(ge=1)
    end_sequence: int = Field(ge=1)
    changed_files: list[str]
    changed_file_count: int = Field(ge=0)
    started_at: str
    ended_at: str
    test_observation: Literal["passed", "failed", "not_observed"] = "not_observed"
    grouping: Literal["prompt_turn", "recorded_events"]


class HistoryPromptIndex(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["history-prompt-index-1.0"] = "history-prompt-index-1.0"
    session_id: str
    source_file_sha256: str
    prompts: list[HistoryPromptSummary]
    cached: bool = False


_TEST_COMMAND = re.compile(
    r"(?:^|\s)(?:pytest|python\s+-m\s+pytest|npm\s+(?:run\s+)?test|pnpm\s+test|"
    r"yarn\s+test|cargo\s+test|go\s+test|swift\s+test|dotnet\s+test)(?:\s|$)",
    re.IGNORECASE,
)


def _command_text(record: ReplayRecord) -> str | None:
    if not isinstance(record.tool_input, dict):
        return None
    command = record.tool_input.get("command")
    return command if isinstance(command, str) else None


def _exit_code(record: ReplayRecord) -> int | None:
    if not isinstance(record.tool_response, dict):
        return None
    for key in ("exit_code", "exitCode"):
        value = record.tool_response.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _test_observation(
    records: list[ReplayRecord], tests: list[StructuredTestEvidence]
) -> Literal["passed", "failed", "not_observed"]:
    if any(test.state.value in {"fail", "error"} for test in tests):
        return "failed"
    if any(test.state.value == "pass" for test in tests):
        return "passed"
    exits = [
        code
        for record in records
        if (command := _command_text(record)) is not None and _TEST_COMMAND.search(command)
        if (code := _exit_code(record)) is not None
    ]
    if any(code != 0 for code in exits):
        return "failed"
    if exits:
        return "passed"
    return "not_observed"


def _first_line(records: list[ReplayRecord]) -> str | None:
    prompt = next((record.prompt_text for record in records if record.prompt_text), None)
    if prompt is None:
        return None
    return next((line.strip() for line in prompt.splitlines() if line.strip()), None)


def build_history_prompt_index(
    session_id: str, source_digest: str, exported: ReplayExport
) -> HistoryPromptIndex:
    """Build prompt aggregates from an already parsed export without file reconstruction."""
    records_by_sequence = {record.sequence: record for record in exported.records}
    tests_by_sequence = {
        entry.sequence: list(entry.test_evidence) for entry in exported.timeline
    }
    prompts: list[HistoryPromptSummary] = []
    for chapter in baseline_chapters(exported):
        records = [
            records_by_sequence[sequence]
            for sequence in range(chapter.start_sequence, chapter.end_sequence + 1)
            if sequence in records_by_sequence
        ]
        if not records:
            continue
        paths = sorted(
            {
                path
                for record in records
                for path in recorded_changed_file_paths(record)
            }
        )
        tests = [
            evidence
            for sequence in range(chapter.start_sequence, chapter.end_sequence + 1)
            for evidence in tests_by_sequence.get(sequence, [])
        ]
        native_id = next(
            (
                record.prompt_id or record.turn_id
                for record in records
                if record.prompt_id or record.turn_id
            ),
            None,
        ) or chapter.id
        prompts.append(
            HistoryPromptSummary(
                prompt_id=native_id,
                first_line=_first_line(records),
                start_sequence=chapter.start_sequence,
                end_sequence=chapter.end_sequence,
                changed_files=paths,
                changed_file_count=len(paths),
                started_at=min(record.captured_at for record in records).isoformat(),
                ended_at=max(record.captured_at for record in records).isoformat(),
                test_observation=_test_observation(records, tests),
                grouping=(
                    "prompt_turn"
                    if chapter.source == "deterministic_prompt_turn"
                    else "recorded_events"
                ),
            )
        )
    return HistoryPromptIndex(
        session_id=session_id,
        source_file_sha256=source_digest,
        prompts=prompts,
    )


def list_history_prompts(
    session_id: str,
    *,
    tool: HistoryTool | None = None,
    store_root: Path | None = None,
    codex_root: Path | None = None,
    claude_root: Path | None = None,
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    thread_history_path: Path | None = None,
    catalog_path: Path | None = None,
) -> HistoryPromptIndex:
    """Parse one session on demand and cache its redacted aggregate by source digest."""
    discovered = discover_history(
        codex_root=codex_root,
        claude_root=claude_root,
        max_source_bytes=max_source_bytes,
        thread_history_path=thread_history_path,
        catalog_path=catalog_path,
    )
    indexed = next(
        (
            item
            for item in discovered.sessions
            if item.session_id == session_id and (tool is None or item.tool == tool)
        ),
        None,
    )
    if indexed is None:
        raise KeyError(f"unknown history session: {session_id}")
    digest = indexed.source_file_sha256
    with ReplayStore(store_root or default_replay_root()) as store:
        cached = store.get_history_prompt_index(digest)
        if cached is not None:
            parsed = HistoryPromptIndex.model_validate_json(cached)
            if parsed.session_id == session_id:
                return parsed.model_copy(update={"cached": True})

        exported = import_history_session(
            session_id,
            tool=indexed.tool,
            codex_root=codex_root,
            claude_root=claude_root,
            max_source_bytes=max_source_bytes,
            thread_history_path=thread_history_path,
            catalog_path=catalog_path,
            reconstruct_file_state=False,
        )
        result = build_history_prompt_index(session_id, digest, exported)
        store.cache_history_prompt_index(digest, session_id, result.model_dump_json())
        return result
