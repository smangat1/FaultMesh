"""Milestone 1 Code Scout agent."""

from __future__ import annotations

import json
from enum import StrEnum

from faultmesh.agents.examples import few_shot_examples
from faultmesh.analysis import ContextBuilder
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.inference.client import ModelCallBudget, ValidatedInference
from faultmesh.schemas import (
    FunctionMetadata,
    ScoutResponse,
    scout_response_json_schema,
    scout_response_json_schema_for,
)


class ProposalConfiguration(StrEnum):
    CURRENT_MAIN = "current-main"
    A = "a"
    AB = "ab"
    ABC = "abc"


class ScoutAgent:
    def __init__(self, client: InferenceClient, context_builder: ContextBuilder) -> None:
        self.client = client
        self.context_builder = context_builder

    def inspect(
        self,
        function: FunctionMetadata,
        *,
        configuration: ProposalConfiguration = ProposalConfiguration.CURRENT_MAIN,
        budget: ModelCallBudget | None = None,
        semantic_feedback: str | None = None,
        previous_response: ScoutResponse | None = None,
    ) -> ValidatedInference:
        if isinstance(self.client.backend, HeuristicBackend):
            self.client.backend.bind(function)
        specialized = configuration != ProposalConfiguration.CURRENT_MAIN
        json_schema = (
            scout_response_json_schema_for(function)
            if specialized
            else scout_response_json_schema()
        )
        schema = json.dumps(json_schema, separators=(",", ":"))
        examples = ""
        if configuration in {ProposalConfiguration.AB, ProposalConfiguration.ABC}:
            examples = _few_shot_prompt()
        correction = ""
        phase = "initial"
        if semantic_feedback is not None:
            phase = "semantic_retry"
            previous = previous_response.model_dump_json(indent=2) if previous_response else "{}"
            correction = (
                "\nThis is the only semantic correction attempt. The prior proposal was rejected "
                "before execution. Correct only the reported issue using the same function evidence, "
                "or return an empty hypotheses array when the contract is unsupported. Do not infer "
                "a new contract from the implementation.\n"
                f"Rejection reason(s): {semantic_feedback[:3000]}\n"
                f"Previous proposal:\n{previous[:8000]}\n"
            )
        prompt = (
            "You are the FaultMesh Code Scout. Propose only objectively testable behavioral "
            "hypotheses grounded in an explicit contract in the supplied function docstring. "
            "Never infer a contract from the function name or implementation, and never claim a "
            "bug is verified. For schema 1.1, contract_citation must be a specific verbatim "
            "docstring fragment supporting the oracle. Return no hypothesis when the docstring "
            "does not independently justify a supported property. "
            "Set property_spec.schema_version to exactly \"1.1\" whenever a hypothesis uses a "
            "text or integer_lists strategy or any typed oracle; never omit that nested version. "
            "Use property_spec.schema_version \"1.0\" only for the legacy integer-only DSL. "
            "Use only the property operations represented in the JSON schema. Every documented "
            "or stated input precondition must be represented by an executable constraint; return "
            "no hypothesis if the property language cannot express it. Text alphabets and input "
            "lengths, and integer-list element and length bounds, belong in strategy domains. "
            "Match strategies to exact annotations: str uses text, list[int] uses integer_lists, "
            "and int uses integers. Do not repeat an annotation or strategy type as a prose "
            "precondition. "
            "Integer comparisons apply only to integer arguments. Source identities are "
            "attached deterministically after inference, so use the supplied path and qualified "
            "function name and do not invent other evidence. Return JSON only.\n\n"
            + (
                "The supplied schema is specialized to this exact function. Emit exactly one "
                "argument entry per listed supported parameter, in order, with the annotation-"
                "compatible strategy. Use nested property schema_version \"1.1\". A well-formed "
                "proposal is still invalid unless its oracle is justified by the docstring.\n\n"
                if specialized
                else ""
            )
            + examples
            + correction
            + f"JSON schema:\n{schema}\n\n"
            + f"Function evidence:\n{self.context_builder.for_function(function)}"
        )
        inferred = self.client.scout(
            prompt,
            json_schema=json_schema,
            budget=budget,
            phase=phase,
        )
        for hypothesis in inferred.response.hypotheses:
            specification = hypothesis.property_spec
            reference = function.reference.model_copy(deep=True)
            specification.qualified_name = function.qualified_name
            specification.target = reference.model_copy(deep=True)
            specification.evidence = [reference.model_copy(deep=True)]
            hypothesis.source_references = [reference.model_copy(deep=True)]
        return inferred


def _few_shot_prompt() -> str:
    blocks = [
        "Few-shot examples are independently authored formatting/contract examples, not training "
        "data. Their source identities are illustrative and must never be copied into the target."
    ]
    for example in few_shot_examples():
        blocks.append(
            f"Example {example.label} source:\n{example.source}"
            f"Example {example.label} response:\n{example.response.model_dump_json()}"
        )
    return "\n\n".join(blocks) + "\n\n"

