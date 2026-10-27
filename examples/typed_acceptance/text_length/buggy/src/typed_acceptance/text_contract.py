"""Synthetic text acceptance target."""


def remove_terminal_marker(value: str) -> str:
    """Return text with at most the original input length."""
    if value.endswith("#"):
        return value[:-1]
    return value + "#"
