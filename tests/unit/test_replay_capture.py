from __future__ import annotations

import json
import os
from pathlib import Path

from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.capture import capture_snapshot
from faultmesh.replay.models import CaptureLimits, SkipReason


def test_capture_preserves_exact_bytes_and_visible_skips(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    exact = b"def value():\r\n    return 1\r\n"
    (root / "value.py").write_bytes(exact)
    (root / "broken.py").write_text("def broken(:\n", encoding="utf-8")
    (root / "web.ts").write_text("export const value = 1;\n", encoding="utf-8")
    (root / ".env.local").write_text("TOKEN=not-recorded\n", encoding="utf-8")
    (root / "binary.py").write_bytes(b"print('x')\x00")
    (root / "non_utf8.py").write_bytes(b"value = '\xff'\n")
    ignored = root / "node_modules"
    ignored.mkdir()
    (ignored / "ignored.py").write_text("SECRET = 1\n", encoding="utf-8")
    outside = tmp_path / "outside.py"
    outside.write_text("ESCAPED = True\n", encoding="utf-8")
    os.symlink(outside, root / "escape.py")

    captured = capture_snapshot(root)

    by_path = {item.path: item for item in captured.payloads}
    assert set(by_path) == {"broken.py", "value.py"}
    assert by_path["value.py"].content_base64 == "ZGVmIHZhbHVlKCk6DQogICAgcmV0dXJuIDENCg=="
    assert captured.manifest.files[0].parse_ok is False
    reasons = {(item.path, item.reason) for item in captured.manifest.skipped}
    assert (".env.local", SkipReason.SECRET_LIKE_NAME) in reasons
    assert ("binary.py", SkipReason.BINARY) in reasons
    assert ("escape.py", SkipReason.SYMLINK) in reasons
    assert ("non_utf8.py", SkipReason.NON_UTF8) in reasons
    assert ("web.ts", SkipReason.NON_PYTHON_SOURCE) in reasons
    assert ("node_modules", SkipReason.IGNORED_DIRECTORY) in reasons
    assert captured.manifest.partial is True


def test_capture_enforces_file_and_snapshot_bounds(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("A = 'too long'\n", encoding="utf-8")
    (root / "b.py").write_text("B = 2\n", encoding="utf-8")

    captured = capture_snapshot(
        root,
        CaptureLimits(max_files=1, max_file_bytes=8, max_snapshot_bytes=1),
    )

    assert captured.payloads == []
    reasons = {item.reason for item in captured.manifest.skipped}
    assert SkipReason.FILE_TOO_LARGE in reasons
    assert captured.manifest.partial is True


def test_manifest_identity_changes_for_rapid_settled_states(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    path = root / "rapid.py"
    path.write_text("STAGE = 1\n", encoding="utf-8")
    first = capture_snapshot(root)
    path.write_text("STAGE = 2\n", encoding="utf-8")
    second = capture_snapshot(root)
    path.write_text("STAGE = 3\n", encoding="utf-8")
    third = capture_snapshot(root)

    assert len({first.manifest.id, second.manifest.id, third.manifest.id}) == 3


def test_explicit_cli_lifecycle_lists_stops_and_deletes(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "value.py").write_text("VALUE = 1\n", encoding="utf-8")
    store = tmp_path / "store"
    runner = CliRunner()

    started = runner.invoke(
        app,
        [
            "replay-start",
            str(root),
            "--codex-version",
            "codex-cli test",
            "--store",
            str(store),
        ],
    )
    assert started.exit_code == 0, started.output
    session_id = json.loads(started.output)["session"]["id"]
    listed = runner.invoke(app, ["replay-sessions", "--store", str(store)])
    assert listed.exit_code == 0
    assert json.loads(listed.output)[0]["id"] == session_id
    stopped = runner.invoke(
        app, ["replay-stop", session_id, "--store", str(store)]
    )
    assert stopped.exit_code == 0
    assert json.loads(stopped.output)["status"] == "stopped"
    deleted = runner.invoke(
        app, ["replay-delete", session_id, "--store", str(store)]
    )
    assert deleted.exit_code == 0
