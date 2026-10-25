def bounded_increment(value: int, maximum: int) -> int:
    """Return ``value + 1`` but never exceed ``maximum``.

    Valid inputs satisfy ``0 <= value <= maximum`` and ``maximum >= 0``.
    """
    if value <= maximum:  # Seeded bug: equality must not be incremented.
        return value + 1
    return maximum

