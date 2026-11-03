from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from faultmesh.cli.app import app
from faultmesh.replay.history_import import import_history_session
from faultmesh.replay.history_prompts import (
    HistoryPromptIndex,
    build_history_prompt_index,
    list_history_prompts,
)

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


def test_prompt_listing_keeps_mixed_prompt_and_turn_ids_in_one_text_bearing_group(
    tmp_path: Path,
) -> None:
    codex_root, claude_root = _roots(tmp_path)
    exported = import_history_session(
        "synthetic-session-normal",
        tool="codex",
        codex_root=codex_root,
        claude_root=claude_root,
        reconstruct_file_state=False,
    )
    first, second, third = exported.records[:3]
    records = [
        first.model_copy(
            update={
                "prompt_id": "prompt-one",
                "turn_id": "turn-one",
                "prompt_text": "Explain the recorded command without changing code.",
            }
        ),
        second.model_copy(
            update={"prompt_id": None, "turn_id": "turn-one", "prompt_text": None}
        ),
        third.model_copy(
            update={"prompt_id": None, "turn_id": "turn-one", "prompt_text": None}
        ),
    ]
    subset = exported.model_copy(
        update={
            "records": records,
            "timeline": exported.timeline[:3],
        }
    )

    index = build_history_prompt_index("mixed-ids", "a" * 64, subset)

    assert len(index.prompts) == 1
    assert index.prompts[0].prompt_id == "prompt-one"
    assert index.prompts[0].first_line == (
        "Explain the recorded command without changing code."
    )
