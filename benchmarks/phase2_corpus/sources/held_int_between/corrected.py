def clamp_value(value: int, lower: int, upper: int) -> int:
    """Return a result between lower and upper, inclusive.

    Valid inputs satisfy lower <= upper.
    """
    if value < lower:
        return lower
    if value > upper:
        return upper
    return value
