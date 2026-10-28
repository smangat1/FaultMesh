from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.inference.backends import BackendResult
from faultmesh.replay.chapters import (
    ChapterProposal,
    ChapterProposalBatch,
    baseline_chapters,
    propose_chapters,
    validate_chapter_proposals,
)
from faultmesh.replay.models import ReplayExport
from faultmesh.replay.narration import (
    LocalNarrationWorker,
    ReplayNarrationExport,
    StaleNarrationRequest,
    build_no_model_narration,
    inventory_local_models,
    load_replay_document,
)
from faultmesh.replay.store import ReplayStore
from faultmesh.replay.views import export_session


def _export(tmp_path: Path) -> ReplayExport:
    project = tmp_path / "project"
    project.mkdir()
    source = project / "value.py"
    source.write_text("def value() -> int:\n    return 1\n", encoding="utf-8")
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(project, codex_version="synthetic")
        source.write_text("def value() -> int:\n    return 2\n", encoding="utf-8")
        store.capture_checkpoint(session.id, provenance="test")
        return export_session(store, session.id)


def test_deterministic_chapters_cover_every_event_with_stable_ids(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    chapters = baseline_chapters(exported, fixed_group_size=1)
    repeated = baseline_chapters(exported, fixed_group_size=1)
    assert [(item.start_sequence, item.end_sequence) for item in chapters] == [(1, 1), (2, 2)]
    assert [item.id for item in chapters] == [item.id for item in repeated]
    assert all(item.title_status == "deterministic template" for item in chapters)


def test_model_chapters_require_gap_free_coverage_and_real_links(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    records = sorted(exported.records, key=lambda item: item.sequence)
    valid = ChapterProposalBatch(
        chapters=[
            ChapterProposal(
                start_sequence=1,
                end_sequence=2,
                title="Update value",
                evidence_refs=[f"record:{item.id}" for item in records],
            )
        ]
    )
    chapters = validate_chapter_proposals(exported, valid)
    assert chapters[0].source == "model"
    assert chapters[0].title_status == "model interpretation"
    invalid = valid.model_copy(
        update={
            "chapters": [
                valid.chapters[0].model_copy(
                    update={"start_sequence": 2, "evidence_refs": ["record:invented"]}
                )
            ]
        }
    )
    with pytest.raises(ValueError):
        validate_chapter_proposals(exported, invalid)


@dataclass
class InvalidChapterBackend:
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        return BackendResult(
            text=json.dumps(
                {
                    "schema_version": "replay-chapter-proposals-1.0",
                    "chapters": [
                        {
                            "start_sequence": 2,
                            "end_sequence": 2,
                            "title": "Partial",
                            "evidence_refs": ["record:invented"],
                        }
                    ],
                }
            ),
            backend="test",
            model="test",
            hardware="test",
            latency_ms=1,
        )


def test_invalid_timeout_and_long_model_chapter_jobs_fall_back(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    invalid = propose_chapters(exported, InvalidChapterBackend())
    bounded = propose_chapters(exported, InvalidChapterBackend(), max_events=1)
    assert invalid.fallback_used is True
    assert bounded.fallback_used is True
    assert invalid.chapters == baseline_chapters(exported)
    assert "bounded chapter context" in (bounded.error or "")


def test_no_model_enriched_export_round_trip_and_old_export_compatibility(
    tmp_path: Path,
) -> None:
    exported = _export(tmp_path)
    old_path = tmp_path / "old.json"
    new_path = tmp_path / "new.json"
    old_path.write_text(exported.model_dump_json(indent=2), encoding="utf-8")
    enriched = build_no_model_narration(exported)
    new_path.write_text(enriched.model_dump_json(indent=2), encoding="utf-8")
    loaded_old = load_replay_document(old_path)
    loaded_new = load_replay_document(new_path)
    assert loaded_old.schema_version == "replay-export-1.0"
    assert isinstance(loaded_new, ReplayNarrationExport)
    assert loaded_new.schema_version == "replay-export-2.0"
    assert loaded_new.chapter_run.fallback_used is True
    assert all(step.claims.fallback_used for step in loaded_new.narration)


def test_single_worker_discards_stale_result_and_runs_one_at_a_time() -> None:
    started = threading.Event()
    release = threading.Event()

    def slow() -> str:
        started.set()
        assert release.wait(timeout=2)
        return "old"

    with LocalNarrationWorker[str]() as worker:
        first = worker.submit(slow)
        assert started.wait(timeout=2)
        second = worker.submit(lambda: "new")
        release.set()
        with pytest.raises(StaleNarrationRequest):
            first.result(timeout=2)
        assert second.result(timeout=2) == "new"


def test_inventory_hashes_only_selected_local_gguf_without_loading(tmp_path: Path) -> None:
    model = tmp_path / "tiny.gguf"
    model.write_bytes(b"not-real-weights")
    inventory = inventory_local_models([tmp_path], available_memory_bytes=8 * 1024**3)
    assert inventory.available_memory_bytes == 8 * 1024**3
    assert inventory.gguf_files[0].path == str(model)
    assert inventory.gguf_files[0].sha256 == hashlib.sha256(b"not-real-weights").hexdigest()


def test_cli_no_model_narration_and_schemas(tmp_path: Path) -> None:
    exported = _export(tmp_path)
    source = tmp_path / "source.json"
    output = tmp_path / "narrated.json"
    source.write_text(exported.model_dump_json(indent=2), encoding="utf-8")
    runner = CliRunner()
    result = runner.invoke(
        app,
        ["replay-narrate", str(source), "--out", str(output), "--backend", "none"],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["mode"] == "no-model"
    assert load_replay_document(output).schema_version == "replay-export-2.0"
    for contract in ("narration-export", "claims", "chapter-proposals"):
        schema = runner.invoke(app, ["replay-schema", contract])
        assert schema.exit_code == 0
        assert json.loads(schema.output)["type"] == "object"
