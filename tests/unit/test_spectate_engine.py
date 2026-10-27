from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import pytest

from faultmesh.spectate.engine import (
    SpectateEngine,
    _relative_inside,
    default_limits,
)
from faultmesh.spectate.models import EVENT_ADAPTER


class ManualClock:
    def __init__(self) -> None:
        self.value = 10.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def make_engine(
    root: Path,
    records: list[dict[str, Any]],
    clock: ManualClock,
    **updates: int,
) -> SpectateEngine:
    limits = default_limits().model_copy(
        update={"debounce_ms": 0, "max_events_per_second": 10_000, **updates}
    )
    return SpectateEngine(
        root,
        limits=limits,
        sink=records.append,
        clock=clock,
        sleeper=clock.advance,
    )


def event_records(records: list[dict[str, Any]], event: str) -> list[dict[str, Any]]:
    return [record for record in records if record["event"] == event]


def test_stable_modify_emits_exact_source_diff_ranges_and_ids(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("def value():\n    return 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    engine = make_engine(tmp_path, records, clock)
    engine.start()

    source.write_text("def value():\n    return 2\n", encoding="utf-8")
    assert engine.poll_once()

    change = event_records(records, "file_changed")[-1]
    assert change["kind"] == "modified"
    assert change["changed_line_ranges"] == [{"start_line": 2, "end_line": 2}]
    assert change["affected_file_ids"] == ["file:module.py"]
    assert change["affected_symbol_ids"] == ["symbol:module.py:value"]
    exact = event_records(records, "source")[-1]
    assert exact["text"] == "def value():\n    return 2\n"
    diff = event_records(records, "diff")[-1]
    assert diff["base"] == "previous stable snapshot"
    assert "-    return 1" in diff["text"]
    assert "+    return 2" in diff["text"]
    assert diff["hunks"][0]["old_start"] == 1
    assert diff["hunks"][0]["new_start"] == 1


def test_quiet_window_coalesces_partial_write_to_final_content(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("value = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    engine = make_engine(tmp_path, records, clock, debounce_ms=100)
    engine.start()
    baseline = len(event_records(records, "file_changed"))

    source.write_text("value =", encoding="utf-8")
    engine.poll_once()
    clock.advance(0.05)
    source.write_text("value = 2\n", encoding="utf-8")
    engine.poll_once()
    clock.advance(0.11)
    engine.poll_once()

    changes = event_records(records, "file_changed")[baseline:]
    assert len(changes) == 1
    assert changes[0]["parse_ok"] is True
    assert event_records(records, "source")[-1]["text"] == "value = 2\n"


def test_atomic_save_rename_delete_and_recreate_are_observed(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("value = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    engine = make_engine(tmp_path, records, clock)
    engine.start()

    temporary = tmp_path / ".module.py.tmp"
    temporary.write_text("value = 2\n", encoding="utf-8")
    os.replace(temporary, source)
    engine.poll_once()
    renamed = tmp_path / "renamed.py"
    source.rename(renamed)
    engine.poll_once()
    renamed.unlink()
    engine.poll_once()
    renamed.write_text("value = 3\n", encoding="utf-8")
    engine.poll_once()

    kinds = [record["kind"] for record in event_records(records, "file_changed")]
    assert kinds == ["modified", "renamed", "deleted", "created"]
    rename = event_records(records, "file_changed")[1]
    assert rename["from_path"] == "module.py"
    assert rename["to_path"] == "renamed.py"


def test_truncate_then_write_does_not_publish_intermediate_state(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("first = 1\nsecond = 2\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    engine = make_engine(tmp_path, records, clock, debounce_ms=80)
    engine.start()

    source.write_bytes(b"")
    engine.poll_once()
    clock.advance(0.04)
    source.write_text("final = 3\n", encoding="utf-8")
    engine.poll_once()
    clock.advance(0.09)
    engine.poll_once()

    assert len(event_records(records, "file_changed")) == 1
    assert event_records(records, "source")[-1]["text"] == "final = 3\n"


def test_syntax_error_keeps_last_good_symbols_and_recovers(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("def present():\n    return 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    engine = make_engine(tmp_path, records, clock)
    engine.start()

    source.write_text("def present(:\n    return 2\n", encoding="utf-8")
    engine.poll_once()
    broken = event_records(records, "structure_update")[-1]
    assert broken["parse_ok"] is False
    assert broken["kept_last_good_symbols"] is True
    assert [item["id"] for item in broken["symbols"]] == ["symbol:module.py:present"]

    source.write_text(
        "def present():\n    return 2\n\ndef added():\n    return 3\n", encoding="utf-8"
    )
    engine.poll_once()
    recovered = event_records(records, "structure_update")[-1]
    assert recovered["parse_ok"] is True
    assert recovered["kept_last_good_symbols"] is False
    assert recovered["added_symbol_ids"] == ["symbol:module.py:added"]


def test_symlink_and_secret_candidates_are_never_read_or_emitted(tmp_path: Path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "outside.py").write_text("SECRET = 'outside'\n", encoding="utf-8")
    (root / "safe.py").write_text("SAFE = True\n", encoding="utf-8")
    (root / ".env.py").write_text("TOKEN = 'secret'\n", encoding="utf-8")
    (root / "credentials.py").write_text("PASSWORD = 'secret'\n", encoding="utf-8")
    (root / "file_link.py").symlink_to(outside / "outside.py")
    (root / "dir_link").symlink_to(outside, target_is_directory=True)
    records: list[dict[str, Any]] = []
    engine = make_engine(root, records, ManualClock())
    engine.start()

    serialized = repr(records)
    assert "safe.py" in serialized
    assert "TOKEN" not in serialized
    assert "PASSWORD" not in serialized
    assert "outside" not in serialized
    assert "file_link.py" in serialized  # a skip fact, never source content
    assert "dir_link" not in serialized
    assert _relative_inside(root.resolve(), outside / "outside.py") is None


def test_huge_many_binary_crlf_and_long_line_are_bounded_and_labeled(tmp_path: Path) -> None:
    (tmp_path / "a_huge.py").write_bytes(b"x" * 65)
    (tmp_path / "b_binary.py").write_bytes(b"value = \xff\n")
    (tmp_path / "c_crlf.py").write_bytes(b"a = 1\r\nb = 2\r\n")
    (tmp_path / "d_long.py").write_text("value = '123456789'\n", encoding="utf-8")
    (tmp_path / "e_extra.py").write_text("x = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    engine = make_engine(
        tmp_path,
        records,
        ManualClock(),
        max_files=4,
        max_file_bytes=64,
        max_line_length=10,
    )
    engine.start()

    errors = event_records(records, "watch_error")
    assert any(item["reason"] == "max_files" and item["skipped_count"] == 1 for item in errors)
    assert any(item["reason"] == "max_file_bytes" for item in errors)
    snapshot = event_records(records, "initial_snapshot")[0]
    assert [item["path"] for item in snapshot["files"]] == [
        "b_binary.py",
        "c_crlf.py",
        "d_long.py",
    ]

    (tmp_path / "b_binary.py").write_bytes(b"changed = \xfe\n")
    (tmp_path / "c_crlf.py").write_bytes(b"a = 1\r\nb = 3\r\n")
    (tmp_path / "d_long.py").write_text("value = 'abcdefghi'\n", encoding="utf-8")
    engine.poll_once()
    sources = {item["path"]: item for item in event_records(records, "source")}
    assert sources["b_binary.py"]["complete"] is False
    assert sources["b_binary.py"]["skipped_reason"] == "non_utf8"
    assert sources["c_crlf.py"]["text"] == "a = 1\r\nb = 3\r\n"
    assert sources["d_long.py"]["complete"] is False
    assert sources["d_long.py"]["skipped_reason"] == "max_line_length"


def test_diff_line_limit_and_evidence_hash_staleness_are_explicit(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    clock = ManualClock()
    limits = default_limits().model_copy(
        update={"debounce_ms": 0, "max_diff_lines": 3, "max_events_per_second": 10_000}
    )
    engine = SpectateEngine(
        tmp_path,
        limits=limits,
        sink=records.append,
        evidence_hashes={"module.py": ["evidence-file-hash"]},
        clock=clock,
        sleeper=clock.advance,
    )
    engine.start()
    source.write_text("a = 4\nb = 5\nc = 6\n", encoding="utf-8")
    engine.poll_once()

    diff = event_records(records, "diff")[-1]
    assert diff["truncated"] is True
    assert diff["skipped_reason"] == "max_diff_lines"
    stale = event_records(records, "evidence_stale")[-1]
    assert stale["evidence_content_sha256"] == "evidence-file-hash"
    assert stale["rule"] == "containing file content_sha256"


def test_missing_root_and_permission_error_report_cleanly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "module.py"
    source.write_text("value = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    engine = make_engine(tmp_path, records, ManualClock())
    engine.start()
    original_scandir = os.scandir

    def denied(path: str | os.PathLike[str]) -> os.ScandirIterator[str]:
        if Path(path) == tmp_path:
            raise PermissionError
        return original_scandir(path)

    monkeypatch.setattr(os, "scandir", denied)
    engine.poll_once()
    assert event_records(records, "watch_error")[-1]["reason"] == "permission_denied"
    monkeypatch.setattr(os, "scandir", original_scandir)
    shutil.rmtree(tmp_path)
    assert engine.poll_once() is False
    assert event_records(records, "root_missing")[-1]["reason"] == "deleted"
    assert event_records(records, "session_ended")[-1]["reason"] == "root_deleted"


def test_sequence_and_schema_are_valid_for_every_record(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("value = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    engine = make_engine(tmp_path, records, ManualClock())
    engine.start()
    source.write_text("value = 2\n", encoding="utf-8")
    engine.poll_once()
    engine.stop("test_complete")

    assert [record["sequence"] for record in records] == list(range(1, len(records) + 1))
    assert len({record["session_id"] for record in records}) == 1
    for record in records:
        EVENT_ADAPTER.validate_python(record)
