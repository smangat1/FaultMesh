def adjust_value(value: int, maximum: int) -> int:
    """Return value plus one but never exceed maximum.

    Valid inputs satisfy 0 <= value <= maximum and maximum >= 0.
    """
    if value < maximum:
        return value + 1
    return maximum
