"""Bounded proposal generation, semantic validation, and transparent baselines."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from faultmesh.agents import ProposalConfiguration, ScoutAgent
from faultmesh.inference import ModelCallBudget
from faultmesh.inference.client import ValidatedInference
from faultmesh.schemas import (
    ArgumentSpec,
    FunctionMetadata,
    InferenceAttempt,
    InferenceMetadata,
    IntegerListStrategy,
    IntegerStrategy,
    NoExceptionOracle,
    OracleSpec,
    ProjectIndex,
    PropertySpec,
    ProposedHypothesis,
    ResultBetweenOracle,
    ResultBoundOracle,
    ResultLengthOracle,
    ResultListNondecreasingOracle,
    ResultListPreservesMultisetOracle,
    TextStrategy,
)
from faultmesh.verification import (
    PreconditionCompilationError,
    PreconditionCompiler,
    SpecificationError,
    SpecificationValidator,
)


@dataclass(frozen=True)
class ProposalRejection:
    proposal: ProposedHypothesis
    reason: str
    inference_call_index: int


@dataclass(frozen=True)
class ProposalOutcome:
    accepted: list[ProposedHypothesis] = field(default_factory=list)
    rejected: list[ProposalRejection] = field(default_factory=list)
    metadata: InferenceMetadata | None = None
    abstained: bool = False


class ProposalGenerator:
    """Generate within one total call budget, then apply the closed runtime validators."""

    def __init__(
        self,
        scout: ScoutAgent,
        *,
        max_model_calls: int = 2,
    ) -> None:
        if max_model_calls < 1:
            raise ValueError("max_model_calls must be at least one")
        self.scout = scout
        self.max_model_calls = max_model_calls
        self.preconditions = PreconditionCompiler()
        self.validator = SpecificationValidator()

    def generate(
        self,
        function: FunctionMetadata,
        index: ProjectIndex,
        *,
        configuration: ProposalConfiguration,
    ) -> ProposalOutcome:
        budget = ModelCallBudget(self.max_model_calls)
        initial = self.scout.inspect(
            function,
            configuration=configuration,
            budget=budget,
        )
        accepted, rejected = self._classify(initial, index)
        inferences = [initial]
        if (
            configuration == ProposalConfiguration.ABC
            and rejected
            and budget.remaining > 0
        ):
            feedback = "\n".join(
                f"- proposal {position}: {rejection.reason}"
                for position, rejection in enumerate(rejected, start=1)
            )
            repaired = self.scout.inspect(
                function,
                configuration=configuration,
                budget=budget,
                semantic_feedback=feedback,
                previous_response=initial.response,
            )
            retry_accepted, retry_rejected = self._classify(repaired, index)
            accepted.extend(retry_accepted)
            rejected.extend(retry_rejected)
            inferences.append(repaired)
        accepted = deduplicate_proposals(accepted)
        return ProposalOutcome(
            accepted=accepted,
            rejected=rejected,
            metadata=_combine_metadata(inferences, budget),
            abstained=not accepted and not rejected,
        )

    def _classify(
        self, inferred: ValidatedInference, index: ProjectIndex
    ) -> tuple[list[ProposedHypothesis], list[ProposalRejection]]:
        accepted: list[ProposedHypothesis] = []
        rejected: list[ProposalRejection] = []
        call_index = inferred.metadata.attempts[-1].call_index
        for proposed in inferred.response.hypotheses:
            candidate = proposed.model_copy(deep=True)
            reason: str | None = None
            try:
                self.preconditions.compile(candidate.preconditions, candidate.property_spec)
            except PreconditionCompilationError as exc:
                reason = f"precondition compiler: {exc}"
            if reason is None:
                try:
                    self.validator.validate(candidate.property_spec, index)
                except SpecificationError as exc:
                    reason = f"specification validator: {exc}"
            if reason is None:
                accepted.append(candidate)
            else:
                rejected.append(
                    ProposalRejection(
                        proposal=candidate,
                        reason=reason,
                        inference_call_index=call_index,
                    )
                )
        return accepted, rejected


def canonical_property_key(proposal: ProposedHypothesis) -> str:
    """Identity for one semantic property, excluding run/source-specific bindings."""

    specification = proposal.property_spec.model_dump(mode="json")
    for field_name in ("target", "evidence", "seed", "max_examples"):
        specification.pop(field_name, None)
    specification.pop("qualified_name", None)
    return json.dumps(specification, sort_keys=True, separators=(",", ":"))


def deduplicate_proposals(
    proposals: list[ProposedHypothesis], *, max_properties: int | None = None
) -> list[ProposedHypothesis]:
    seen: set[str] = set()
    unique: list[ProposedHypothesis] = []
    for proposal in proposals:
        key = canonical_property_key(proposal)
        if key in seen:
            continue
        seen.add(key)
        unique.append(proposal)
        if max_properties is not None and len(unique) >= max_properties:
            break
    return unique


class DocumentedContractProposer:
    """Transparent docstring rules for the same closed executable DSL.

    The rules inspect annotations and explicit contract phrases only. They do not inspect fixes,
    evaluator labels, benchmark IDs, or implementation behavior.
    """

    def propose(self, function: FunctionMetadata) -> list[ProposedHypothesis]:
        docstring = function.docstring or ""
        normalized = " ".join(docstring.split())
        arguments = [
            _argument_for(parameter.name, parameter.annotation, normalized)
            for parameter in function.parameters
        ]
        if any(argument is None for argument in arguments):
            return []
        typed_arguments = [argument for argument in arguments if argument is not None]
        preconditions = _documented_preconditions(normalized)
        candidates: list[tuple[OracleSpec, str]] = []

        upper = re.search(r"never exceed(?:s)?\s+([A-Za-z_]\w*)", normalized, re.I)
        if function.return_annotation == "int" and upper:
            candidates.append(
                (ResultBoundOracle(kind="result_le_arg", argument=upper.group(1)), upper.group(0))
            )
        floor = re.search(r"never below\s+([A-Za-z_]\w*)", normalized, re.I)
        if function.return_annotation == "int" and floor:
            candidates.append(
                (ResultBoundOracle(kind="result_ge_arg", argument=floor.group(1)), floor.group(0))
            )
        between = re.search(
            r"between\s+([A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)\s*,?\s+inclusive",
            normalized,
            re.I,
        )
        if function.return_annotation == "int" and between:
            candidates.append(
                (
                    ResultBetweenOracle(
                        lower_argument=between.group(1),
                        upper_argument=between.group(2),
                        inclusive=True,
                    ),
                    between.group(0),
                )
            )
        text_argument = next(
            (
                argument.name
                for argument in typed_arguments
                if isinstance(argument.strategy, TextStrategy)
            ),
            None,
        )
        if function.return_annotation == "str" and text_argument:
            at_most = re.search(
                r"(?:at most the original input length|no longer than the input)",
                normalized,
                re.I,
            )
            if at_most:
                candidates.append(
                    (
                        ResultLengthOracle(
                            kind="result_length_le_arg", argument=text_argument
                        ),
                        at_most.group(0),
                    )
                )
            equal = re.search(
                r"(?:exactly the same length as the input|exactly the input length)",
                normalized,
                re.I,
            )
            if equal:
                candidates.append(
                    (
                        ResultLengthOracle(
                            kind="result_length_eq_arg", argument=text_argument
                        ),
                        equal.group(0),
                    )
                )
        list_argument = next(
            (
                argument.name
                for argument in typed_arguments
                if isinstance(argument.strategy, IntegerListStrategy)
            ),
            None,
        )
        nondecreasing = re.search(r"nondecreasing order|nondecreasing values", normalized, re.I)
        if function.return_annotation == "list[int]" and list_argument and nondecreasing:
            candidates.append((ResultListNondecreasingOracle(), nondecreasing.group(0)))
        duplicates = re.search(
            r"(?:preserv(?:e|ing) (?:every|duplicate)|including duplicates|"
            r"including duplicate values)",
            normalized,
            re.I,
        )
        if function.return_annotation == "list[int]" and list_argument and duplicates:
            candidates.append(
                (
                    ResultListPreservesMultisetOracle(argument=list_argument),
                    duplicates.group(0),
                )
            )
        no_exception = re.search(r"without raising an exception", normalized, re.I)
        if no_exception:
            candidates.append((NoExceptionOracle(), no_exception.group(0)))

        proposals = [
            _baseline_hypothesis(function, typed_arguments, preconditions, oracle, citation)
            for oracle, citation in candidates
        ]
        accepted: list[ProposedHypothesis] = []
        for proposal in proposals:
            try:
                PreconditionCompiler().compile(proposal.preconditions, proposal.property_spec)
            except PreconditionCompilationError:
                continue
            accepted.append(proposal)
        return deduplicate_proposals(accepted)


def _argument_for(name: str, annotation: str | None, docstring: str) -> ArgumentSpec | None:
    if annotation == "int":
        return ArgumentSpec(name=name, strategy=IntegerStrategy(minimum=-20, maximum=20))
    if annotation == "str":
        alphabet = "MDCLXVI" if "roman numeral" in docstring.casefold() else "ab# !🙂"
        return ArgumentSpec(
            name=name,
            strategy=TextStrategy(alphabet=alphabet, minimum_length=0, maximum_length=12),
        )
    if annotation == "list[int]":
        return ArgumentSpec(
            name=name,
            strategy=IntegerListStrategy(
                element_minimum=-5,
                element_maximum=5,
                minimum_length=0,
                maximum_length=8,
            ),
        )
    return None


def _documented_preconditions(docstring: str) -> list[str]:
    match = re.search(r"Valid inputs satisfy\s+(.+?)(?:\.|$)", docstring, re.I)
    if not match:
        return []
    return [part.strip() for part in re.split(r"\s+and\s+", match.group(1)) if part.strip()]


def _baseline_hypothesis(
    function: FunctionMetadata,
    arguments: list[ArgumentSpec],
    preconditions: list[str],
    oracle: OracleSpec,
    citation: str,
) -> ProposedHypothesis:
    reference = function.reference.model_copy(deep=True)
    specification = PropertySpec.model_validate(
        {
            "schema_version": "1.1",
            "target": reference.model_dump(mode="json"),
            "qualified_name": function.qualified_name,
            "arguments": [argument.model_dump(mode="json") for argument in arguments],
            "constraints": [],
            "oracle": oracle.model_dump(mode="json"),
            "oracle_explanation": citation,
            "contract_citation": citation,
            "evidence": [reference.model_dump(mode="json")],
            "max_examples": 200,
            "seed": 1,
        }
    )
    return ProposedHypothesis(
        description=f"Transparent documented-contract rule: {citation}",
        source_references=[reference],
        preconditions=preconditions,
        expected_behavior=citation,
        violation_condition=f"The documented condition is false: {citation}",
        confidence=1.0,
        property_spec=specification,
    )


def _combine_metadata(
    inferences: list[ValidatedInference], budget: ModelCallBudget
) -> InferenceMetadata:
    attempts: list[InferenceAttempt] = [
        attempt for inference in inferences for attempt in inference.metadata.attempts
    ]
    latest = inferences[-1].metadata
    prompt_tokens = _sum_optional(attempt.prompt_tokens for attempt in attempts)
    completion_tokens = _sum_optional(attempt.completion_tokens for attempt in attempts)
    return InferenceMetadata(
        backend=latest.backend,
        model=latest.model,
        hardware=latest.hardware,
        latency_ms=sum(attempt.latency_ms for attempt in attempts),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        repair_attempts=sum(
            1 for attempt in attempts if attempt.phase == "json_repair"
        ),
        model_calls=len(attempts),
        unused_model_calls=budget.remaining,
        attempts=attempts,
    )


def _sum_optional(values: Iterable[int | None]) -> int | None:
    collected = list(values)
    if any(value is None for value in collected):
        return None
    return sum(value for value in collected if value is not None)
