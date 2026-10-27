"""Optional tiny tests verifying deterministic playground calculations."""

from __future__ import annotations

from playground.formatting import format_currency, format_percentage
from playground.invoice import generate_invoice
from playground.pricing import (
    apply_discount,
    calculate_item_total,
    calculate_subtotal,
    calculate_total,
)


def test_item_total() -> None:
    assert calculate_item_total(10.5, 3) == 31.5


def test_subtotal_and_discount() -> None:
    items = [("Widget A", 25.0, 2), ("Widget B", 30.0, 2)]
    subtotal = calculate_subtotal(items)
    assert subtotal == 110.0
    discounted = apply_discount(subtotal)
    assert discounted == 99.0  # 10% off 110.0


def test_calculate_total() -> None:
    items = [("Gadget", 50.0, 1)]
    # 50.0 subtotal, no discount, 5% tax = 2.50 -> 52.50
    assert calculate_total(items) == 52.5


def test_formatters() -> None:
    assert format_currency(12.34) == "USD 12.34"
    assert format_percentage(0.05) == "5.0%"


def test_generate_invoice() -> None:
    items = [("Book", 20.0, 1)]
    inv = generate_invoice("Alice", items)
    assert inv["customer"] == "Alice"
    assert inv["subtotal"] == "USD 20.00"
