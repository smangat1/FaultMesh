from __future__ import annotations

import base64
import json
import shutil
from pathlib import Path

from faultmesh.replay.codex_history import parse_codex_history
from faultmesh.replay.models import Completeness, ImportSource, RecordKind

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay" / "codex_history"


def test_normal_history_maps_prompts_completed_tools_edits_and_timing() -> None:
    result = parse_codex_history(FIXTURE_ROOT / "normal.jsonl")

    assert result.parse_status == "ok"
    assert result.session.import_source is ImportSource.CODEX
    assert result.session.format_version == "0.165.0-alpha.1.2"
    assert result.session.source_file_sha256 is not None
    assert result.project_display_name == "example-project"
    assert result.project_group_key == result.session.project_root_sha256
    assert result.duplicate_items == 1
    assert result.gaps == 0
    assert result.unsupported == 0
    assert len(result.records) == 9
    assert [record.sequence for record in result.records] == list(range(1, 10))
    assert [record.source_item_id for record in result.records] == [
        "prompt-1",
        "low-level-call",
        "low-level-output",
        "command-test",
        "command-write",
        "file-change-1",
        "mcp-1",
        "unrelated-call",
        "unrelated-output",
    ]
    assert all(record.completeness is Completeness.PARTIAL for record in result.records)

    prompt = result.records[0]
    assert prompt.record_type is RecordKind.CHECKPOINT
    assert prompt.prompt_id == "prompt-1"
    assert prompt.turn_id == "turn-1"
    assert prompt.prompt_text is not None
    assert "[redacted: api key]" in prompt.prompt_text
    assert "synthetic_value" not in prompt.prompt_text
    assert prompt.redaction_types == ["api key", "password"]

    commands = [record for record in result.records if record.tool_name == "Bash"]
    assert len(commands) == 2
    assert commands[0].edit_command is None
    assert "write_text" in (commands[1].edit_command or "")
    assert commands[0].captured_at == commands[0].source_timestamp
    assert commands[0].tool_response == {
        "aggregated_output": '{"password":"[redacted: password]"}',
        "duration": {"nanos": 0, "secs": 1},
        "exit_code": 0,
        "status": "completed",
    }
    assert "[redacted: password]" in (commands[1].edit_command or "")
    assert "FM_CODEX_COMMAND_SUFFIX" not in (commands[1].edit_command or "")

    file_change = next(record for record in result.records if record.tool_name == "FileChange")
    assert file_change.file_state == "unknown"
    assert file_change.edit_patch is not None
    assert "value.py" in file_change.edit_patch
    assert "/synthetic/example-project" not in file_change.edit_patch
    assert "[redacted: password]" in file_change.edit_patch
    assert file_change.redaction_types == ["password"]

    mcp = next(record for record in result.records if record.tool_name == "synthetic.lookup")
    assert mcp.tool_input == {"query": '{"api_key":"[redacted: api key]"}'}
    assert mcp.redaction_types == ["api key", "secret"]
    unrelated = [record for record in result.records if record.tool_use_id == "unrelated"]
    assert [record.source_item_id for record in unrelated] == [
        "unrelated-call",
        "unrelated-output",
    ]
    assert unrelated[0].tool_input == {"query": "safe synthetic query"}
    assert unrelated[1].tool_response == {"status": "synthetic failure"}
    assert all("normal.jsonl" not in record.source_identity for record in result.records)


def test_resumed_history_deduplicates_repeated_stable_item_ids() -> None:
    result = parse_codex_history(FIXTURE_ROOT / "resumed.jsonl")

    assert result.parse_status == "ok"
    assert result.duplicate_items == 2
    assert len(result.records) == 3
    assert [record.source_item_id for record in result.records] == [
        "prompt-shared",
        "command-shared",
        "prompt-new",
    ]
    assert len({record.source_item_id for record in result.records}) == 3


def test_unknown_version_is_one_visible_unsupported_record() -> None:
    result = parse_codex_history(FIXTURE_ROOT / "unknown_version.jsonl")

    assert result.parse_status == "unsupported"
    assert result.session.format_version == "99.0.0"
    assert result.unsupported == 1
    assert len(result.records) == 1
    assert result.records[0].record_type is RecordKind.UNSUPPORTED
    assert result.records[0].completeness is Completeness.UNSUPPORTED
    assert result.records[0].gap_reason == "unsupported_codex_format_version"


def test_corrupt_line_is_a_visible_gap_and_valid_records_continue() -> None:
    result = parse_codex_history(FIXTURE_ROOT / "corrupt.jsonl")

    assert result.parse_status == "partial"
    assert result.gaps == 1
    assert len(result.records) == 2
    assert result.records[0].record_type is RecordKind.GAP
    assert result.records[0].gap_reason == "corrupt_jsonl_record"
    assert result.records[1].prompt_id == "prompt-after-corrupt"


