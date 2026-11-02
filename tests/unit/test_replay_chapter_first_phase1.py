from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.models import ChangedFileView
from faultmesh.replay.narration_runner import (
    PersistentNarrationCache,
    build_staged_baseline,
    explain_step_on_demand,
    run_staged_narration,
    summarize_selection_on_demand,
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


def _many_steps(exported: Any, count: int, *, changed: bool = True):  # type: ignore[no-untyped-def]
    record = exported.records[-1]
    entry = exported.timeline[-1]
    records = []
    timeline = []
    for sequence in range(1, count + 1):
        record_update = {
            "id": f"record:{sequence}",
            "source_identity": f"source:{sequence}",
            "source_offset": sequence,
            "sequence": sequence,
            "turn_id": f"turn:{sequence}",
        }
        if not changed:
            record_update.update(
                {
                    "manifest_id": None,
                    "before_manifest_id": None,
                    "after_manifest_id": None,
                    "tool_response": None,
                    "test_refs": [],
                }
            )
        records.append(record.model_copy(update=record_update))
        timeline.append(
            entry.model_copy(
                update={
                    "record_id": f"record:{sequence}",
                    "sequence": sequence,
                    "changed_files": entry.changed_files if changed else [],
                    "before_manifest_id": entry.before_manifest_id if changed else None,
                    "after_manifest_id": entry.after_manifest_id if changed else None,
                    "test_evidence": entry.test_evidence if changed else [],
                }
            )
        )
    return exported.model_copy(update={"records": records, "timeline": timeline})


@dataclass
class ChapterBackend:
    prompts: list[str] = field(default_factory=list)
    limits: list[int] = field(default_factory=list)

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        return self.generate_with_limit(prompt, json_schema, max_output_tokens=999)

    def generate_with_limit(
        self,
        prompt: str,
        json_schema: dict[str, Any],
        *,
        max_output_tokens: int,
    ) -> BackendResult:
        self.prompts.append(prompt)
        self.limits.append(max_output_tokens)
        properties = json_schema.get("properties", {})
        if "claims" in properties:
            value: object = {"schema_version": "replay-claims-1.0", "claims": []}
        elif "title" in properties:
            marker = '"start_sequence":'
            sequence = prompt.split(marker, 1)[1].split(",", 1)[0]
            value = {"title": f"Model chapter {sequence}"}
        elif "sentences" in properties:
            prompt_ids = [
                part.split('"', 1)[0]
                for part in prompt.split('"prompt_id":"')[1:]
            ]
            value = {
                "sentences": [
                    "Recorded work is grouped into chapters.",
                    "Checked verdict counts are reported separately.",
                    "Unknown evidence remains unknown.",
                ],
                "prompts": [
                    {"prompt_id": prompt_id, "text": f"Recorded work for {prompt_id}."}
                    for prompt_id in prompt_ids
                ],
            }
        elif "text" in properties:
            value = {"text": "The recorded facts describe this requested scope."}
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
class RaisingBackend:
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        raise AssertionError("stage zero called the model")


def test_stage_zero_never_calls_backend_and_has_no_per_step_packets(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    baseline = build_staged_baseline(exported)
    assert baseline.chapters
    assert baseline.narration == []
    assert baseline.summary is not None
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        staged = run_staged_narration(
            exported,
            RaisingBackend(),
            should_cancel=lambda: True,
            cache=cache,
        )
    assert staged.model_dump() == baseline.model_dump()


def test_chapter_titles_run_newest_first_with_tight_caps(tmp_path: Path) -> None:
    exported = _many_steps(_export(tmp_path), 3)
    backend = ChapterBackend()
    stages: list[tuple[str, int, int]] = []
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        result = run_staged_narration(
            exported,
            backend,
            on_stage=lambda stage, done, total, partial: stages.append(
                (stage, done, total)
            ),
            cache=cache,
        )
    title_prompts = [
        prompt for prompt in backend.prompts if prompt.startswith("Write one concise chapter title")
    ]
    assert [
        int(prompt.split('"start_sequence":', 1)[1].split(",", 1)[0])
        for prompt in title_prompts
    ] == [3, 2, 1]
    assert backend.limits == [1800, 60, 60, 60]
    assert stages == [
        ("baseline", 0, 3),
        ("prompt", 1, 3),
        ("prompt", 2, 3),
        ("prompt", 3, 3),
        ("summary", 3, 3),
        ("chapter", 1, 3),
        ("chapter", 2, 3),
        ("chapter", 3, 3),
    ]
    assert all(chapter.title_status == "model interpretation" for chapter in result.chapters)


def test_chapter_title_prompt_is_redacted(tmp_path: Path) -> None:
    exported = _many_steps(_export(tmp_path), 1)
    secret = "password=synthetic-title-secret"
    entry = exported.timeline[0]
    changed = ChangedFileView(
        path=secret,
        change="modified",
        file_state="unknown",
    )
    exported = exported.model_copy(
        update={"timeline": [entry.model_copy(update={"changed_files": [changed]})]}
    )
    backend = ChapterBackend()
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        run_staged_narration(exported, backend, cache=cache)
    prompts = "\n".join(backend.prompts)
    assert secret not in prompts
    assert "synthetic-title-secret" not in prompts


def test_cancel_mid_titling_returns_valid_partial_state(tmp_path: Path) -> None:
    exported = _many_steps(_export(tmp_path), 3)
    backend = ChapterBackend()
    with PersistentNarrationCache(tmp_path / "cache") as cache:
        result = run_staged_narration(
            exported,
            backend,
            should_cancel=lambda: sum(
                prompt.startswith("Write one concise chapter title")
                for prompt in backend.prompts
            ) >= 1,
            cache=cache,
        )
    assert len(backend.prompts) == 2
    assert [chapter.title_status for chapter in result.chapters] == [
        "deterministic template",
        "deterministic template",
        "model interpretation",
    ]
    assert result.summary is not None and result.summary.source == "model"


def test_step_explanation_is_redacted_cached_and_trivial_steps_skip_model(
    tmp_path: Path,
) -> None:
    exported = _export(tmp_path)
    secret = "password=synthetic-step-secret"
    changed = exported.records[-1].model_copy(update={"tool_response": {"output": secret}})
    exported = exported.model_copy(update={"records": [exported.records[0], changed]})
    backend = ChapterBackend()
    cache_dir = tmp_path / "cache"
    with PersistentNarrationCache(cache_dir) as cache:
        first = explain_step_on_demand(exported, 2, backend, cache=cache)
        calls = len(backend.prompts)
        second = explain_step_on_demand(exported, 2, backend, cache=cache)
    assert first == second
    assert len(backend.prompts) == calls
    assert secret not in "\n".join(backend.prompts)
    assert "synthetic-step-secret" not in "\n".join(backend.prompts)

    trivial_root = tmp_path / "trivial"
    trivial_root.mkdir()
    trivial_export = _many_steps(_export(trivial_root), 1, changed=False)
    trivial_backend = ChapterBackend()
    with PersistentNarrationCache(tmp_path / "trivial-cache") as cache:
        trivial = explain_step_on_demand(
            trivial_export, 1, trivial_backend, cache=cache
        )
    assert trivial_backend.prompts == []
    assert trivial.explanation is not None
    assert trivial.explanation.label == "deterministic note"


def test_selection_redaction_cache_trivial_skip_and_32_step_cap(tmp_path: Path) -> None:
    exported = _many_steps(_export(tmp_path), 40)
    secret = "password=synthetic-selection-secret"
    records = [
        record.model_copy(update={"tool_response": {"output": secret}})
        for record in exported.records
    ]
    exported = exported.model_copy(update={"records": records})
    backend = ChapterBackend()
    cache_dir = tmp_path / "cache"
    with PersistentNarrationCache(cache_dir) as cache:
        first = summarize_selection_on_demand(exported, 1, 40, backend, cache=cache)
        calls = len(backend.prompts)
        second = summarize_selection_on_demand(exported, 1, 40, backend, cache=cache)
    assert first == second
    assert first.checked_claim_steps == 32
    assert first.total_steps == 40
    assert len(
        [
            prompt
            for prompt in backend.prompts
            if prompt.startswith("Select only salient atomic claims")
        ]
    ) == 32
    assert len(backend.prompts) == 33
    assert len(backend.prompts) == calls
    assert "synthetic-selection-secret" not in "\n".join(backend.prompts)

    trivial_root = tmp_path / "trivial"
    trivial_root.mkdir()
    trivial_export = _many_steps(_export(trivial_root), 4, changed=False)
    trivial_backend = ChapterBackend()
    with PersistentNarrationCache(tmp_path / "trivial-cache") as cache:
        trivial = summarize_selection_on_demand(
            trivial_export, 1, 4, trivial_backend, cache=cache
        )
    assert trivial_backend.prompts == []
    assert trivial.checked_claim_steps == 0
    assert trivial.source == "deterministic_facts"
