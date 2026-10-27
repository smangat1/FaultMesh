"""Pricing calculation functions with threshold discounts and tax."""

from __future__ import annotations

from playground.config import DISCOUNT_PERCENTAGE, DISCOUNT_THRESHOLD, TAX_RATE


def calculate_item_total(price: float, quantity: int) -> float:
    """Calculate the subtotal for a single item line."""
    return round(price * quantity, 2)


def calculate_subtotal(items: list[tuple[str, float, int]]) -> float:
    """Sum item subtotals for a collection of (description, unit_price, quantity)."""
    return round(sum(calculate_item_total(price, qty) for _, price, qty in items), 2)


def apply_discount(subtotal: float) -> float:
    """Apply discount if subtotal meets or exceeds the threshold."""
    if subtotal >= DISCOUNT_THRESHOLD:
        return round(subtotal * (1.0 - DISCOUNT_PERCENTAGE), 2)
    return subtotal


def calculate_tax(amount: float, tax_rate: float = TAX_RATE) -> float:
    """Calculate tax on an amount given a tax rate."""
    return round(amount * tax_rate, 2)


def calculate_total(items: list[tuple[str, float, int]]) -> float:
    """Calculate the final total including discount and tax."""
    subtotal = calculate_subtotal(items)
    discounted = apply_discount(subtotal)
    tax = calculate_tax(discounted)
    return round(discounted + tax, 2)