def test_empty_session_is_visible_and_unsupported() -> None:
    result = parse_codex_history(FIXTURE_ROOT / "empty.jsonl")

    assert result.parse_status == "unsupported"
    assert result.unsupported == 1
    assert result.records[0].record_type is RecordKind.UNSUPPORTED
    assert result.records[0].gap_reason == "empty_codex_history"


def test_compressed_history_uses_local_zstd_or_is_visibly_unsupported(
    tmp_path: Path,
) -> None:
    compressed = tmp_path / "normal.jsonl.zst"
    compressed.write_bytes(
        base64.b64decode((FIXTURE_ROOT / "normal.jsonl.zst.b64").read_text(encoding="ascii"))
    )

    missing = parse_codex_history(compressed, allow_zstd_lookup=False)
    assert missing.parse_status == "unsupported"
    assert missing.records[0].gap_reason == "zstd_executable_not_found"

    executable = shutil.which("zstd")
    if executable is not None:
        parsed = parse_codex_history(compressed, zstd_executable=executable)
        assert parsed.parse_status == "ok"
        assert parsed.session.id == "synthetic-session-normal"
        assert len(parsed.records) == 9
        assert "FM_" not in parsed.session.model_dump_json()
        assert all("FM_" not in record.model_dump_json() for record in parsed.records)


def test_low_level_call_and_result_are_fallback_when_completed_items_are_absent(
    tmp_path: Path,
) -> None:
    source = tmp_path / "low-level.jsonl"
    records = [
        {
            "timestamp": "2026-10-28T14:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": "synthetic-low-level",
                "session_id": "synthetic-low-level",
                "timestamp": "2026-10-28T14:00:00Z",
                "cwd": "/synthetic/low-level-project",
                "cli_version": "0.165.0-alpha.1.2",
            },
            "ordinal": 0,
        },
        {
            "timestamp": "2026-10-28T14:00:01Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "id": "call-item",
                "call_id": "call-1",
                "name": "synthetic_tool",
                "arguments": {"value": "safe"},
            },
            "ordinal": 1,
        },
        {
            "timestamp": "2026-10-28T14:00:02Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "id": "output-item",
                "call_id": "call-1",
                "output": {"status": "ok"},
            },
            "ordinal": 2,
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    result = parse_codex_history(source)

    assert [record.record_type for record in result.records] == [
        RecordKind.PRE_TOOL,
        RecordKind.POST_TOOL,
    ]
    assert all(record.tool_use_id == "call-1" for record in result.records)
    assert result.records[0].tool_input == {"value": "safe"}
    assert result.records[1].tool_response == {"status": "ok"}


def test_unmatched_low_level_call_remains_visible_with_completed_tools(
    tmp_path: Path,
) -> None:
    source = tmp_path / "active-call.jsonl"
    active_call = {
        "timestamp": "2026-10-28T10:00:11Z",
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "id": "active-call-item",
            "call_id": "active-call",
            "name": "exec",
            "input": "still running",
            "status": "in_progress",
        },
        "ordinal": 11,
    }
    orphan_output = {
        "timestamp": "2026-10-28T10:00:12Z",
        "type": "response_item",
        "payload": {
            "type": "function_call_output",
            "id": "orphan-output-item",
            "call_id": "orphan-output",
            "output": {"status": "unmatched failure"},
        },
        "ordinal": 12,
    }
    source.write_text(
        (FIXTURE_ROOT / "normal.jsonl").read_text(encoding="utf-8")
        + json.dumps(active_call, separators=(",", ":"))
        + "\n"
        + json.dumps(orphan_output, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )

    result = parse_codex_history(source)
    active = next(
        record for record in result.records if record.source_item_id == "active-call-item"
    )

    assert active.record_type is RecordKind.PRE_TOOL
    assert active.tool_use_id == "active-call"
    assert active.tool_input == "still running"
    orphan = next(
        record for record in result.records if record.source_item_id == "orphan-output-item"
    )
    assert orphan.record_type is RecordKind.POST_TOOL
    assert orphan.tool_use_id == "orphan-output"
    assert orphan.tool_response == {"status": "unmatched failure"}


def test_explicit_completed_call_id_deduplicates_only_its_low_level_pair(
    tmp_path: Path,
) -> None:
    source = tmp_path / "explicit-relation.jsonl"
    records = [
        {
            "timestamp": "2026-10-28T20:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": "synthetic-explicit-relation",
                "session_id": "synthetic-explicit-relation",
                "timestamp": "2026-10-28T20:00:00Z",
                "cwd": "/synthetic/explicit-relation",
                "cli_version": "0.165.0-alpha.1.2",
            },
            "ordinal": 0,
        },
        {
            "timestamp": "2026-10-28T20:00:01Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "id": "duplicate-low-call",
                "call_id": "explicit-call-id",
                "name": "synthetic_tool",
                "arguments": {"query": "safe"},
            },
            "ordinal": 1,
        },
        {
            "timestamp": "2026-10-28T20:00:02Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "id": "duplicate-low-output",
                "call_id": "explicit-call-id",
                "output": {"status": "ok"},
            },
            "ordinal": 2,
        },
        {
            "timestamp": "2026-10-28T20:00:03Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "turn_id": "turn-explicit",
                "item": {
                    "type": "McpToolCall",
                    "id": "completed-high-item",
                    "call_id": "explicit-call-id",
                    "server": "synthetic",
                    "tool": "lookup",
                    "arguments": {"query": "safe"},
                    "result": {"status": "ok"},
                    "status": "completed",
                },
            },
            "ordinal": 3,
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    result = parse_codex_history(source)

    assert result.parse_status == "ok"
    assert result.duplicate_items == 2
    assert [record.source_item_id for record in result.records] == ["completed-high-item"]
    assert result.records[0].tool_use_id == "completed-high-item"


