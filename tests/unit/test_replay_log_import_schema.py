from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from faultmesh.replay.models import (
    AttributionStatus,
    CaptureEnvelope,
    Completeness,
    ImportSource,
    RecordKind,
    ReplayExport,
    ReplayRecord,
    ReplaySession,
)
from faultmesh.replay.narration import ReplayNarrationExport, load_replay_document

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"
V1_FIXTURE = FIXTURE_ROOT / "fixture_replay_v1_nomodel.json"
V2_FIXTURE = FIXTURE_ROOT / "fixture_replay_v2_enriched.json"

SESSION_IMPORT_FIELDS = {"import_source", "format_version", "source_file_sha256"}
RECORD_IMPORT_FIELDS = {
    "source_item_id",
    "prompt_id",
    "prompt_text",
    "file_state",
    "edit_patch",
    "edit_command",
    "redaction_types",
}


def test_all_existing_replay_fixtures_validate_unchanged() -> None:
    CaptureEnvelope.model_validate_json(
        (FIXTURE_ROOT / "capture_initial.json").read_text(encoding="utf-8")
    )
    capture_lines = (FIXTURE_ROOT / "capture_sequence.ndjson").read_text(encoding="utf-8")
    assert all(
        CaptureEnvelope.model_validate_json(line) for line in capture_lines.splitlines() if line
    )

    v1 = load_replay_document(V1_FIXTURE)
    v2 = load_replay_document(V2_FIXTURE)
    narration_examples = json.loads(
        (FIXTURE_ROOT / "narration_examples.json").read_text(encoding="utf-8")
    )

    assert isinstance(v1, ReplayExport)
    assert isinstance(v2, ReplayNarrationExport)
    assert narration_examples["schema_version"] == "replay-narration-examples-1.0"
    assert narration_examples["sanitized"] is True
    assert v1.session.import_source is None
    assert v2.session.import_source is None
    assert all(record.prompt_text is None for record in [*v1.records, *v2.records])


def test_existing_literals_are_frozen() -> None:
    assert {item.value for item in RecordKind} == {
        "initial_snapshot",
        "pre_tool",
        "post_tool",
        "checkpoint",
        "gap",
        "unsupported",
    }
    assert {item.value for item in Completeness} == {
        "complete",
        "partial",
        "missing",
        "unsupported",
    }
    assert {item.value for item in AttributionStatus} == {
        "not_applicable",
        "tool_boundary",
        "observed_checkpoint",
        "unknown",
    }


@pytest.mark.parametrize("export_model", [ReplayExport, ReplayNarrationExport])
def test_history_import_fields_are_optional_in_export_schema(
    export_model: type[ReplayExport] | type[ReplayNarrationExport],
) -> None:
    schema = export_model.model_json_schema()
    session_schema = schema["$defs"]["ReplaySession"]
    record_schema = schema["$defs"]["ReplayRecord"]

    assert set(session_schema["properties"]) >= SESSION_IMPORT_FIELDS
    assert set(record_schema["properties"]) >= RECORD_IMPORT_FIELDS
    assert SESSION_IMPORT_FIELDS.isdisjoint(session_schema["required"])
    assert RECORD_IMPORT_FIELDS.isdisjoint(record_schema["required"])


def test_history_import_fields_round_trip_when_present() -> None:
    value = json.loads(V1_FIXTURE.read_text(encoding="utf-8"))
    value["session"].update(
        {
            "import_source": "codex",
            "format_version": "synthetic-codex-v1",
            "source_file_sha256": "a" * 64,
        }
    )
    value["records"][0].update(
        {
            "source_item_id": "item-synthetic-1",
            "prompt_id": "prompt-synthetic-1",
            "prompt_text": "Review [redacted: api key] safely.",
            "file_state": "unknown",
            "edit_patch": "@@ synthetic patch @@",
            "edit_command": "write synthetic.py",
            "redaction_types": ["api key"],
            "provenance": "history_import",
            "completeness": "partial",
            "attribution_status": "unknown",
        }
    )

    exported = ReplayExport.model_validate(value)
    round_tripped = ReplayExport.model_validate_json(exported.model_dump_json())
    record = round_tripped.records[0]

    assert round_tripped.session.import_source is ImportSource.CODEX
    assert round_tripped.session.source_file_sha256 == "a" * 64
    assert record.prompt_text == "Review [redacted: api key] safely."
    assert record.file_state == "unknown"
    assert record.edit_patch == "@@ synthetic patch @@"
    assert record.redaction_types == ["api key"]


def test_history_import_fields_reject_invalid_closed_values() -> None:
    fixture = json.loads(V1_FIXTURE.read_text(encoding="utf-8"))
    session = ReplaySession.model_validate(fixture["session"])
    record = ReplayRecord.model_validate(fixture["records"][0])

    with pytest.raises(ValidationError):
        ReplaySession.model_validate(
            {**session.model_dump(mode="json"), "source_file_sha256": "not-a-digest"}
        )
    with pytest.raises(ValidationError):
        ReplayRecord.model_validate(
            {**record.model_dump(mode="json"), "file_state": "reconstructed"}
        )
