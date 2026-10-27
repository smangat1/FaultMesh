from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from faultmesh.spectate.engine import SpectateEngine, default_limits


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


def relationships(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record for record in records if record["event"] == "relationship_update"]


def resolved_calls(record: dict[str, Any]) -> set[tuple[str, str]]:
    return {
        (edge["source_id"], edge["target_id"])
        for edge in record["edges"]
        if edge["kind"] == "possible_call"
        and edge["confidence"] == "resolved"
        and edge["target_id"] is not None
    }


def test_relationship_updates_follow_settled_create_modify_delete_and_rename(
    tmp_path: Path,
) -> None:
    provider = tmp_path / "provider.py"
    consumer = tmp_path / "consumer.py"
    provider.write_text("def target():\n    return 1\n", encoding="utf-8")
    consumer.write_text(
        "from provider import target\n\ndef caller():\n    return target()\n",
        encoding="utf-8",
    )
    records: list[dict[str, Any]] = []
    engine = make_engine(tmp_path, records, ManualClock())
    engine.start()

    initial = relationships(records)[-1]
    assert initial["complete"] is True
    assert (
        "symbol:consumer.py:caller",
        "symbol:provider.py:target",
    ) in resolved_calls(initial)

    provider.write_text("def target():\n    return 2\n", encoding="utf-8")
    engine.poll_once()
    assert len(relationships(records)) == 2
    assert (
        "symbol:consumer.py:caller",
        "symbol:provider.py:target",
    ) in resolved_calls(relationships(records)[-1])

    extra = tmp_path / "extra.py"
    extra.write_text(
        "from provider import target\n\ndef extra_call():\n    return target()\n",
        encoding="utf-8",
    )
    engine.poll_once()
    assert (
        "symbol:extra.py:extra_call",
        "symbol:provider.py:target",
    ) in resolved_calls(relationships(records)[-1])

    moved = tmp_path / "moved.py"
    extra.rename(moved)
    engine.poll_once()
    renamed = relationships(records)[-1]
    assert (
        "symbol:moved.py:extra_call",
        "symbol:provider.py:target",
    ) in resolved_calls(renamed)
    assert all("extra.py" not in repr(edge) for edge in renamed["edges"])

    provider.unlink()
    engine.poll_once()
    deleted = relationships(records)[-1]
    assert all(edge[1] != "symbol:provider.py:target" for edge in resolved_calls(deleted))
    assert [record["sequence"] for record in records] == list(range(1, len(records) + 1))


def test_syntax_error_retains_last_good_edges_with_hashes_then_recovers(
    tmp_path: Path,
) -> None:
    provider = tmp_path / "provider.py"
    consumer = tmp_path / "consumer.py"
    valid = b"def target():\n    return 1\n"
    provider.write_bytes(valid)
    consumer.write_text(
        "from provider import target\n\ndef caller():\n    return target()\n",
        encoding="utf-8",
    )
    records: list[dict[str, Any]] = []
    engine = make_engine(tmp_path, records, ManualClock())
    engine.start()
    good_hash = engine.states["provider.py"].sha256

    provider.write_text("def target(:\n    return 2\n", encoding="utf-8")
    engine.poll_once()
    stale = relationships(records)[-1]
    assert stale["complete"] is False
    assert stale["partial_reasons"] == ["stale_paths"]
    assert stale["stale_paths"] == [
        {
            "path": "provider.py",
            "last_good_sha256": good_hash,
            "current_sha256": engine.states["provider.py"].sha256,
        }
    ]
    assert (
        "symbol:consumer.py:caller",
        "symbol:provider.py:target",
    ) in resolved_calls(stale)

    provider.write_text("def target():\n    return 3\n", encoding="utf-8")
    engine.poll_once()
    recovered = relationships(records)[-1]
    assert recovered["complete"] is True
    assert recovered["partial_reasons"] == []
    assert recovered["stale_paths"] == []


def test_relationship_scope_keeps_secret_symlink_and_file_limits_explicit(
    tmp_path: Path,
) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside.py"
    root.mkdir()
    outside.write_text("def outside():\n    return 1\n", encoding="utf-8")
    (root / "a.py").write_text("def visible():\n    return 1\n", encoding="utf-8")
    (root / "b.py").write_text("def omitted():\n    return 2\n", encoding="utf-8")
    (root / "credentials.py").write_text(
        "def secret():\n    return 'token'\n", encoding="utf-8"
    )
    (root / "linked.py").symlink_to(outside)
    records: list[dict[str, Any]] = []
    engine = make_engine(root, records, ManualClock(), max_files=1)
    engine.start()

    update = relationships(records)[-1]
    assert update["complete"] is False
    assert update["partial_reasons"] == ["max_files"]
    serialized = repr(update)
    assert "a.py" in serialized
    assert "b.py" not in serialized
    assert "credentials.py" not in serialized
    assert "linked.py" not in serialized
    assert "outside.py" not in serialized

    replacement = root / ".replacement.py"
    replacement.write_text("def visible():\n    return 3\n", encoding="utf-8")
    os.replace(replacement, root / "a.py")
    engine.poll_once()
    assert relationships(records)[-1]["partial_reasons"] == ["max_files"]


def test_relationship_update_labels_bounded_read_skips(tmp_path: Path) -> None:
    (tmp_path / "large.py").write_bytes(b"x" * 65)
    (tmp_path / "small.py").write_text("x = 1\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    engine = make_engine(
        tmp_path,
        records,
        ManualClock(),
        max_files=2,
        max_file_bytes=64,
    )
    engine.start()

    update = relationships(records)[-1]
    assert update["complete"] is False
    assert update["partial_reasons"] == ["read_skipped:max_file_bytes"]
    assert all(edge["callsite_path"] != "large.py" for edge in update["edges"])

    (tmp_path / "large.py").unlink()
    engine.poll_once()
    recovered = relationships(records)[-1]
    assert recovered["complete"] is True
    assert recovered["partial_reasons"] == []
