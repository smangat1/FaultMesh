"""Invoice generator coordinating pricing calculations and string formatting."""

from __future__ import annotations

from playground.formatting import format_currency
from playground.pricing import calculate_subtotal, calculate_total


def generate_invoice(customer: str, items: list[tuple[str, float, int]]) -> dict[str, str]:
    """Generate a structured invoice dictionary for a customer."""
    subtotal = calculate_subtotal(items)
    total = calculate_total(items)
    return {
        "customer": customer,
        "item_count": str(len(items)),
        "subtotal": format_currency(subtotal),
        "total": format_currency(total),
    }


def summarize_line_items(items: list[tuple[str, float, int]]) -> list[str]:
    """Return formatted human-readable lines for each purchased item."""
    return [
        f"{name}: {qty} @ {format_currency(price)} = {format_currency(calculate_subtotal([(name, price, qty)]))}"
        for name, price, qty in items
    ]
