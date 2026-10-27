def drop_markers(value: str) -> str:
    """Return text no longer than the input after removing marker characters."""
    return value.replace("#", "")
