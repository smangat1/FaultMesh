"""Milestone 1 Code Scout agent."""

from __future__ import annotations

import json

from faultmesh.analysis import ContextBuilder
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.inference.client import ValidatedInference
from faultmesh.schemas import FunctionMetadata, ScoutResponse


class ScoutAgent:
    def __init__(self, client: InferenceClient, context_builder: ContextBuilder) -> None:
        self.client = client
        self.context_builder = context_builder

    def inspect(self, function: FunctionMetadata) -> ValidatedInference:
        if isinstance(self.client.backend, HeuristicBackend):
            self.client.backend.bind(function)
        schema = json.dumps(ScoutResponse.model_json_schema(), separators=(",", ":"))
        prompt = (
            "You are the FaultMesh Code Scout. Propose only objectively testable behavioral "
            "hypotheses grounded in the supplied source or docstring. Never claim a bug is "
            "verified. "
            "Use only the property operations represented in the JSON schema. Every documented "
            "or stated input precondition must be represented by an executable constraint; return "
            "no hypothesis if the property language cannot express it. Source identities are "
            "attached deterministically after inference, so use the supplied path and qualified "
            "function name and do not invent other evidence. Return JSON only.\n\n"
            f"JSON schema:\n{schema}\n\n"
            f"Function evidence:\n{self.context_builder.for_function(function)}"
        )
        inferred = self.client.scout(prompt)
        for hypothesis in inferred.response.hypotheses:
            specification = hypothesis.property_spec
            if (
                specification.qualified_name == function.qualified_name
                and specification.target.path == function.reference.path
            ):
                reference = function.reference.model_copy(deep=True)
                specification.target = reference.model_copy(deep=True)
                specification.evidence = [reference.model_copy(deep=True)]
                hypothesis.source_references = [reference.model_copy(deep=True)]
        return inferred

