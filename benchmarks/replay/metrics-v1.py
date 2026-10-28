"""Frozen, dependency-free metric rules for replay evaluation protocol 1.0."""

from __future__ import annotations

from collections.abc import Hashable, Iterable
from dataclasses import dataclass

METRIC_CODE_VERSION = "replay-metrics-1.0"


@dataclass(frozen=True)
class Rate:
    numerator: int
    denominator: int

    @property
    def value(self) -> float | None:
        return self.numerator / self.denominator if self.denominator else None


def deduplicate(values: Iterable[Hashable]) -> set[Hashable]:
    return set(values)


def one_to_one_coverage(
    accepted_true: Iterable[Hashable], relevant_reference: Iterable[Hashable]
) -> Rate:
    """Match canonical facts one-to-one; repetition cannot raise coverage."""
    accepted = deduplicate(accepted_true)
    reference = deduplicate(relevant_reference)
    return Rate(numerator=len(accepted & reference), denominator=len(reference))


def precision(accepted_true: int, accepted_total: int) -> Rate:
    """A zero denominator deliberately produces an undefined value."""
    return Rate(numerator=accepted_true, denominator=accepted_total)