def test_injected_prompt_blocks_are_skipped_and_mixed_text_is_preserved(
    tmp_path: Path,
) -> None:
    source = tmp_path / "injected-context.jsonl"
    injected = "<environment_context><cwd>/synthetic</cwd></environment_context>"
    mixed = f"{injected}\nPlease keep this real synthetic request"
    records = [
        {
            "timestamp": "2026-10-29T12:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": "synthetic-context-parser",
                "timestamp": "2026-10-29T12:00:00Z",
                "cwd": "/synthetic/project",
                "cli_version": "0.165.0-alpha.1.2",
            },
        },
        {
            "timestamp": "2026-10-29T12:00:01Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": "context-only",
                "content": [{"type": "input_text", "text": injected}],
            },
        },
        {
            "timestamp": "2026-10-29T12:00:02Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": "mixed-canonical",
                "content": [{"type": "input_text", "text": mixed}],
            },
        },
        {
            "timestamp": "2026-10-29T12:00:03Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "item": {
                    "type": "UserMessage",
                    "id": "mixed-completed",
                    "content": [{"type": "input_text", "text": mixed}],
                },
            },
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    result = parse_codex_history(source)
    prompts = [record for record in result.records if record.prompt_text is not None]

    assert len(prompts) == 1
    assert prompts[0].prompt_text == "Please keep this real synthetic request"
    assert result.injected_context_messages == 3
    assert result.duplicate_items == 1


def test_missing_timestamps_use_nearest_event_and_preserve_nonmonotonic_source_order(
    tmp_path: Path,
) -> None:
    source = tmp_path / "timestamp-gaps.jsonl"
    records = [
        {
            "timestamp": "2026-10-29T12:00:00Z",
            "type": "session_meta",
            "payload": {
                "id": "synthetic-timestamp-gaps",
                "timestamp": "2026-10-29T12:00:00Z",
                "cwd": "/synthetic/project",
                "cli_version": "0.165.0-alpha.1.2",
            },
        },
        {
            "timestamp": "2026-10-29T12:02:00Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": "timed-prompt",
                "content": [{"type": "input_text", "text": "Synthetic timed prompt"}],
            },
        },
        {
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "item": {
                    "type": "CommandExecution",
                    "id": "missing-time-command",
                    "command": ["python -m pytest -q"],
                    "aggregated_output": "synthetic output",
                    "status": "completed",
                },
            },
        },
        {
            "timestamp": "2026-10-29T11:59:00Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "item": {
                    "type": "CommandExecution",
                    "id": "out-of-order-command",
                    "command": ["python -m pytest tests/unit -q"],
                    "aggregated_output": "synthetic output",
                    "status": "completed",
                },
            },
        },
    ]
    source.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )

    result = parse_codex_history(source)
    inferred = next(record for record in result.records if record.timestamp_inferred)

    assert inferred.source_timestamp is None
    assert inferred.captured_at.isoformat() == "2026-10-29T12:02:00+00:00"
    assert all(record.captured_at.year != 1970 for record in result.records)
    assert result.missing_timestamp_fallbacks == 1
    assert result.out_of_order_steps == 1
    assert [record.source_item_id for record in result.records] == [
        "timed-prompt",
        "missing-time-command",
        "out-of-order-command",
    ]
