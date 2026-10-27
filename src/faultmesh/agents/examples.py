"""Independently authored, executable Scout few-shot examples."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from faultmesh.schemas import ScoutResponse, SourceReference


@dataclass(frozen=True)
class FewShotExample:
    label: str
    path: str
    qualified_name: str
    source: str
    response: ScoutResponse


def _example(
    label: str,
    source: str,
    qualified_name: str,
    hypotheses: list[dict[str, Any]],
) -> FewShotExample:
    path = f"examples/{label}.py"
    reference = SourceReference(
        path=path,
        start_line=1,
        end_line=len(source.splitlines()),
        content_hash=hashlib.sha256(source.encode("utf-8")).hexdigest(),
    )
    payloads: list[dict[str, Any]] = []
    for hypothesis in hypotheses:
        property_payload = hypothesis.pop("property_spec")
        payloads.append(
            {
                **hypothesis,
                "source_references": [reference.model_dump(mode="json")],
                "property_spec": {
                    "schema_version": "1.1",
                    "target": reference.model_dump(mode="json"),
                    "qualified_name": qualified_name,
                    "constraints": [],
                    "evidence": [reference.model_dump(mode="json")],
                    "max_examples": 200,
                    "seed": 1,
                    **property_payload,
                },
            }
        )
    return FewShotExample(
        label=label,
        path=path,
        qualified_name=qualified_name,
        source=source,
        response=ScoutResponse.model_validate(
            {"schema_version": "1.0", "hypotheses": payloads}
        ),
    )


def few_shot_examples() -> tuple[FewShotExample, ...]:
    """Return examples whose full payloads pass the production response schema."""

    return (
        _example(
            "integer_upper",
            'def cap(value: int, maximum: int) -> int:\n    """Return a value that never exceeds maximum."""\n    return min(value, maximum)\n',
            "cap",
            [
                {
                    "description": "The result must not exceed maximum.",
                    "preconditions": [],
                    "expected_behavior": "result <= maximum",
                    "violation_condition": "result > maximum",
                    "confidence": 0.9,
                    "property_spec": {
                        "arguments": [
                            {"name": "value", "strategy": {"kind": "integers"}},
                            {"name": "maximum", "strategy": {"kind": "integers"}},
                        ],
                        "oracle": {"kind": "result_le_arg", "argument": "maximum"},
                        "oracle_explanation": "The result never exceeds maximum.",
                        "contract_citation": "never exceeds maximum",
                    },
                }
            ],
        ),
        _example(
            "text_at_most",
            'def trim(value: str) -> str:\n    """Return text with at most the input length."""\n    return value.rstrip()\n',
            "trim",
            [
                {
                    "description": "The returned text is no longer than the input.",
                    "preconditions": [],
                    "expected_behavior": "len(result) <= len(value)",
                    "violation_condition": "len(result) > len(value)",
                    "confidence": 0.9,
                    "property_spec": {
                        "arguments": [
                            {
                                "name": "value",
                                "strategy": {
                                    "kind": "text",
                                    "alphabet": "ab ",
                                    "minimum_length": 0,
                                    "maximum_length": 16,
                                },
                            }
                        ],
                        "oracle": {"kind": "result_length_le_arg", "argument": "value"},
                        "oracle_explanation": "At most means less than or equal, not equal.",
                        "contract_citation": "at most the input length",
                    },
                }
            ],
        ),
        _example(
            "text_equal",
            'def identity(value: str) -> str:\n    """Return text with exactly the input length."""\n    return value\n',
            "identity",
            [
                {
                    "description": "The returned text has exactly the input length.",
                    "preconditions": [],
                    "expected_behavior": "len(result) == len(value)",
                    "violation_condition": "len(result) != len(value)",
                    "confidence": 0.9,
                    "property_spec": {
                        "arguments": [
                            {
                                "name": "value",
                                "strategy": {
                                    "kind": "text",
                                    "alphabet": "ab",
                                    "minimum_length": 0,
                                    "maximum_length": 16,
                                },
                            }
                        ],
                        "oracle": {"kind": "result_length_eq_arg", "argument": "value"},
                        "oracle_explanation": "Exactly requires equality.",
                        "contract_citation": "exactly the input length",
                    },
                }
            ],
        ),
        _example(
            "list_sort",
            'def ordered(values: list[int]) -> list[int]:\n    """Return values in nondecreasing order and preserve every item, including duplicates."""\n    return sorted(values)\n',
            "ordered",
            [
                {
                    "description": "The result is nondecreasing.",
                    "preconditions": [],
                    "expected_behavior": "result is nondecreasing",
                    "violation_condition": "an adjacent pair decreases",
                    "confidence": 0.9,
                    "property_spec": {
                        "arguments": [
                            {
                                "name": "values",
                                "strategy": {
                                    "kind": "integer_lists",
                                    "element_minimum": -10,
                                    "element_maximum": 10,
                                    "minimum_length": 0,
                                    "maximum_length": 16,
                                },
                            }
                        ],
                        "oracle": {"kind": "result_list_nondecreasing"},
                        "oracle_explanation": "Ordering is one independent property.",
                        "contract_citation": "nondecreasing order",
                    },
                },
                {
                    "description": "The result preserves duplicate multiplicity.",
                    "preconditions": [],
                    "expected_behavior": "result has the same multiset as values",
                    "violation_condition": "an item or duplicate is added or removed",
                    "confidence": 0.9,
                    "property_spec": {
                        "arguments": [
                            {
                                "name": "values",
                                "strategy": {
                                    "kind": "integer_lists",
                                    "element_minimum": -10,
                                    "element_maximum": 10,
                                    "minimum_length": 0,
                                    "maximum_length": 16,
                                },
                            }
                        ],
                        "oracle": {
                            "kind": "result_list_preserves_multiset",
                            "argument": "values",
                        },
                        "oracle_explanation": "Multiset preservation is independent of ordering.",
                        "contract_citation": "preserve every item, including duplicates",
                    },
                },
            ],
        ),
        _example(
            "unsupported_abstain",
            'def title(value: str) -> str:\n    """Return a grammatically improved title."""\n    return value.title()\n',
            "title",
            [],
        ),
    )
