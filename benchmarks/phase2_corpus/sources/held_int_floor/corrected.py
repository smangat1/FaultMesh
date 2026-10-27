def raise_floor(value: int, minimum: int) -> int:
    """Return a result that is never below minimum."""
    if value < minimum:
        return minimum
    return value
