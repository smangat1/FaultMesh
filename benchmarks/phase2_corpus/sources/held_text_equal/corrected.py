def rotate_text(value: str) -> str:
    """Return text with exactly the same length as the input."""
    if not value:
        return value
    return value[1:] + value[0]
