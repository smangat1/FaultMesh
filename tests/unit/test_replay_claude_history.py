from __future__ import annotations

import json
from pathlib import Path

from faultmesh.replay.claude_history import (
    SYNTHETIC_CLAUDE_FORMAT_VERSION,
    decode_claude_project_name,
    parse_claude_history,
)
from faultmesh.replay.models import Completeness, ImportSource, RecordKind

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay" / "claude_history"


def test_normal_synthetic_history_maps_prompts_tools_edits_flags_and_snapshots() -> None:
    source = FIXTURE_ROOT / "-synthetic-example-project" / "normal.jsonl"
    result = parse_claude_history(source)

    assert result.parse_status == "ok"
    assert result.session.import_source is ImportSource.CLAUDE_CODE
    assert result.session.format_version == SYNTHETIC_CLAUDE_FORMAT_VERSION
    assert result.session.source_file_sha256 is not None
    assert result.raw_project_name == "-synthetic-example-project"
    assert result.decoded_project_path == "/synthetic/example/project"
    assert result.project_display_name == "project"
    assert result.project_group_key == result.session.project_root_sha256
    assert result.sidechain_entries == 2
    assert result.subagent_entries == 2
    assert result.meta_entries == 1
    assert result.system_entries == 1
    assert result.file_history_entries == 1
    assert result.gaps == 0
    assert result.unsupported == 0
    assert len(result.records) == 15

    prompt = result.records[0]
    assert prompt.prompt_id == "user-1"
    assert prompt.prompt_text is not None
    assert "[redacted: api key]" in prompt.prompt_text
    assert "synthetic_value" not in prompt.prompt_text
    assert prompt.redaction_types == ["api key", "password"]

    calls = [record for record in result.records if record.record_type is RecordKind.PRE_TOOL]
    results = [record for record in result.records if record.record_type is RecordKind.POST_TOOL]
    assert {record.tool_name for record in calls} == {
        "Bash",
        "Edit",
        "MultiEdit",
        "Read",
        "Write",
    }
    assert {record.tool_name for record in results} == {
        "Bash",
        "Edit",
        "MultiEdit",
        "Read",
        "Write",
    }
    assert all(record.file_state == "unknown" for record in [*calls, *results])

    edit = next(record for record in calls if record.tool_name == "Edit")
    write = next(record for record in calls if record.tool_name == "Write")
    multi = next(record for record in calls if record.tool_name == "MultiEdit")
    bash = next(record for record in calls if record.tool_name == "Bash")
    assert "value.py" in (edit.edit_patch or "")
    assert "/synthetic/example/project" not in (edit.edit_patch or "")
    assert "generated.py" in (write.edit_patch or "")
    assert "source old 2" in (multi.edit_patch or "")
    assert "write_text" in (bash.edit_command or "")
    assert "[redacted: password]" in (edit.edit_patch or "")
    assert "[redacted: api key]" in (write.edit_patch or "")
    assert "[redacted: password]" in (bash.edit_command or "")
    assert edit.redaction_types == ["password"]
    assert write.redaction_types == ["api key"]
    assert bash.redaction_types == ["password"]

    edit_result = next(record for record in results if record.tool_use_id == "tool-edit")
    write_result = next(record for record in results if record.tool_use_id == "tool-write")
    bash_result = next(record for record in results if record.tool_use_id == "tool-bash")
    assert edit_result.tool_response == "password=[redacted: password]"
    assert write_result.tool_response == '{"password":"[redacted: password]"}'
    assert "[redacted: url password]" in str(bash_result.tool_response)

    sidechain = next(record for record in calls if record.tool_name == "Read")
    assert sidechain.tool_input == {
        "history_flags": ["sidechain", "subagent"],
        "value": {"file_path": "/synthetic/example/project/value.py"},
    }
    meta = next(record for record in result.records if record.tool_name == "ClaudeMeta")
    system = next(record for record in result.records if record.tool_name == "ClaudeSystem")
    snapshot = next(
        record for record in result.records if record.tool_name == "ClaudeFileHistorySnapshot"
    )
    assert meta.tool_response == {
        "history_flags": ["meta"],
        "value": "synthetic metadata note",
    }
    assert system.tool_response == {
        "history_flags": ["system"],
        "value": "synthetic system note",
    }
    assert snapshot.file_state == "unknown"
    assert snapshot.completeness is Completeness.PARTIAL
    assert snapshot.tool_response == {
        "history_flags": ["file_history_snapshot_untrusted"],
        "value": {"files": [{"content": "VALUE = 2", "path": "value.py"}]},
    }
    assert all("normal.jsonl" not in record.source_identity for record in result.records)


