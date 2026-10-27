"""Versioned, machine-readable contracts shared across FaultMesh modules."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION: Literal["1.0"] = "1.0"
MAX_TEXT_ALPHABET_SIZE = 64
MAX_TEXT_LENGTH = 256
MAX_INTEGER_LIST_LENGTH = 64
MAX_SERIALIZED_INPUT_BYTES = 16_384


def utc_now() -> datetime:
    return datetime.now(UTC)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class VerificationStatus(StrEnum):
    PROPOSED = "PROPOSED"
    TESTABLE = "TESTABLE"
    TESTED = "TESTED"
    REPRODUCED = "REPRODUCED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    INCONCLUSIVE = "INCONCLUSIVE"
    FLAKY = "FLAKY"
    UNSUPPORTED = "UNSUPPORTED"


class ExperimentOutcome(StrEnum):
    NO_VIOLATION = "NO_VIOLATION"
    PROPERTY_VIOLATION = "PROPERTY_VIOLATION"
    TARGET_EXCEPTION = "TARGET_EXCEPTION"
    HARNESS_ERROR = "HARNESS_ERROR"
    ENVIRONMENT_ERROR = "ENVIRONMENT_ERROR"
    TIMEOUT = "TIMEOUT"
    FLAKY = "FLAKY"


class SourceReference(StrictModel):
    path: str
    start_line: Annotated[int, Field(ge=1)]
    end_line: Annotated[int, Field(ge=1)]
    content_hash: str | None = None

    @field_validator("path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        normalized = value.replace("\\", "/")
        path = PurePosixPath(normalized)
        if path.is_absolute() or ".." in path.parts or normalized in {"", "."}:
            raise ValueError("source path must be a non-empty project-relative path")
        return str(path)

    @model_validator(mode="after")
    def ordered_lines(self) -> SourceReference:
        if self.end_line < self.start_line:
            raise ValueError("end_line must not precede start_line")
        return self


class ParameterMetadata(StrictModel):
    name: str
    annotation: str | None = None
    has_default: bool = False
    kind: Literal["positional", "keyword_only", "var_positional", "var_keyword"]


class FunctionMetadata(StrictModel):
    name: str
    qualified_name: str
    reference: SourceReference
    parameters: list[ParameterMetadata]
    return_annotation: str | None = None
    docstring: str | None = None
    source: str
    calls: list[str] = Field(default_factory=list)
    branch_count: int = 0
    exception_handlers: list[str] = Field(default_factory=list)
    assertions: list[str] = Field(default_factory=list)
    is_method: bool = False
    is_async: bool = False
    is_generator: bool = False


class ClassMetadata(StrictModel):
    name: str
    qualified_name: str
    reference: SourceReference
    bases: list[str] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list)


class ModuleMetadata(StrictModel):
    path: str
    content_hash: str
    imports: list[str] = Field(default_factory=list)
    functions: list[FunctionMetadata] = Field(default_factory=list)
    classes: list[ClassMetadata] = Field(default_factory=list)
    parse_error: str | None = None


class DocumentationMetadata(StrictModel):
    path: str
    content_hash: str
    headings: list[str] = Field(default_factory=list)


class ProjectIndex(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    root: str
    scanned_at: datetime = Field(default_factory=utc_now)
    modules: list[ModuleMetadata] = Field(default_factory=list)
    documentation: list[DocumentationMetadata] = Field(default_factory=list)

    @property
    def functions(self) -> list[FunctionMetadata]:
        return [function for module in self.modules for function in module.functions]


class IntegerStrategy(StrictModel):
    kind: Literal["integers"] = "integers"
    minimum: int = -100
    maximum: int = 100

    @model_validator(mode="after")
    def ordered_bounds(self) -> IntegerStrategy:
        if self.maximum < self.minimum:
            raise ValueError("strategy maximum must be >= minimum")
        return self


class TextStrategy(StrictModel):
    kind: Literal["text"] = "text"
    alphabet: str = Field(min_length=1, max_length=MAX_TEXT_ALPHABET_SIZE)
    minimum_length: Annotated[int, Field(ge=0, le=MAX_TEXT_LENGTH)] = 0
    maximum_length: Annotated[int, Field(ge=0, le=MAX_TEXT_LENGTH)] = 32

    @field_validator("alphabet")
    @classmethod
    def valid_alphabet(cls, value: str) -> str:
        if len(set(value)) != len(value):
            raise ValueError("text strategy alphabet characters must be unique")
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            raise ValueError("text strategy alphabet cannot contain Unicode surrogates")
        return value

    @model_validator(mode="after")
    def ordered_lengths(self) -> TextStrategy:
        if self.maximum_length < self.minimum_length:
            raise ValueError("text maximum_length must be >= minimum_length")
        return self


class IntegerListStrategy(StrictModel):
    kind: Literal["integer_lists"] = "integer_lists"
    element_minimum: int = -100
    element_maximum: int = 100
    minimum_length: Annotated[int, Field(ge=0, le=MAX_INTEGER_LIST_LENGTH)] = 0
    maximum_length: Annotated[int, Field(ge=0, le=MAX_INTEGER_LIST_LENGTH)] = 16

    @model_validator(mode="after")
    def ordered_bounds(self) -> IntegerListStrategy:
        if self.element_maximum < self.element_minimum:
            raise ValueError("list element_maximum must be >= element_minimum")
        if self.maximum_length < self.minimum_length:
            raise ValueError("list maximum_length must be >= minimum_length")
        return self


InputStrategy = Annotated[
    IntegerStrategy | TextStrategy | IntegerListStrategy,
    Field(discriminator="kind"),
]


class ArgumentSpec(StrictModel):
    name: str
    strategy: InputStrategy


class ConstraintSpec(StrictModel):
    kind: Literal["le", "lt", "ge", "gt", "eq", "ne"]
    left: str | int
    right: str | int

    @model_validator(mode="after")
    def reject_boolean_literals(self) -> ConstraintSpec:
        if type(self.left) is bool or type(self.right) is bool:
            raise ValueError("boolean constraint operands are not supported")
        return self


class NoExceptionOracle(StrictModel):
    kind: Literal["no_exception"] = "no_exception"


class ResultBoundOracle(StrictModel):
    kind: Literal["result_le_arg", "result_ge_arg"]
    argument: str


class ResultBetweenOracle(StrictModel):
    kind: Literal["result_between_args"] = "result_between_args"
    lower_argument: str
    upper_argument: str
    inclusive: bool = True


class ResultLengthOracle(StrictModel):
    kind: Literal["result_length_le_arg", "result_length_eq_arg"]
    argument: str


class ResultListNondecreasingOracle(StrictModel):
    kind: Literal["result_list_nondecreasing"] = "result_list_nondecreasing"


class ResultListPreservesMultisetOracle(StrictModel):
    kind: Literal["result_list_preserves_multiset"] = "result_list_preserves_multiset"
    argument: str


OracleSpec = Annotated[
    NoExceptionOracle
    | ResultBoundOracle
    | ResultBetweenOracle
    | ResultLengthOracle
    | ResultListNondecreasingOracle
    | ResultListPreservesMultisetOracle,
    Field(discriminator="kind"),
]


class PropertySpec(StrictModel):
    schema_version: Literal["1.0", "1.1"] = SCHEMA_VERSION
    target: SourceReference
    qualified_name: str
    arguments: list[ArgumentSpec]
    constraints: list[ConstraintSpec] = Field(default_factory=list)
    oracle: OracleSpec
    oracle_explanation: str = Field(min_length=1)
    contract_citation: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    evidence: list[SourceReference] = Field(min_length=1)
    max_examples: Annotated[int, Field(ge=1, le=10_000)] = 200
    seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = 1

    @model_validator(mode="after")
    def valid_closed_contract(self) -> PropertySpec:
        names = [argument.name for argument in self.arguments]
        if len(set(names)) != len(names):
            raise ValueError("property argument names must be unique")
        strategies = {argument.name: argument.strategy for argument in self.arguments}
        for constraint in self.constraints:
            for operand in (constraint.left, constraint.right):
                if isinstance(operand, str):
                    if operand not in strategies:
                        raise ValueError(f"constraint references unknown argument: {operand}")
                    if not isinstance(strategies[operand], IntegerStrategy):
                        raise ValueError("integer comparisons require integer argument operands")
        oracle = self.oracle
        if isinstance(oracle, ResultBoundOracle):
            if not isinstance(strategies.get(oracle.argument), IntegerStrategy):
                raise ValueError("integer result-bound oracle requires an integer argument")
        elif isinstance(oracle, ResultBetweenOracle):
            if not isinstance(
                strategies.get(oracle.lower_argument), IntegerStrategy
            ) or not isinstance(strategies.get(oracle.upper_argument), IntegerStrategy):
                raise ValueError("between oracle requires two integer arguments")
        elif isinstance(oracle, ResultLengthOracle):
            if not isinstance(
                strategies.get(oracle.argument), (TextStrategy, IntegerListStrategy)
            ):
                raise ValueError("result-length oracle requires a text or integer-list argument")
        elif isinstance(oracle, ResultListPreservesMultisetOracle):
            if not isinstance(strategies.get(oracle.argument), IntegerListStrategy):
                raise ValueError("multiset oracle requires an integer-list argument")
        elif isinstance(oracle, ResultListNondecreasingOracle) and not any(
            isinstance(strategy, IntegerListStrategy) for strategy in strategies.values()
        ):
            raise ValueError("nondecreasing oracle requires an integer-list input domain")

        uses_typed_extension = any(
            not isinstance(strategy, IntegerStrategy) for strategy in strategies.values()
        ) or isinstance(
            oracle,
            (
                ResultLengthOracle,
                ResultListNondecreasingOracle,
                ResultListPreservesMultisetOracle,
            ),
        )
        if self.schema_version == "1.0" and uses_typed_extension:
            raise ValueError("typed strategies and oracles require property schema 1.1")
        citation = (self.contract_citation or "").strip()
        if self.schema_version == "1.1" and len(citation) < 8:
            raise ValueError(
                "property schema 1.1 requires a specific source/docstring contract citation"
            )
        return self


class ProposedHypothesis(StrictModel):
    """The only model-authored payload accepted by the Milestone 1 Scout."""

    description: str = Field(min_length=1)
    source_references: list[SourceReference] = Field(min_length=1)
    preconditions: list[str]
    expected_behavior: str = Field(min_length=1)
    violation_condition: str = Field(min_length=1)
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]
    property_spec: PropertySpec


class ScoutResponse(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    hypotheses: list[ProposedHypothesis] = Field(max_length=8)


def scout_response_json_schema() -> dict[str, Any]:
    """Return the inference schema with semantic versions explicit on the wire."""

    schema = ScoutResponse.model_json_schema()
    property_schema = schema["$defs"]["PropertySpec"]
    properties = property_schema["properties"]
    properties["schema_version"].pop("default", None)
    properties["contract_citation"] = {"type": "string", "minLength": 8}
    required = property_schema["required"]
    for field in reversed(("schema_version", "contract_citation")):
        if field not in required:
            required.insert(0, field)
    return schema


def scout_response_json_schema_for(function: FunctionMetadata) -> dict[str, Any]:
    """Specialize the model-facing schema to one indexed function.

    This is only a generation aid. ``ScoutResponse`` and ``SpecificationValidator`` remain the
    runtime authorities, so a schema-conforming proposal can still be semantically unsupported.
    """

    schema = copy.deepcopy(scout_response_json_schema())
    supported = {
        parameter.name: parameter.annotation
        for parameter in function.parameters
        if parameter.kind in {"positional", "keyword_only"}
        and parameter.annotation in {"int", "str", "list[int]"}
    }
    property_schema = schema["$defs"]["PropertySpec"]
    strategy_def = {
        "int": "IntegerStrategy",
        "str": "TextStrategy",
        "list[int]": "IntegerListStrategy",
    }
    prefix_items = [
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "name": {"const": name, "type": "string"},
                "strategy": {"$ref": f"#/$defs/{strategy_def[annotation]}"},
            },
            "required": ["name", "strategy"],
        }
        for name, annotation in supported.items()
    ]
    property_schema["properties"]["arguments"] = {
        "type": "array",
        "prefixItems": prefix_items,
        "minItems": len(prefix_items),
        "maxItems": len(prefix_items),
        "items": False,
    }
    property_schema["properties"]["schema_version"] = {
        "const": "1.1",
        "type": "string",
    }

    integer_names = [name for name, annotation in supported.items() if annotation == "int"]
    text_names = [name for name, annotation in supported.items() if annotation == "str"]
    list_names = [name for name, annotation in supported.items() if annotation == "list[int]"]
    oracle_variants: list[dict[str, Any]] = [{"$ref": "#/$defs/NoExceptionOracle"}]
    if function.return_annotation == "int":
        for name in integer_names:
            oracle_variants.append(
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {
                            "enum": ["result_le_arg", "result_ge_arg"],
                            "type": "string",
                        },
                        "argument": {"const": name, "type": "string"},
                    },
                    "required": ["kind", "argument"],
                }
            )
        if len(integer_names) >= 2:
            oracle_variants.append({"$ref": "#/$defs/ResultBetweenOracle"})
    elif function.return_annotation == "str":
        for name in text_names:
            oracle_variants.append(
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {
                            "enum": ["result_length_le_arg", "result_length_eq_arg"],
                            "type": "string",
                        },
                        "argument": {"const": name, "type": "string"},
                    },
                    "required": ["kind", "argument"],
                }
            )
    elif function.return_annotation == "list[int]":
        if list_names:
            oracle_variants.append({"$ref": "#/$defs/ResultListNondecreasingOracle"})
        for name in list_names:
            oracle_variants.append(
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {
                            "const": "result_list_preserves_multiset",
                            "type": "string",
                        },
                        "argument": {"const": name, "type": "string"},
                    },
                    "required": ["kind", "argument"],
                }
            )
    property_schema["properties"]["oracle"] = {"oneOf": oracle_variants}
    if not integer_names:
        property_schema["properties"]["constraints"]["maxItems"] = 0
        schema["$defs"]["ProposedHypothesis"]["properties"]["preconditions"][
            "maxItems"
        ] = 0
    return schema


class HypothesisRevision(StrictModel):
    revision: Annotated[int, Field(ge=1)]
    changed_at: datetime = Field(default_factory=utc_now)
    actor: str
    reason: str
    snapshot: dict[str, Any]


class HypothesisRecord(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: f"hyp-{uuid4().hex[:12]}")
    investigation_id: str
    description: str
    source_references: list[SourceReference]
    preconditions: list[str]
    expected_behavior: str
    violation_condition: str
    originating_agent: str
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]
    verification_status: VerificationStatus = VerificationStatus.PROPOSED
    property_spec: PropertySpec
    experiment_ids: list[str] = Field(default_factory=list)
    revisions: list[HypothesisRevision] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class InferenceAttempt(StrictModel):
    call_index: Annotated[int, Field(ge=1)]
    phase: Literal["initial", "json_repair", "semantic_retry"]
    prompt_sha256: str
    raw_response: str
    latency_ms: Annotated[float, Field(ge=0)]
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    validation_error: str | None = None


class InferenceMetadata(StrictModel):
    backend: str
    model: str
    hardware: str
    latency_ms: Annotated[float, Field(ge=0)]
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    repair_attempts: Annotated[int, Field(ge=0)] = 0
    model_calls: Annotated[int, Field(ge=0)] = 0
    unused_model_calls: Annotated[int, Field(ge=0)] = 0
    attempts: list[InferenceAttempt] = Field(default_factory=list)


class ExperimentResult(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: f"exp-{uuid4().hex[:12]}")
    hypothesis_id: str
    outcome: ExperimentOutcome
    counterexample: dict[str, Any] | None = None
    observed: str
    expected: str
    failure_fingerprint: str | None = None
    expected_fingerprint: str | None = None
    fingerprint_matched: bool | None = None
    confirmation_runs: Annotated[int, Field(ge=0)] = 0
    confirming_failures: Annotated[int, Field(ge=0)] = 0
    reproduction_rate: Annotated[float, Field(ge=0.0, le=1.0)] = 0.0
    stdout: str = ""
    stderr: str = ""
    duration_ms: Annotated[float, Field(ge=0)] = 0.0
    evaluations: Annotated[int, Field(ge=0)] = 0
    seed: int
    environment: dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def valid_counts(self) -> ExperimentResult:
        if self.confirming_failures > self.confirmation_runs:
            raise ValueError("confirming_failures cannot exceed confirmation_runs")
        return self


class ArtifactSet(StrictModel):
    directory: str
    regression_test: str
    replay_manifest: str
    incident_json: str
    markdown_report: str


class Incident(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: f"inc-{uuid4().hex[:12]}")
    investigation_id: str
    hypothesis_id: str
    title: str
    affected_references: list[SourceReference]
    affected_function: str
    observed_behavior: str
    expected_behavior: str
    expectation_evidence: list[SourceReference]
    verification_status: Literal[VerificationStatus.VERIFIED]
    counterexample: dict[str, Any]
    exact_command: str
    required_environment: dict[str, str]
    seed: int
    confirmation_runs: int
    confirming_failures: int
    reproduction_rate: float
    failure_fingerprint: str
    stack_trace: str
    suspected_cause: str
    unresolved_assumptions: list[str]
    confidence: float
    limitations: list[str]
    artifacts: ArtifactSet | None = None
    created_at: datetime = Field(default_factory=utc_now)


class ReplayManifest(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    incident_id: str
    hypothesis_id: str
    property_spec: PropertySpec
    counterexample: dict[str, Any]
    expected_fingerprint: str
    confirmation_runs: Annotated[int, Field(ge=1, le=100)]


class VerificationManifest(StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    hypothesis_id: str
    property_spec: PropertySpec
    confirmation_runs: Annotated[int, Field(ge=1, le=100)] = 3
    mode: Literal["search", "replay"] = "search"
    counterexample: dict[str, Any] | None = None

    @model_validator(mode="after")
    def replay_requires_input(self) -> VerificationManifest:
        if self.mode == "replay" and self.counterexample is None:
            raise ValueError("replay mode requires a counterexample")
        return self

