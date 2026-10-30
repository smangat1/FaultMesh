"""Citation-integrity checks and bounded audits of recorded agent summaries."""

from __future__ import annotations

import json
import unicodedata
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimVerdict,
    ClaimVerdictName,
    EvidencePacket,
    TypedClaim,
    render_atomic_assertion,
)
from faultmesh.replay.models import ReplayExport

CITATION_POLICY_VERSION = "replay-citation-policy-1.0"
SUMMARY_AUDITOR_VERSION = "replay-summary-auditor-1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CitationSourceKind(StrEnum):
    USER_PROMPT = "user_prompt"
    PRIOR_EVENT = "prior_event"
    AGENT_EXPLANATION = "agent_explanation"


class CitationSource(StrictModel):
    id: str
    session_id: str
    sequence: int = Field(ge=1)
    kind: CitationSourceKind
    normalized_text: str
    redacted: bool = False
    truncated: bool = False


class SourceCitation(StrictModel):
    source_id: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    quote: str


class LikelyReason(StrictModel):
    text: str = Field(min_length=1, max_length=2_000)
    citations: list[SourceCitation] = Field(default_factory=list, max_length=16)


class CitationIntegrity(StrEnum):
    VALID = "valid_exact_quote"
    INVALID = "invalid_source_or_quote"


class CheckedCitation(StrictModel):
    citation: SourceCitation
    integrity: CitationIntegrity
    reason_code: str
    source_text: str | None = None
    policy_version: Literal["replay-citation-policy-1.0"] = (
        "replay-citation-policy-1.0"
    )


class CheckedLikelyReason(StrictModel):
    label: Literal["likely reason (model inference)"] = "likely reason (model inference)"
    text: str
    citations: list[CheckedCitation]
    citation_status: Literal["valid", "invalid", "empty"]
    entailment_status: Literal["not_deterministically_assessed"] = (
        "not_deterministically_assessed"
    )
    verified_intent: Literal[False] = False


class SummaryStatement(StrictModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    exact_text: str
    claim: TypedClaim


class SummaryStatementAudit(StrictModel):
    statement: SummaryStatement
    span_valid: bool
    canonical_mapping_valid: bool
    atomic_boundary_valid: bool
    claim_verdict: ClaimVerdict | None = None
    display_status: Literal[
        "supported_recorded_fact",
        "contradicted_by_complete_recording",
        "not_supported_by_this_recording",
    ]


class AgentSummaryAudit(StrictModel):
    schema_version: Literal["replay-summary-audit-1.0"] = "replay-summary-audit-1.0"
    summary_text: str
    statements: list[SummaryStatementAudit]
    supported_claims: list[TypedClaim]
    auditor_version: Literal["replay-summary-auditor-1.0"] = (
        "replay-summary-auditor-1.0"
    )
    limitations: list[str] = Field(
        default_factory=lambda: [
            "Only exact statement spans with supported typed predicates are accepted as facts.",
            "A statement must equal the deterministic canonical rendering of its typed predicate; "
            "substring proximity cannot establish semantic correspondence.",
            "A canonical statement must occupy a standalone summary line; embedded clauses in "
            "compound prose remain unverified.",
            "Unmapped prose and claims about intent, security, performance or completeness "
            "remain unverified.",
        ]
    )


def normalize_source_text(text: str) -> str:
    """NFC plus LF newlines; no trimming or whitespace folding, so offsets stay auditable."""
    return unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))


def _captured_text(value: object) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def citation_sources(exported: ReplayExport, current_sequence: int) -> list[CitationSource]:
    """Build local-only sources from the selected session, never from unrelated history."""
    sources = [
        CitationSource(
            id=span.id,
            session_id=exported.session.id,
            sequence=span.sequence,
            kind=(
                CitationSourceKind.USER_PROMPT
                if span.kind == "prompt"
                else (
                    CitationSourceKind.AGENT_EXPLANATION
                    if span.kind == "agent_message"
                    else CitationSourceKind.PRIOR_EVENT
                )
            ),
            normalized_text=span.text,
            redacted=span.redacted,
            truncated=span.truncated,
        )
        for span in exported.transcript_spans
        if span.sequence <= current_sequence
    ]
    for record in exported.records:
        if record.sequence > current_sequence:
            continue
        for field_name, value, kind in (
            ("tool_input", record.tool_input, CitationSourceKind.PRIOR_EVENT),
            ("tool_response", record.tool_response, CitationSourceKind.AGENT_EXPLANATION),
        ):
            if value is None:
                continue
            sources.append(
                CitationSource(
                    id=f"record:{record.id}:{field_name}",
                    session_id=record.session_id,
                    sequence=record.sequence,
                    kind=kind,
                    normalized_text=normalize_source_text(_captured_text(value)),
                    redacted=record.redaction_applied,
                    truncated=record.truncated,
                )
            )
    return sources


