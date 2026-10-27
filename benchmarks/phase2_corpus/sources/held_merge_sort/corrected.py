def merge_values(value: list[int]) -> list[int]:
    """Return all input items in nondecreasing order, including duplicates."""
    if len(value) <= 1:
        return value
    middle = len(value) // 2
    left = merge_values(value[middle:])
    right = merge_values(value[:middle])
    result: list[int] = []
    while left and right:
        result.append(left.pop(0) if left[0] <= right[0] else right.pop(0))
    return result + left + right
