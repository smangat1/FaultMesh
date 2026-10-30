from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.narration_runner import (
    PersistentNarrationCache,
    run_narration,
    session_content_hash,
)
from faultmesh.replay.store import ReplayStore
from faultmesh.replay.views import export_session


def _export(tmp_path: Path):  # type: ignore[no-untyped-def]
    project = tmp_path / "project"
    project.mkdir()
    source = project / "value.py"
    source.write_text("def value() -> int:\n    return 1\n", encoding="utf-8")
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(project, codex_version="synthetic")
        source.write_text("def value() -> int:\n    return 2\n", encoding="utf-8")
        store.capture_checkpoint(session.id, provenance="synthetic")
        return export_session(store, session.id)


@dataclass
class RecordingBackend:
    prompts: list[str] = field(default_factory=list)

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        self.prompts.append(prompt)
        properties = json_schema.get("properties", {})
        if "claims" in properties:
            value: object = {"schema_version": "replay-claims-1.0", "claims": []}
        elif "chapters" in properties:
            record_ids = []
            marker = '"record_id":"'
            for part in prompt.split(marker)[1:]:
                record_ids.append(part.split('"', 1)[0])
            value = {
                "schema_version": "replay-chapter-proposals-1.0",
                "chapters": [
                    {
                        "start_sequence": 1,
                        "end_sequence": len(record_ids),
                        "title": "Synthetic update",
                        "evidence_refs": [f"record:{item}" for item in record_ids],
                    }
                ],
            }
        elif "sentences" in properties:
            value = {
                "sentences": [
                    "The session contains recorded work.",
                    "Checked claims are summarized separately.",
                    "Unknown evidence remains unknown.",
                ]
            }
        else:
            value = {}
        return BackendResult(
            text=json.dumps(value),
            backend="synthetic",
            model="synthetic-3b",
            hardware="test",
            latency_ms=1,
        )


@dataclass
class FailedBackend:
    calls: int = 0

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        self.calls += 1
        raise RuntimeError("synthetic backend failure")


def test_runner_reports_progress_per_step(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    progress: list[tuple[int, int, int]] = []
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        final = run_narration(
            exported,
            RecordingBackend(),
            on_progress=lambda done, total, partial: progress.append(
                (done, total, len(partial.narration))
            ),
            cache=cache,
        )
    assert progress == [(1, 2, 1), (2, 2, 2)]
    assert len(final.narration) == 2


def test_runner_redacts_secrets_before_backend(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    secret_key = "sk-syntheticsecret123456789"
    secret_password = "password=synthetic-password-value"
    first = exported.records[0].model_copy(
        update={"tool_response": f"{secret_key}\n{secret_password}"}
    )
    exported = exported.model_copy(update={"records": [first, *exported.records[1:]]})
    backend = RecordingBackend()
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        run_narration(exported, backend, cache=cache)
    all_prompts = "\n".join(backend.prompts)
    assert secret_key not in all_prompts
    assert "synthetic-password-value" not in all_prompts
    assert "[redacted:" in all_prompts


def test_runner_cache_hit_skips_backend(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    first_backend = RecordingBackend()
    cache_dir = tmp_path / "cache"
    with PersistentNarrationCache(cache_dir) as cache:
        first = run_narration(exported, first_backend, cache=cache)
    second_backend = RecordingBackend()
    with PersistentNarrationCache(cache_dir) as cache:
        second = run_narration(exported, second_backend, cache=cache)
    assert first.model_dump() == second.model_dump()
    assert first_backend.prompts
    assert second_backend.prompts == []


def test_runner_rerun_clears_cache(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    cache_dir = tmp_path / "cache"
    with PersistentNarrationCache(cache_dir) as cache:
        run_narration(exported, RecordingBackend(), cache=cache)
        cache.clear_session_cache(session_content_hash(exported))
        rerun_backend = RecordingBackend()
        run_narration(exported, rerun_backend, cache=cache)
    assert rerun_backend.prompts


def test_runner_backend_failure_falls_back_to_template(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        result = run_narration(exported, FailedBackend(), cache=cache)
    assert all(step.claims.fallback_used for step in result.narration)
    assert result.chapter_run.fallback_used is True
    assert result.summary is not None and result.summary.fallback_used is True


def test_summary_fallback_uses_facts_only(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        result = run_narration(exported, None, cache=cache)
    assert result.summary is not None
    assert result.summary.source == "deterministic_facts"
    assert result.summary.sentences == [
        "This session contains 2 recorded steps.",
        "The replay groups those steps into 1 chapters.",
        "Recorded or rebuilt evidence identifies 1 changed files.",
        "No complete structured test results were recorded.",
    ]
