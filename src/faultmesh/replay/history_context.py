"""Shared best-effort handling for Codex-injected user context blocks."""

from __future__ import annotations

import re

_INJECTED_CONTEXT_BLOCK = re.compile(
    r"<(environment_context|user_instructions)>.*?</\1>",
    re.DOTALL,
)


def strip_injected_context(text: str) -> tuple[str | None, bool]:
    """Remove recognized injected blocks while preserving any real user text."""
    stripped, count = _INJECTED_CONTEXT_BLOCK.subn("", text)
    if count == 0:
        return text, False
    prompt = stripped.strip()
    return (prompt or None), True
