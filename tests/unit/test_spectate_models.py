from __future__ import annotations

import json
from pathlib import Path

from faultmesh.spectate.models import EVENT_ADAPTER, InitialSnapshot, SessionStarted


def test_example_stream_validates_and_is_ordered() -> None:
    fixture = Path("docs/fixtures/spectate-stream-example.ndjson")
    records = [
        EVENT_ADAPTER.validate_python(json.loads(line))
        for line in fixture.read_text().splitlines()
    ]

    assert isinstance(records[0], SessionStarted)
    assert isinstance(records[1], InitialSnapshot)
    assert [item.sequence for item in records] == [1, 2, 3]
    assert records[0].tests_rerun is False


def test_unknown_event_is_rejected() -> None:
    try:
        EVENT_ADAPTER.validate_python(
            {
                "schema_version": "spectate-1.0",
                "session_id": "test",
                "sequence": 1,
                "emitted_at": "2026-10-26T00:00:00Z",
                "event": "model_explanation",
            }
        )
    except ValueError:
        return
    raise AssertionError("unknown fact type was accepted")