def test_resumed_synthetic_history_deduplicates_repeated_uuids() -> None:
    source = FIXTURE_ROOT / "-synthetic-resumed-project" / "resumed.jsonl"
    result = parse_claude_history(source)

    assert result.parse_status == "ok"
    assert result.duplicate_items == 2
    assert len(result.records) == 3
    assert [record.source_item_id for record in result.records] == [
        "resume-user-shared",
        "resume-tool-shared",
        "resume-user-new",
    ]


def test_unknown_synthetic_version_is_visible_and_unsupported() -> None:
    source = FIXTURE_ROOT / "-synthetic-unknown-project" / "unknown_version.jsonl"
    result = parse_claude_history(source)

    assert result.parse_status == "unsupported"
    assert result.session.format_version == "claude-code-jsonl-unknown-99"
    assert result.unsupported == 1
    assert len(result.records) == 1
    assert result.records[0].record_type is RecordKind.UNSUPPORTED
    assert result.records[0].gap_reason == "unsupported_claude_format_version"


def test_corrupt_line_is_visible_and_valid_synthetic_records_continue() -> None:
    source = FIXTURE_ROOT / "-synthetic-corrupt-project" / "corrupt.jsonl"
    result = parse_claude_history(source)

    assert result.parse_status == "partial"
    assert result.gaps == 1
    assert len(result.records) == 3
    assert [record.record_type for record in result.records] == [
        RecordKind.CHECKPOINT,
        RecordKind.GAP,
        RecordKind.CHECKPOINT,
    ]
    assert result.records[1].gap_reason == "corrupt_jsonl_record"


def test_empty_synthetic_session_is_visible_and_unsupported() -> None:
    source = FIXTURE_ROOT / "-synthetic-empty-project" / "empty.jsonl"
    result = parse_claude_history(source)

    assert result.parse_status == "unsupported"
    assert result.unsupported == 1
    assert result.records[0].gap_reason == "empty_claude_history"


def test_unknown_record_and_line_version_mismatch_are_visible(tmp_path: Path) -> None:
    project = tmp_path / "-synthetic-future-project"
    project.mkdir()
    source = project / "future.jsonl"
    records = [
        {
            "formatVersion": SYNTHETIC_CLAUDE_FORMAT_VERSION,
            "version": "2.1.0-synthetic",
            "uuid": "future-user",
            "sessionId": "synthetic-claude-future",
            "timestamp": "2026-10-28T19:00:00Z",
            "cwd": "/synthetic/future/project",
            "type": "user",
            "message": {"role": "user", "content": "Known line."},
        },
        {
            "formatVersion": SYNTHETIC_CLAUDE_FORMAT_VERSION,
            "uuid": "future-record",
            "sessionId": "synthetic-claude-future",
            "timestamp": "2026-10-28T19:00:01Z",
            "type": "future-record",
        },
        {
            "formatVersion": "claude-code-jsonl-synthetic-2",
            "uuid": "future-version",
            "sessionId": "synthetic-claude-future",
            "timestamp": "2026-10-28T19:00:02Z",
            "type": "user",
            "message": {"role": "user", "content": "Mismatched line."},
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    result = parse_claude_history(source)

    assert result.parse_status == "partial"
    assert result.unsupported == 2
    assert [
        record.gap_reason
        for record in result.records
        if record.record_type is RecordKind.UNSUPPORTED
    ] == [
        "unsupported_claude_record_type",
        "claude_record_format_version_mismatch",
    ]


def test_project_folder_decode_is_explicitly_best_effort() -> None:
    assert decode_claude_project_name("-synthetic-example-project") == (
        "/synthetic/example/project"
    )
    assert decode_claude_project_name("relative-project") == "/relative/project"