def check_likely_reason(
    reason: LikelyReason,
    sources: list[CitationSource],
    *,
    session_id: str,
    current_sequence: int,
) -> CheckedLikelyReason:
    by_id = {source.id: source for source in sources}
    checked: list[CheckedCitation] = []
    for citation in reason.citations:
        source = by_id.get(citation.source_id)
        if source is None:
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="source_missing",
                )
            )
            continue
        if source.session_id != session_id:
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="wrong_session",
                )
            )
            continue
        if source.sequence > current_sequence:
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="future_step",
                    source_text=source.normalized_text,
                )
            )
            continue
        if source.kind != CitationSourceKind.USER_PROMPT and source.sequence == current_sequence:
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="not_prior_evidence",
                    source_text=source.normalized_text,
                )
            )
            continue
        if source.redacted or source.truncated:
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="redacted_or_truncated_source",
                    source_text=source.normalized_text,
                )
            )
            continue
        if citation.end < citation.start or citation.end > len(source.normalized_text):
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="offset_out_of_bounds",
                    source_text=source.normalized_text,
                )
            )
            continue
        actual = source.normalized_text[citation.start : citation.end]
        if actual != normalize_source_text(citation.quote):
            checked.append(
                CheckedCitation(
                    citation=citation,
                    integrity=CitationIntegrity.INVALID,
                    reason_code="quote_mismatch",
                    source_text=source.normalized_text,
                )
            )
            continue
        checked.append(
            CheckedCitation(
                citation=citation,
                integrity=CitationIntegrity.VALID,
                reason_code="exact_normalized_span",
                source_text=source.normalized_text,
            )
        )
    status: Literal["valid", "invalid", "empty"]
    if not checked:
        status = "empty"
    elif all(item.integrity == CitationIntegrity.VALID for item in checked):
        status = "valid"
    else:
        status = "invalid"
    return CheckedLikelyReason(
        text=reason.text,
        citations=checked,
        citation_status=status,
    )


def audit_agent_summary(
    summary_text: str,
    statements: list[SummaryStatement],
    packet: EvidencePacket,
) -> AgentSummaryAudit:
    checker = ClaimChecker()
    audited: list[SummaryStatementAudit] = []
    supported: list[TypedClaim] = []
    for statement in statements:
        span_valid = (
            statement.end >= statement.start
            and statement.end <= len(summary_text)
            and summary_text[statement.start : statement.end] == statement.exact_text
        )
        if not span_valid:
            audited.append(
                SummaryStatementAudit(
                    statement=statement,
                    span_valid=False,
                    canonical_mapping_valid=False,
                    atomic_boundary_valid=False,
                    display_status="not_supported_by_this_recording",
                )
            )
            continue
        canonical_mapping_valid = (
            statement.exact_text == render_atomic_assertion(statement.claim.assertion)
        )
        atomic_boundary_valid = (
            (statement.start == 0 or summary_text[statement.start - 1] == "\n")
            and (statement.end == len(summary_text) or summary_text[statement.end] == "\n")
        )
        if not canonical_mapping_valid or not atomic_boundary_valid:
            audited.append(
                SummaryStatementAudit(
                    statement=statement,
                    span_valid=True,
                    canonical_mapping_valid=canonical_mapping_valid,
                    atomic_boundary_valid=atomic_boundary_valid,
                    display_status="not_supported_by_this_recording",
                )
            )
            continue
        verdict = checker.check(packet, statement.claim)
        if verdict.verdict == ClaimVerdictName.SUPPORTED:
            display: Literal[
                "supported_recorded_fact",
                "contradicted_by_complete_recording",
                "not_supported_by_this_recording",
            ] = "supported_recorded_fact"
            supported.append(statement.claim)
        elif verdict.verdict == ClaimVerdictName.CONTRADICTED:
            display = "contradicted_by_complete_recording"
        else:
            display = "not_supported_by_this_recording"
        audited.append(
            SummaryStatementAudit(
                statement=statement,
                span_valid=True,
                canonical_mapping_valid=True,
                atomic_boundary_valid=True,
                claim_verdict=verdict,
                display_status=display,
            )
        )
    return AgentSummaryAudit(
        summary_text=summary_text,
        statements=audited,
        supported_claims=supported,
    )
