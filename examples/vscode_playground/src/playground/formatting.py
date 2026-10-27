"""Formatting helpers for monetary values and percentages."""

from __future__ import annotations

from playground.config import DEFAULT_CURRENCY


def format_currency(amount: float, currency: str = DEFAULT_CURRENCY) -> str:
    """Format an amount as a currency string with two decimals."""
    return f"{currency} {amount:.2f}"


def format_percentage(rate: float) -> str:
    """Format a floating rate (e.g., 0.05) as a display percentage string."""
    return f"{rate * 100:.1f}%"
