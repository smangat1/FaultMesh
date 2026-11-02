from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.models import ChangedFileView, ReplayExport
from faultmesh.replay.revert_plan import RevertPlan, build_revert_plan, reverse_unified_diff

FIXTURE = Path(__file__).parents[1] / "fixtures" / "replay" / "fixture_replay_v1_nomodel.json"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _export_with_changes() -> tuple[ReplayExport, int]:
    exported = ReplayExport.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
    sequence = exported.timeline[0].sequence
    deleted_text = 'PASSWORD="synthetic-revert-secret"\nVALUE = 1\n'
    changed = [
        ChangedFileView(
            path="src/new_module.py",
            change="added",
            unified_diff="--- /dev/null\n+++ b/src/new_module.py\n@@ -0,0 +1 @@\n+VALUE = 1\n",
        ),
        ChangedFileView(
            path="src/removed.py",
            change="deleted",
            before_sha256=_digest(deleted_text),
            after_sha256=None,
            unified_diff="--- a/src/removed.py\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-VALUE = 1\n",
            derived_from="recorded_patch",
            file_state="reconstructed_from_current_checkout_unverified",
            reconstruction_label="reconstructed from current checkout (unverified)",
            before_text=deleted_text,
            after_text=None,
        ),
        ChangedFileView(
            path="src/service.py",
            change="modified",
            unified_diff=(
                "--- a/src/service.py\n+++ b/src/service.py\n"
                "@@ -1 +1 @@\n-old_call()\n+new_call()\n"
            ),
        ),
        ChangedFileView(
            path="src/unknown.ts",
            change="modified",
            file_state="unknown",
            unified_diff="python -m synthetic_tool --write src/unknown.ts",
        ),
    ]
    timeline = [
        entry.model_copy(update={"changed_files": changed})
        if entry.sequence == sequence
        else entry
        for entry in exported.timeline
    ]
    return exported.model_copy(update={"timeline": timeline}), sequence


def test_revert_plan_orders_actions_and_keeps_provenance_honest() -> None:
    exported, sequence = _export_with_changes()

    plan = build_revert_plan(exported, sequence, sequence)

    assert [action.action for action in plan.actions] == [
        "delete_file",
        "apply_reverse_diff",
        "manual_review",
        "restore_file",
    ]
    reconstructed = next(action for action in plan.actions if action.path == "src/removed.py")
    assert reconstructed.provenance == "reconstructed_from_current_checkout_unverified"
    assert reconstructed.provenance_label == "reconstructed from current checkout (unverified)"
    assert "synthetic-revert-secret" not in (reconstructed.restore_text or "")
    assert "[redacted: password]" in (reconstructed.restore_text or "")
    unknown = next(action for action in plan.actions if action.path == "src/unknown.ts")
    assert unknown.action == "manual_review"
    assert unknown.provenance == "unknown"
    assert "Leave the file unchanged" in unknown.instruction
    assert "does not write files or run commands" in plan.text


def test_reverse_unified_diff_swaps_headers_hunks_and_lines() -> None:
    forward = "--- a/app.py\n+++ b/app.py\n@@ -1 +1,2 @@\n-old\n+new\n+line\n"

    reversed_diff = reverse_unified_diff(forward)

    assert reversed_diff.startswith("--- b/app.py\n+++ a/app.py\n@@ -1,2 +1 @@")
    assert "+old\n-new\n-line\n" in reversed_diff


def test_revert_plan_cli_emits_typed_text_only_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exported, sequence = _export_with_changes()
    expected = build_revert_plan(exported, sequence, sequence)
    monkeypatch.setattr(
        "faultmesh.cli.app.import_history_session",
        lambda *_args, **_kwargs: exported,
    )

    result = CliRunner().invoke(
        app,
        [
            "replay-revert-plan",
            exported.session.id,
            "--tool",
            "codex",
            "--start",
            str(sequence),
            "--end",
            str(sequence),
        ],
    )

    assert result.exit_code == 0
    assert RevertPlan.model_validate_json(result.stdout) == expected
