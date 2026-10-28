from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.adapter import capture_hook_event
from faultmesh.replay.ingest import ingest_jsonl
from faultmesh.replay.models import (
    StructuredTestEvidence,
)
from faultmesh.replay.models import (
    TestAssociation as ReplayTestAssociation,
)
from faultmesh.replay.models import (
    TestCaseEvidence as ReplayTestCaseEvidence,
)
from faultmesh.replay.models import (
    TestCounts as ReplayTestCounts,
)
from faultmesh.replay.models import (
    TestState as ReplayTestState,
)
from faultmesh.replay.store import ReplayStore
from faultmesh.replay.views import (
    export_session,
    load_export,
    select_checkpoint,
    select_export_checkpoint,
    timeline,
)


def _hook(root: Path, event: str, tool_id: str, command: str) -> dict[str, object]:
    value: dict[str, object] = {
        "hook_event_name": event,
        "tool_use_id": tool_id,
        "turn_id": "turn-1",
        "tool_name": "Bash" if "pytest" in command else "apply_patch",
        "cwd": str(root),
        "tool_input": {"command": command},
    }
    if event == "PostToolUse":
        value["tool_response"] = "" if "pytest" in command else {"status": "completed"}
    return value


def test_timeline_diff_symbols_tests_and_offline_selection(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    source = root / "value.py"
    source.write_text("def value() -> int:\n    return 1\n", encoding="utf-8")
    export_path = tmp_path / "replay.json"
    marker = root / "must-not-execute"
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        capture_hook_event(store, session.id, _hook(root, "PreToolUse", "edit", "patch"))
        source.write_text("def value() -> int:\n    return 2\n", encoding="utf-8")
        capture_hook_event(store, session.id, _hook(root, "PostToolUse", "edit", "patch"))
        edit_record = store.list_records(session.id)[-1]
        assert edit_record.before_manifest_id is not None
        assert edit_record.after_manifest_id is not None
        store.add_test_evidence(
            StructuredTestEvidence(
                id="test-failing-before",
                session_id=session.id,
                observed_at=datetime(2026, 1, 1, tzinfo=UTC),
                state=ReplayTestState.FAILED,
                suite_scope="tests/test_value.py::test_value",
                source="structured_fixture",
                associated_manifest_id=edit_record.before_manifest_id,
                association=ReplayTestAssociation.CONTENT_IDENTITY,
                counts=ReplayTestCounts(passed=0, failed=1, errors=0, skipped=0),
                tests=[
                    ReplayTestCaseEvidence(
                        node_id="tests/test_value.py::test_value",
                        state=ReplayTestState.FAILED,
                    )
                ],
            )
        )
        store.add_test_evidence(
            StructuredTestEvidence(
                id="test-passing-after",
                session_id=session.id,
                observed_at=datetime(2026, 1, 2, tzinfo=UTC),
                state=ReplayTestState.PASSED,
                suite_scope="tests/test_value.py::test_value",
                source="structured_fixture",
                associated_manifest_id=edit_record.after_manifest_id,
                association=ReplayTestAssociation.CONTENT_IDENTITY,
                counts=ReplayTestCounts(passed=1, failed=0, errors=0, skipped=0),
                tests=[
                    ReplayTestCaseEvidence(
                        node_id="tests/test_value.py::test_value",
                        state=ReplayTestState.PASSED,
                    )
                ],
            )
        )
        dangerous = f"python -c 'write {marker}' && python -m pytest -q"
        capture_hook_event(
            store, session.id, _hook(root, "PreToolUse", "pytest", dangerous)
        )
        capture_hook_event(
            store, session.id, _hook(root, "PostToolUse", "pytest", dangerous)
        )
        pytest_record = store.list_records(session.id)[-1]

        entries = timeline(store, session.id)
        pre_entry = next(
            item
            for item in entries
            if item.tool_use_id == "edit" and item.record_type.value == "pre_tool"
        )
        assert pre_entry.changed_files == []
        edit_entry = next(item for item in entries if item.record_id == edit_record.id)
        assert edit_entry.changed_files[0].change == "modified"
        assert "return 2" in (edit_entry.changed_files[0].unified_diff or "")
        assert edit_entry.changed_symbols[0].qualified_name == "value"
        assert edit_entry.changed_symbols[0].change == "modified"
        assert edit_entry.changed_symbols[0].verified is True
        pytest_entry = next(item for item in entries if item.record_id == pytest_record.id)
        command_observation = next(
            item for item in pytest_entry.test_evidence if item.source == "command_observation"
        )
        assert command_observation.state == ReplayTestState.INCOMPLETE
        assert command_observation.counts is None
        assert command_observation.association == ReplayTestAssociation.CONTENT_IDENTITY

        exported = export_session(store, session.id)
        export_path.write_text(exported.model_dump_json(indent=2) + "\n", encoding="utf-8")
        earlier_sequence = 1

    shutil.rmtree(root)
    loaded = load_export(export_path)
    earlier = select_export_checkpoint(loaded, earlier_sequence)
    later = select_export_checkpoint(loaded, edit_record.sequence)

    assert root.exists() is False
    assert earlier.files[0].text == "def value() -> int:\n    return 1\n"
    assert later.files[0].text == "def value() -> int:\n    return 2\n"
    assert marker.exists() is False
    assert {item.state for item in loaded.tests} >= {
        ReplayTestState.FAILED,
        ReplayTestState.PASSED,
        ReplayTestState.INCOMPLETE,
    }


def test_empty_and_syntax_error_views_keep_unknowns_honest(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with ReplayStore(tmp_path / "empty-store") as store:
        session = store.create_session(empty, codex_version="codex-cli test")
        selected = select_checkpoint(store, session.id, 1)
        assert selected.files == []

    root = tmp_path / "project"
    root.mkdir()
    source = root / "broken.py"
    source.write_text("def value() -> int:\n    return 1\n", encoding="utf-8")
    with ReplayStore(tmp_path / "syntax-store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        capture_hook_event(store, session.id, _hook(root, "PreToolUse", "syntax", "patch"))
        source.write_text("def value(:\n", encoding="utf-8")
        capture_hook_event(store, session.id, _hook(root, "PostToolUse", "syntax", "patch"))
        entry = timeline(store, session.id)[-1]

        assert entry.changed_files[0].change == "modified"
        assert entry.changed_symbols
        assert all(item.verified is False for item in entry.changed_symbols)


def test_export_corruption_is_rejected(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    export_path = tmp_path / "replay.json"
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        exported = export_session(store, session.id)
    value = exported.model_dump(mode="json")
    digest = next(iter(value["content_base64_by_sha256"]))
    value["content_base64_by_sha256"][digest] = "Y29ycnVwdA=="
    export_path.write_text(json.dumps(value), encoding="utf-8")

    try:
        load_export(export_path)
    except ValueError as exc:
        assert "hash mismatch" in str(exc)
    else:
        raise AssertionError("corrupt export was accepted")


def test_no_model_demo_and_machine_readable_schemas() -> None:
    runner = CliRunner()
    demo = runner.invoke(app, ["replay-demo"])
    assert demo.exit_code == 0, demo.output
    result = json.loads(demo.output)
    assert result["checkout_exists_during_playback"] is False
    assert result["model_used"] is False
    assert "return 1" in result["earlier_source"]
    assert "return 2" in result["later_source"]
    for contract in ("capture", "export"):
        schema = runner.invoke(app, ["replay-schema", contract])
        assert schema.exit_code == 0
        assert json.loads(schema.output)["type"] == "object"


def test_end_to_end_ingests_fixture_and_selects_earlier_after_later_change(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    source = root / "value.py"
    source.write_text("VALUE = 1\n", encoding="utf-8")
    fixture = Path(__file__).parents[1] / "fixtures" / "replay" / "capture_sequence.ndjson"
    capture_path = tmp_path / "capture.ndjson"
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        lines: list[str] = []
        for line in fixture.read_text(encoding="utf-8").splitlines():
            value = json.loads(line)
            value["session_id"] = session.id
            value["project_root_sha256"] = session.project_root_sha256
            value["codex_version"] = session.codex_version
            lines.append(json.dumps(value, sort_keys=True))
        capture_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        result = ingest_jsonl(store, session.id, capture_path, source_name="frozen-fixture")
        assert result.ingested == 2
        source.write_text("VALUE = 999\n", encoding="utf-8")
        earlier = select_checkpoint(store, session.id, 2)
        later = select_checkpoint(store, session.id, 3)

    shutil.rmtree(root)
    assert earlier.files[0].text == "VALUE = 1\n"
    assert later.files[0].text == "VALUE = 2\n"
