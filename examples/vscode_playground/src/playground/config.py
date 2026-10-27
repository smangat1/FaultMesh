"""Configuration constants and defaults for the playground project."""

from __future__ import annotations

DEFAULT_CURRENCY: str = "USD"
TAX_RATE: float = 0.05
DISCOUNT_THRESHOLD: float = 100.0
DISCOUNT_PERCENTAGE: float = 0.10


def get_tax_rate() -> float:
    """Return the active tax rate."""
    return TAX_RATE
