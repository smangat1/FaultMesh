"""Milestone 1 Code Scout agent."""

from __future__ import annotations

import json

from faultmesh.analysis import ContextBuilder
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.inference.client import ValidatedInference
from faultmesh.schemas import FunctionMetadata, scout_response_json_schema


class ScoutAgent:
    def __init__(self, client: InferenceClient, context_builder: ContextBuilder) -> None:
        self.client = client
        self.context_builder = context_builder

    def inspect(self, function: FunctionMetadata) -> ValidatedInference:
        if isinstance(self.client.backend, HeuristicBackend):
            self.client.backend.bind(function)
        schema = json.dumps(scout_response_json_schema(), separators=(",", ":"))
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
            f"JSON schema:\n{schema}\n\n"
            f"Function evidence:\n{self.context_builder.for_function(function)}"
        )
        inferred = self.client.scout(prompt)
        for hypothesis in inferred.response.hypotheses:
            specification = hypothesis.property_spec
            reference = function.reference.model_copy(deep=True)
            specification.qualified_name = function.qualified_name
            specification.target = reference.model_copy(deep=True)
            specification.evidence = [reference.model_copy(deep=True)]
            hypothesis.source_references = [reference.model_copy(deep=True)]
        return inferred

