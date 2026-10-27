def comb_values(value: list[int]) -> list[int]:
    """Return all input items in nondecreasing order, preserving duplicate values."""
    gap = len(value)
    completed = False
    while not completed:
        gap = int(gap / 1.3)
        if gap <= 1:
            completed = True
        index = 0
        while index + gap < len(value):
            if value[index] > value[index + gap]:
                value[index], value[index + gap] = value[index + gap], value[index]
                completed = False
            index += 1
    return value
