from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_prompts import HistoryPromptIndex, list_history_prompts

FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "replay"


def _roots(tmp_path: Path) -> tuple[Path, Path]:
    codex_root = tmp_path / ".codex" / "sessions"
    claude_root = tmp_path / ".claude" / "projects"
    codex_root.mkdir(parents=True)
    claude_root.mkdir(parents=True)
    shutil.copy(FIXTURE_ROOT / "codex_history" / "normal.jsonl", codex_root / "normal.jsonl")
    return codex_root, claude_root


def test_prompt_listing_is_redacted_patch_only_and_cached(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    codex_root, claude_root = _roots(tmp_path)

    def fail_reconstruction(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("prompt listing must not reconstruct file state")

    monkeypatch.setattr(
        "faultmesh.replay.history_import.reconstruct_history_file_state",
        fail_reconstruction,
    )
    first = list_history_prompts(
        "synthetic-session-normal",
        tool="codex",
        store_root=tmp_path / "store",
        codex_root=codex_root,
        claude_root=claude_root,
    )
    second = list_history_prompts(
        "synthetic-session-normal",
        tool="codex",
        store_root=tmp_path / "store",
        codex_root=codex_root,
        claude_root=claude_root,
    )

    assert first.cached is False
    assert second.cached is True
    assert first.prompts
    assert any(prompt.changed_file_count > 0 for prompt in first.prompts)
    assert any("[redacted:" in (prompt.first_line or "") for prompt in first.prompts)
    assert all(
        not path.startswith("/")
        for prompt in first.prompts
        for path in prompt.changed_files
    )


def test_prompt_listing_cli_emits_only_the_typed_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = HistoryPromptIndex(
        session_id="session-one",
        source_file_sha256="a" * 64,
        prompts=[],
    )
    monkeypatch.setattr(
        "faultmesh.cli.app.list_history_prompts",
        lambda *_args, **_kwargs: payload,
    )

    result = CliRunner().invoke(
        app,
        ["replay-history-prompts", "session-one", "--tool", "codex"],
    )

    assert result.exit_code == 0
    parsed = HistoryPromptIndex.model_validate_json(result.stdout)
    assert parsed == payload
