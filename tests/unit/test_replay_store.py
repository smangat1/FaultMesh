from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import pytest

from faultmesh.replay.adapter import capture_hook_event
from faultmesh.replay.capture import capture_snapshot
from faultmesh.replay.ingest import ingest_jsonl
from faultmesh.replay.models import (
    AttributionStatus,
    CaptureEnvelope,
    CaptureLimits,
    RecordKind,
)
from faultmesh.replay.store import ReplayStore, ReplayStoreError


def _project(tmp_path: Path, source: str = "VALUE = 1\n") -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "value.py").write_text(source, encoding="utf-8")
    return root


def _envelope(
    store: ReplayStore,
    session_id: str,
    root: Path,
    *,
    record_id: str,
    sequence: int,
    kind: RecordKind = RecordKind.CHECKPOINT,
) -> CaptureEnvelope:
    session = store.get_session(session_id)
    snapshot = capture_snapshot(root, session.limits)
    return CaptureEnvelope(
        record_id=record_id,
        record_type=kind,
        source_sequence=sequence,
        captured_at=datetime.now(UTC),
        project_root_sha256=session.project_root_sha256,
        codex_version=session.codex_version,
        session_id=session_id,
        files=snapshot.payloads,
        skipped=snapshot.manifest.skipped,
        partial=snapshot.manifest.partial,
    )


def test_store_pairs_tool_boundaries_and_survives_checkout_change(tmp_path: Path) -> None:
    root = _project(tmp_path)
    store_root = tmp_path / "store"
    with ReplayStore(store_root) as store:
        session = store.create_session(root, codex_version="codex-cli test")
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PreToolUse",
                "tool_use_id": "tool-1",
                "turn_id": "turn-1",
                "tool_name": "apply_patch",
                "cwd": str(root),
                "tool_input": {"command": "synthetic"},
            },
        )
        (root / "value.py").write_text("VALUE = 2\n", encoding="utf-8")
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PostToolUse",
                "tool_use_id": "tool-1",
                "turn_id": "turn-1",
                "tool_name": "apply_patch",
                "cwd": str(root),
                "tool_input": {"command": "synthetic"},
                "tool_response": {"status": "completed"},
            },
        )
        records = store.list_records(session.id)
        post = records[-1]
        assert post.attribution_status == AttributionStatus.TOOL_BOUNDARY
        assert post.before_manifest_id is not None
        assert post.after_manifest_id is not None
        before = store.get_manifest(post.before_manifest_id)
        after = store.get_manifest(post.after_manifest_id)
        assert store.get_content(before.files[0].content_sha256) == b"VALUE = 1\n"
        assert store.get_content(after.files[0].content_sha256) == b"VALUE = 2\n"

    (root / "value.py").write_text("VALUE = 999\n", encoding="utf-8")
    with ReplayStore(store_root) as reopened:
        assert reopened.get_content(before.files[0].content_sha256) == b"VALUE = 1\n"
        assert reopened.get_content(after.files[0].content_sha256) == b"VALUE = 2\n"
        assert reopened.validate() == []


