"""Shared local narration runner with redaction and persistent content-hash caching."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import threading
from collections import Counter
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any, TypeVar, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from faultmesh.inference.backends import BackendResult, InferenceBackend
from faultmesh.replay.chapters import ChapterRunRecord, baseline_chapters, propose_chapters
from faultmesh.replay.claims import (
    ClaimNarrator,
    ClaimVerdictName,
    build_evidence_packet,
    claim_cache_key,
)
from faultmesh.replay.models import ReplayExport
from faultmesh.replay.narration import (
    MODEL_PRESETS,
    REASON_PROMPT_VERSION,
    LocalModelPreset,
    ReplayNarrationExport,
    SessionSummary,
    StepNarration,
    build_narration_export,
    fallback_session_summary,
    suggest_likely_reason,
)
from faultmesh.replay.privacy import redact_history_text

RUNNER_CACHE_VERSION = "replay-narration-cache-1.0"
SUMMARY_PROMPT_VERSION = "replay-summary-prompt-1.0"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _SummaryProposal(_StrictModel):
    sentences: list[str] = Field(min_length=3, max_length=5)


_CacheModel = TypeVar("_CacheModel", bound=BaseModel)


class _RedactingBackend:
    def __init__(self, backend: InferenceBackend, *, max_prompt_bytes: int) -> None:
        self._backend = backend
        self._max_prompt_bytes = max_prompt_bytes

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        # Serialized evidence can contain escaped line breaks immediately before an
        # assignment ("\\npassword=..."). Normalize only those separators so the
        # shared typed redactor sees the original string boundary before inference.
        normalized = (
            prompt.replace("\\r\\n", " ")
            .replace("\\n", " ")
            .replace("\\r", " ")
            .replace("\\t", " ")
        )
        result = redact_history_text(normalized, self._max_prompt_bytes)
        clean_prompt = cast(str, result.value)
        return self._backend.generate(clean_prompt, json_schema)


def default_narration_cache_dir() -> Path:
    override = os.environ.get("FAULTMESH_APP_DATA")
    if override:
        return Path(override).expanduser().resolve() / "narration-cache"
    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support" / "FaultMesh"
    elif os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        root /= "FaultMesh"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
        root /= "faultmesh"
    return root / "narration-cache"


class PersistentNarrationCache:
    """Small local SQLite cache scoped by immutable session content."""

    def __init__(self, cache_dir: Path | None = None) -> None:
        self.cache_dir = (cache_dir or default_narration_cache_dir()).expanduser().resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.cache_dir / "narration.sqlite3"
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS narration_cache (
                session_hash TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                PRIMARY KEY (session_hash, cache_key)
            )
            """
        )
        self._connection.commit()
        with suppress(OSError):
            self.path.chmod(0o600)
        self._lock = threading.RLock()

    def get(
        self, session_hash: str, cache_key: str, model: type[_CacheModel]
    ) -> _CacheModel | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT payload_json FROM narration_cache WHERE session_hash = ? AND cache_key = ?",
                (session_hash, cache_key),
            ).fetchone()
        if row is None:
            return None
        try:
            return model.model_validate_json(str(row[0]))
        except ValidationError:
            with self._lock:
                self._connection.execute(
                    "DELETE FROM narration_cache WHERE session_hash = ? AND cache_key = ?",
                    (session_hash, cache_key),
                )
                self._connection.commit()
            return None

    def put(self, session_hash: str, cache_key: str, value: BaseModel) -> None:
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO narration_cache(session_hash, cache_key, payload_json)
                VALUES (?, ?, ?)
                ON CONFLICT(session_hash, cache_key)
                DO UPDATE SET payload_json = excluded.payload_json
                """,
                (session_hash, cache_key, value.model_dump_json()),
            )
            self._connection.commit()

    def clear_session_cache(self, session_hash: str) -> None:
        with self._lock:
            self._connection.execute(
                "DELETE FROM narration_cache WHERE session_hash = ?", (session_hash,)
            )
            self._connection.commit()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def __enter__(self) -> PersistentNarrationCache:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def session_content_hash(exported: ReplayExport) -> str:
    value = exported.model_dump(mode="json", exclude={"exported_at"})
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _cache_identity(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _summary_prompt(chapters: ChapterRunRecord, steps: list[StepNarration]) -> str:
    verdicts = Counter(
        verdict.verdict.value for step in steps for verdict in step.claims.verdicts
    )
    facts = {
        "chapter_titles": [chapter.title for chapter in chapters.chapters],
        "claim_verdict_counts": {
            verdict.value: verdicts.get(verdict.value, 0) for verdict in ClaimVerdictName
        },
    }
    return (
        "Write 3 to 5 short plain sentences summarizing this replay. Use only the supplied "
        "chapter titles and checked claim verdict counts. Do not infer intent or add file details. "
        "Return schema JSON. Facts:\n"
        + json.dumps(facts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    )


def _model_summary(
    exported: ReplayExport,
    chapters: ChapterRunRecord,
    steps: list[StepNarration],
    backend: InferenceBackend | None,
) -> SessionSummary:
    fallback = fallback_session_summary(exported, chapter_count=len(chapters.chapters))
    if backend is None:
        return fallback
    try:
        result = backend.generate(
            _summary_prompt(chapters, steps), _SummaryProposal.model_json_schema()
        )
        start = result.text.find("{")
        end = result.text.rfind("}")
        if start < 0 or end < start:
            raise ValueError("summary response did not contain a JSON object")
        proposal = _SummaryProposal.model_validate_json(result.text[start : end + 1])
    except (RuntimeError, OSError, ValueError, ValidationError):
        return fallback
    return SessionSummary(sentences=proposal.sentences, source="model", fallback_used=False)


def run_narration(
    exported: ReplayExport,
    backend: InferenceBackend | None,
    preset: str | LocalModelPreset = "medium-3b",
    on_progress: Callable[[int, int, ReplayNarrationExport], None] | None = None,
    cache: PersistentNarrationCache | None = None,
) -> ReplayNarrationExport:
    """Narrate one replay locally, reporting a valid partial export after every step."""
    selected = MODEL_PRESETS[preset] if isinstance(preset, str) else preset
    backend_name = type(backend).__name__ if backend is not None else "none"
    model_name = getattr(backend, "model", backend_name)
    model_config_id = f"{selected.id}:{model_name}"
    safe_backend: InferenceBackend | None = (
        _RedactingBackend(backend, max_prompt_bytes=max(1_048_576, selected.context_size * 16))
        if backend is not None
        else None
    )
    owned_cache = cache is None
    active_cache = cache or PersistentNarrationCache()
    content_hash = session_content_hash(exported)
    baseline = baseline_chapters(exported)
    baseline_run = ChapterRunRecord(chapters=baseline, fallback_used=True)
    steps: list[StepNarration] = []
    records = sorted(exported.records, key=lambda item: item.sequence)
    try:
        for done, record in enumerate(records, start=1):
            packet = build_evidence_packet(exported, record.sequence)
            claim_key = claim_cache_key(packet, model_config_id)
            step_key = _cache_identity(
                {
                    "version": RUNNER_CACHE_VERSION,
                    "claim_cache_key": claim_key,
                    "reason_prompt": REASON_PROMPT_VERSION,
                }
            )
            cached_step = active_cache.get(content_hash, f"step:{step_key}", StepNarration)
            if isinstance(cached_step, StepNarration):
                step = cached_step
            else:
                claims = ClaimNarrator(safe_backend, model_config_id=model_config_id).run(packet)
                step = StepNarration(
                    sequence=record.sequence,
                    packet=packet,
                    claims=claims,
                    reason=suggest_likely_reason(
                        exported, record.sequence, safe_backend
                    ),
                )
                active_cache.put(content_hash, f"step:{step_key}", step)
            steps.append(step)
            if on_progress is not None:
                partial = build_narration_export(
                    exported,
                    steps=list(steps),
                    chapter_run=baseline_run,
                    summary=fallback_session_summary(
                        exported, chapter_count=len(baseline)
                    ),
                )
                on_progress(done, len(records), partial)

        chapter_key = _cache_identity(
            {
                "version": RUNNER_CACHE_VERSION,
                "kind": "chapters",
                "model_config": model_config_id,
                "records": [(record.id, record.sequence) for record in records],
            }
        )
        cached_chapters = active_cache.get(
            content_hash, f"chapters:{chapter_key}", ChapterRunRecord
        )
        if isinstance(cached_chapters, ChapterRunRecord):
            chapter_run = cached_chapters
        else:
            chapter_run = propose_chapters(exported, safe_backend)
            active_cache.put(content_hash, f"chapters:{chapter_key}", chapter_run)

        summary_key = _cache_identity(
            {
                "version": RUNNER_CACHE_VERSION,
                "kind": "summary",
                "model_config": model_config_id,
                "chapters": [chapter.model_dump(mode="json") for chapter in chapter_run.chapters],
                "verdicts": [
                    verdict.verdict.value
                    for step in steps
                    for verdict in step.claims.verdicts
                ],
                "prompt": SUMMARY_PROMPT_VERSION,
            }
        )
        cached_summary = active_cache.get(
            content_hash, f"summary:{summary_key}", SessionSummary
        )
        if isinstance(cached_summary, SessionSummary):
            summary = cached_summary
        else:
            summary = _model_summary(exported, chapter_run, steps, safe_backend)
            active_cache.put(content_hash, f"summary:{summary_key}", summary)
        return build_narration_export(
            exported,
            steps=steps,
            chapter_run=chapter_run,
            summary=summary,
        )
    finally:
        if owned_cache:
            active_cache.close()
