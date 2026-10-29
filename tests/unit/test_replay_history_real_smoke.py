from __future__ import annotations

import os

import pytest

from faultmesh.replay.history_import import real_history_smoke_summary


@pytest.mark.skipif(
    os.environ.get("FAULTMESH_REAL_LOG_SMOKE") != "1",
    reason="set FAULTMESH_REAL_LOG_SMOKE=1 for local read-only history validation",
)
def test_real_local_history_list_and_import_smoke() -> None:
    summary = real_history_smoke_summary()

    assert summary.ok + summary.partial + summary.unsupported == summary.sessions_found
    assert summary.imports_validated + summary.import_failures == summary.sessions_found
    print(summary.model_dump_json())