def test_duplicate_envelope_is_idempotent_but_repeated_command_is_not(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        first = _envelope(store, session.id, root, record_id="record-1", sequence=1)
        one = store.add_envelope(
            first, source_identity="fixture", source_offset=0, provenance="test"
        )
        duplicate = store.add_envelope(
            first, source_identity="fixture", source_offset=0, provenance="test"
        )
        second = first.model_copy(
            update={"record_id": "record-2", "source_sequence": 2}
        )
        two = store.add_envelope(
            second, source_identity="fixture", source_offset=100, provenance="test"
        )

        assert duplicate == one
        assert two.sequence == one.sequence + 1
        assert len(store.list_records(session.id)) == 3


def test_partial_jsonl_tail_restart_unknown_gap_and_rotation(tmp_path: Path) -> None:
    root = _project(tmp_path)
    store_root = tmp_path / "store"
    source = tmp_path / "capture.ndjson"
    with ReplayStore(store_root) as store:
        session = store.create_session(root, codex_version="codex-cli test")
        first = _envelope(store, session.id, root, record_id="jsonl-1", sequence=1)
        (root / "value.py").write_text("VALUE = 2\n", encoding="utf-8")
        second = _envelope(store, session.id, root, record_id="jsonl-2", sequence=3)
        first_line = first.model_dump_json() + "\n"
        second_line = second.model_dump_json() + "\n"
        split = len(second_line) // 2
        source.write_text(first_line + second_line[:split], encoding="utf-8")

        result = ingest_jsonl(store, session.id, source, source_name="probe")
        assert result.ingested == 1
        assert result.partial_tail is True
        with source.open("a", encoding="utf-8") as handle:
            handle.write(second_line[split:])

    with ReplayStore(store_root) as reopened:
        result = ingest_jsonl(reopened, session.id, source, source_name="probe")
        assert result.ingested == 1
        assert result.gaps == 1
        assert any(
            record.gap_reason == "source_sequence_gap:2-2"
            for record in reopened.list_records(session.id)
        )
        again = ingest_jsonl(reopened, session.id, source, source_name="probe")
        assert again.ingested == 0
        assert again.next_offset == result.next_offset

        future = json.loads(second.model_dump_json())
        future["record_id"] = "jsonl-future"
        future["record_type"] = "future_event"
        source.write_text(json.dumps(future) + "\n", encoding="utf-8")
        rotated = ingest_jsonl(reopened, session.id, source, source_name="probe")
        assert rotated.gaps >= 1
        assert rotated.unsupported == 1


def test_corrupt_record_schema_rejection_and_content_corruption(tmp_path: Path) -> None:
    root = _project(tmp_path)
    source = tmp_path / "capture.ndjson"
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        source.write_bytes(b"{not-json}\n")
        corrupt = ingest_jsonl(store, session.id, source, source_name="corrupt")
        assert corrupt.gaps == 1

        source.write_text(
            json.dumps({"schema_version": "replay-capture-99.0"}) + "\n",
            encoding="utf-8",
        )
        with pytest.raises(ReplayStoreError, match="unsupported capture schema"):
            ingest_jsonl(store, session.id, source, source_name="wrong-schema")

        initial = store.list_records(session.id)[0]
        assert initial.manifest_id is not None
        manifest = store.get_manifest(initial.manifest_id)
        object_path = store._object_path(manifest.files[0].content_sha256)
        object_path.write_bytes(b"corrupt")
        assert store.validate() == [
            f"corrupt content object: {manifest.files[0].content_sha256}"
        ]


def test_invalid_parse_retains_explicitly_stale_last_good_structure(tmp_path: Path) -> None:
    root = _project(tmp_path, "def value() -> int:\n    return 1\n")
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        (root / "value.py").write_text("def value(:\n", encoding="utf-8")
        envelope = _envelope(
            store,
            session.id,
            root,
            record_id="syntax-error",
            sequence=1,
        )
        record = store.add_envelope(
            envelope, source_identity="fixture", source_offset=0, provenance="test"
        )
        row = store.connection.execute(
            "SELECT * FROM structures WHERE session_id = ? AND record_sequence = ?",
            (session.id, record.sequence),
        ).fetchone()

        assert row is not None
        assert row["stale"] == 1
        assert row["current_content_sha256"] != row["verified_content_sha256"]
        assert "value" in row["symbols_json"]


def test_whole_session_deletion_removes_unreferenced_objects(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        initial = store.list_records(session.id)[0]
        assert initial.manifest_id is not None
        digest = store.get_manifest(initial.manifest_id).files[0].content_sha256
        assert store._object_path(digest).exists()

        store.delete_session(session.id)

        assert store.list_sessions() == []
        assert not store._object_path(digest).exists()


def test_rename_and_delete_are_exact_manifest_transitions(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(root, codex_version="codex-cli test")
        for event_name in ("PreToolUse",):
            capture_hook_event(
                store,
                session.id,
                {
                    "hook_event_name": event_name,
                    "tool_use_id": "rename",
                    "tool_name": "Bash",
                    "cwd": str(root),
                },
            )
        (root / "value.py").rename(root / "renamed.py")
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PostToolUse",
                "tool_use_id": "rename",
                "tool_name": "Bash",
                "cwd": str(root),
            },
        )
        rename = store.list_records(session.id)[-1]
        assert rename.before_manifest_id is not None
        assert rename.after_manifest_id is not None
        assert [item.path for item in store.get_manifest(rename.before_manifest_id).files] == [
            "value.py"
        ]
        assert [item.path for item in store.get_manifest(rename.after_manifest_id).files] == [
            "renamed.py"
        ]

        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PreToolUse",
                "tool_use_id": "delete",
                "tool_name": "Bash",
                "cwd": str(root),
            },
        )
        (root / "renamed.py").unlink()
        capture_hook_event(
            store,
            session.id,
            {
                "hook_event_name": "PostToolUse",
                "tool_use_id": "delete",
                "tool_name": "Bash",
                "cwd": str(root),
            },
        )
        deletion = store.list_records(session.id)[-1]
        assert deletion.after_manifest_id is not None
        assert store.get_manifest(deletion.after_manifest_id).files == []


def test_store_budget_rejects_new_bytes_without_partial_commit(tmp_path: Path) -> None:
    root = _project(tmp_path)
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(
            root,
            codex_version="codex-cli test",
            limits=CaptureLimits(max_store_bytes=12),
        )
        before = len(store.list_records(session.id))
        (root / "value.py").write_text("VALUE = 2\n", encoding="utf-8")
        envelope = _envelope(
            store, session.id, root, record_id="over-budget", sequence=1
        )
        with pytest.raises(ReplayStoreError, match="store byte limit"):
            store.add_envelope(
                envelope, source_identity="budget", source_offset=0, provenance="test"
            )

        assert len(store.list_records(session.id)) == before


def test_committed_capture_fixtures_validate_and_contain_no_home_paths() -> None:
    fixture_root = Path(__file__).parents[1] / "fixtures" / "replay"
    initial_text = (fixture_root / "capture_initial.json").read_text(encoding="utf-8")
    CaptureEnvelope.model_validate_json(initial_text)
    sequence_text = (fixture_root / "capture_sequence.ndjson").read_text(encoding="utf-8")
    envelopes = [
        CaptureEnvelope.model_validate_json(line)
        for line in sequence_text.splitlines()
        if line
    ]

    assert [item.record_type for item in envelopes] == [
        RecordKind.PRE_TOOL,
        RecordKind.POST_TOOL,
    ]
    assert "/Users/" not in initial_text + sequence_text


def test_store_migrates_phase_one_schema_without_rewriting_records(tmp_path: Path) -> None:
    root = _project(tmp_path)
    store_root = tmp_path / "store"
    with ReplayStore(store_root) as store:
        session = store.create_session(root, codex_version="codex-cli test")
        record_ids = [item.id for item in store.list_records(session.id)]
    database = store_root / "replay.sqlite3"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("DROP TABLE test_evidence")
        connection.execute("UPDATE schema_metadata SET version = 1")
        connection.commit()

    with ReplayStore(store_root) as migrated:
        assert [item.id for item in migrated.list_records(session.id)] == record_ids
        tables = {
            row[0]
            for row in migrated.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert "test_evidence" in tables
