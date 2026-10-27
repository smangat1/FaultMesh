def heap_values(value: list[int]) -> list[int]:
    """Return every input item in nondecreasing order, including duplicates."""
    for end in range(len(value) - 1, -1, -1):
        _heapify(value, end)
        value[0], value[end] = value[end], value[0]
    return value


def _heapify(value: list[int], end: int) -> None:
    last_parent = int((end - 1) / 2)
    for parent in range(last_parent, -1, -1):
        current = parent
        while current <= last_parent:
            child = 2 * current + 1
            if child + 1 <= end and value[child] < value[child + 1]:
                child += 1
            if value[child] <= value[current]:
                break
            value[current], value[child] = value[child], value[current]
            current = child
