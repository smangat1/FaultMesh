"""Synthetic integer-list acceptance target."""


def sort_preserving_values(value: list[int]) -> list[int]:
    """Return nondecreasing values while preserving every input item, including duplicates."""
    return sorted(set(value))
