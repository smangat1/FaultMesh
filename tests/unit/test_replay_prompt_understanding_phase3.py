from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.narration_runner import (
    PROMPT_UNDERSTANDING_MAX_GROUPS,
    PROMPT_UNDERSTANDING_MAX_PACKET_BYTES,
    PersistentNarrationCache,
    build_prompt_understanding_packet,
    run_staged_narration,
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


def _many_prompts(exported: Any, count: int):  # type: ignore[no-untyped-def]
    record = exported.records[-1]
    entry = exported.timeline[-1]
    records = []
    timeline = []
    for sequence in range(1, count + 1):
        prompt_id = f"prompt-{sequence}"
        records.append(
            record.model_copy(
                update={
                    "id": f"record:{sequence}",
                    "source_identity": f"source:{sequence}",
                    "source_offset": sequence,
                    "sequence": sequence,
                    "turn_id": f"turn:{sequence}",
                    "prompt_id": prompt_id,
                    "prompt_text": f"Synthetic request {sequence}",
                }
            )
        )
        timeline.append(
            entry.model_copy(
                update={
                    "record_id": f"record:{sequence}",
                    "sequence": sequence,
                }
            )
        )
    return exported.model_copy(update={"records": records, "timeline": timeline})


@dataclass
class UnderstandingBackend:
    prompts: list[str] = field(default_factory=list)

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        return self.generate_with_limit(prompt, json_schema, max_output_tokens=999)

    def generate_with_limit(
        self,
        prompt: str,
        json_schema: dict[str, Any],
        *,
        max_output_tokens: int,
    ) -> BackendResult:
        del max_output_tokens
        self.prompts.append(prompt)
        properties = json_schema.get("properties", {})
        if "claims" in properties:
            value: object = {"schema_version": "replay-claims-1.0", "claims": []}
        elif "title" in properties:
            value: object = {"title": "Model chapter"}
        elif "sentences" in properties and "prompts" in properties:
            facts = json.loads(prompt.split("Facts:\n", 1)[1])
            value = {
                "sentences": [
                    "Recorded prompts describe the session.",
                    "Recorded file and command facts remain evidence.",
                    "Unknown details remain unknown.",
                ],
                "prompts": [
                    {
                        "prompt_id": item["prompt_id"],
                        "text": f"Recorded evidence for {item['prompt_id']}.",
                    }
                    for item in facts["prompts_newest_first"]
                ],
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


def test_1601_steps_make_one_bounded_newest_first_packet(tmp_path: Path) -> None:
    exported = _many_prompts(_export(tmp_path), 1_601)
    packet = build_prompt_understanding_packet(exported)
    encoded = json.dumps(packet, sort_keys=True, separators=(",", ":")).encode()

    assert packet["total_prompts"] == 1_601
    assert packet["included_prompts"] == PROMPT_UNDERSTANDING_MAX_GROUPS
    assert packet["truncated"] is True
    assert packet["prompts_newest_first"][0]["prompt_id"] == "prompt-1601"
    assert len(encoded) <= PROMPT_UNDERSTANDING_MAX_PACKET_BYTES


def test_understanding_is_one_cached_redacted_call_and_streams_prompt_lines(
    tmp_path: Path,
) -> None:
    exported = _many_prompts(_export(tmp_path), 3)
    secret = "password=synthetic-prompt-secret"
    records = list(exported.records)
    records[-1] = records[-1].model_copy(update={"prompt_text": secret})
    exported = exported.model_copy(
        update={
            "records": records,
            "session": exported.session.model_copy(update={"source_title": secret}),
        }
    )
    cache_dir = tmp_path / "cache"
    first_backend = UnderstandingBackend()
    streamed: list[tuple[int, int]] = []
    with PersistentNarrationCache(cache_dir) as cache:
        first = run_staged_narration(
            exported,
            first_backend,
            cache=cache,
            on_stage=lambda stage, done, total, partial: (
                streamed.append((done, total)) if stage == "prompt" else None
            ),
        )
    understanding_calls = [
        prompt
        for prompt in first_backend.prompts
        if prompt.startswith("Summarize this recorded coding session")
    ]
    assert len(understanding_calls) == 1
    assert "synthetic-prompt-secret" not in understanding_calls[0]
    assert "[redacted: password]" in understanding_calls[0]
    assert streamed == [(1, 3), (2, 3), (3, 3)]
    assert first.prompt_understanding is not None
    assert len(first.prompt_understanding.prompts) == 3

    second_backend = UnderstandingBackend()
    with PersistentNarrationCache(cache_dir) as cache:
        second = run_staged_narration(exported, second_backend, cache=cache)
    assert second == first
    assert second_backend.prompts == []


def test_prompt_stream_can_be_cancelled_without_losing_valid_partial_export(
    tmp_path: Path,
) -> None:
    exported = _many_prompts(_export(tmp_path), 3)
    backend = UnderstandingBackend()
    streamed = 0

    def on_stage(stage: str, done: int, total: int, partial: object) -> None:
        del done, total, partial
        nonlocal streamed
        if stage == "prompt":
            streamed += 1

    with PersistentNarrationCache(tmp_path / "cache") as cache:
        result = run_staged_narration(
            exported,
            backend,
            cache=cache,
            on_stage=on_stage,
            should_cancel=lambda: streamed >= 1,
        )

    assert streamed == 1
    assert result.prompt_understanding is not None
    assert len(result.prompt_understanding.prompts) == 1
    assert all(chapter.title_status == "deterministic template" for chapter in result.chapters)
