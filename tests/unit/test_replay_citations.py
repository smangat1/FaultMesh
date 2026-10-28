from __future__ import annotations

from faultmesh.replay.citations import (
    CitationIntegrity,
    CitationSource,
    CitationSourceKind,
    LikelyReason,
    SourceCitation,
    SummaryStatement,
    audit_agent_summary,
    check_likely_reason,
)
from faultmesh.replay.claims import (
    ClaimPredicate,
    EvidencePacket,
    EvidenceSource,
    FileChangedAssertion,
    FileState,
    TypedClaim,
    packet_hash,
    render_atomic_assertion,
)

BEFORE = "a" * 64
AFTER = "b" * 64


def _source(
    *,
    text: str = "The prompt requested a parser.",
    session_id: str = "session-a",
    sequence: int = 2,
    redacted: bool = False,
    truncated: bool = False,
) -> CitationSource:
    return CitationSource(
        id="prompt:2",
        session_id=session_id,
        sequence=sequence,
        kind=CitationSourceKind.USER_PROMPT,
        normalized_text=text,
        redacted=redacted,
        truncated=truncated,
    )


def _reason(quote: str, *, start: int = 4, end: int = 10) -> LikelyReason:
    return LikelyReason(
        text="The edit was probably made to implement parsing.",
        citations=[
            SourceCitation(source_id="prompt:2", start=start, end=end, quote=quote)
        ],
    )


def test_exact_quote_integrity_does_not_verify_inferred_intent_or_entailment() -> None:
    checked = check_likely_reason(
        _reason("prompt"),
        [_source()],
        session_id="session-a",
        current_sequence=3,
    )
    assert checked.citation_status == "valid"
    assert checked.citations[0].integrity == CitationIntegrity.VALID
    assert checked.label == "likely reason (model inference)"
    assert checked.entailment_status == "not_deterministically_assessed"
    assert checked.verified_intent is False


def test_quote_forgery_alteration_redaction_and_empty_refs_stay_invalid_or_empty() -> None:
    forged = check_likely_reason(
        _reason("parser"), [_source()], session_id="session-a", current_sequence=3
    )
    altered = check_likely_reason(
        _reason("Prompt", start=4, end=10),
        [_source()],
        session_id="session-a",
        current_sequence=3,
    )
    redacted = check_likely_reason(
        _reason("prompt"),
        [_source(redacted=True)],
        session_id="session-a",
        current_sequence=3,
    )
    empty = check_likely_reason(
        LikelyReason(text="Maybe for parsing."),
        [_source()],
        session_id="session-a",
        current_sequence=3,
    )
    assert forged.citations[0].reason_code == "quote_mismatch"
    assert altered.citations[0].reason_code == "quote_mismatch"
    assert redacted.citations[0].reason_code == "redacted_or_truncated_source"
    assert empty.citation_status == "empty"
    assert empty.verified_intent is False


def test_wrong_session_and_future_or_current_non_prompt_sources_are_rejected() -> None:
    wrong_session = check_likely_reason(
        _reason("prompt"),
        [_source(session_id="session-b")],
        session_id="session-a",
        current_sequence=3,
    )
    future = check_likely_reason(
        _reason("prompt"),
        [_source(sequence=4)],
        session_id="session-a",
        current_sequence=3,
    )
    current_event = _source(sequence=3)
    current_event = current_event.model_copy(update={"kind": CitationSourceKind.PRIOR_EVENT})
    not_prior = check_likely_reason(
        _reason("prompt"),
        [current_event],
        session_id="session-a",
        current_sequence=3,
    )
    assert wrong_session.citations[0].reason_code == "wrong_session"
    assert future.citations[0].reason_code == "future_step"
    assert not_prior.citations[0].reason_code == "not_prior_evidence"


def test_irrelevant_but_real_quote_has_integrity_without_semantic_green_badge() -> None:
    source = _source(text="Tests passed yesterday.")
    checked = check_likely_reason(
        LikelyReason(
            text="The author wanted to improve security.",
            citations=[
                SourceCitation(
                    source_id="prompt:2",
                    start=0,
                    end=len(source.normalized_text),
                    quote=source.normalized_text,
                )
            ],
        ),
        [source],
        session_id="session-a",
        current_sequence=3,
    )
    assert checked.citation_status == "valid"
    assert checked.verified_intent is False
    assert checked.entailment_status == "not_deterministically_assessed"


def _packet() -> EvidencePacket:
    ref = f"file:module.py:after:{AFTER}"
    packet = EvidencePacket(
        session_id="session-a",
        checkpoint_id="record-a",
        sequence=3,
        record_complete=True,
        files=[
            FileState(
                path="module.py",
                before_sha256=BEFORE,
                after_sha256=AFTER,
                change="modified",
            )
        ],
        sources=[
            EvidenceSource(
                id=ref,
                kind="file",
                session_id="session-a",
                sequence=3,
                content_sha256=AFTER,
            )
        ],
        evidence_hash="0" * 64,
    )
    return packet.model_copy(update={"evidence_hash": packet_hash(packet)})


def _file_claim(path: str, ref: str, claim_id: str) -> TypedClaim:
    return TypedClaim(
        id=claim_id,
        assertion=FileChangedAssertion(
            predicate=ClaimPredicate.FILE_CHANGED,
            path=path,
            before_sha256=BEFORE,
            after_sha256=AFTER,
            change="modified",
        ),
        evidence_refs=[ref],
    )


def test_summary_audit_accepts_only_exact_spans_with_supported_predicates() -> None:
    packet = _packet()
    ref = f"file:module.py:after:{AFTER}"
    true_claim = _file_claim("module.py", ref, "true")
    false_claim = _file_claim("invented.py", ref, "false-atomic")
    canonical_true = render_atomic_assertion(true_claim.assertion)
    canonical_false = render_atomic_assertion(false_claim.assertion)
    security = "Everything is secure and all tests passed."
    intent_performance = "The agent intended a complete performance improvement."
    mixed = f"Everything is secure and all tests passed; {canonical_true}"
    unrelated = "This prose is unrelated to the recorded file change."
    parts = [
        canonical_true,
        security,
        intent_performance,
        mixed,
        unrelated,
        canonical_false,
    ]
    summary = "\n".join(parts)

    def statement(text: str, claim: TypedClaim) -> SummaryStatement:
        start = summary.index(text)
        return SummaryStatement(
            start=start,
            end=start + len(text),
            exact_text=text,
            claim=claim,
        )

    statements = [
        statement(canonical_true, true_claim),
        statement(security, true_claim.model_copy(update={"id": "security"})),
        statement(
            intent_performance,
            false_claim.model_copy(update={"id": "intent-performance"}),
        ),
        statement(mixed, true_claim.model_copy(update={"id": "mixed-compound"})),
        SummaryStatement(
            start=summary.index(mixed) + mixed.index(canonical_true),
            end=summary.index(mixed) + mixed.index(canonical_true) + len(canonical_true),
            exact_text=canonical_true,
            claim=true_claim.model_copy(update={"id": "embedded-canonical-clause"}),
        ),
        statement(unrelated, false_claim.model_copy(update={"id": "unrelated"})),
        statement(canonical_false, false_claim),
        SummaryStatement(
            start=0,
            end=len(canonical_true),
            exact_text="altered span text",
            claim=true_claim.model_copy(update={"id": "altered-span"}),
        ),
    ]
    audit = audit_agent_summary(summary, statements, packet)
    assert [item.display_status for item in audit.statements] == [
        "supported_recorded_fact",
        "not_supported_by_this_recording",
        "not_supported_by_this_recording",
        "not_supported_by_this_recording",
        "not_supported_by_this_recording",
        "not_supported_by_this_recording",
        "contradicted_by_complete_recording",
        "not_supported_by_this_recording",
    ]
    assert [claim.id for claim in audit.supported_claims] == ["true"]
    assert [item.canonical_mapping_valid for item in audit.statements] == [
        True,
        False,
        False,
        False,
        True,
        False,
        True,
        False,
    ]
    assert [item.atomic_boundary_valid for item in audit.statements] == [
        True,
        True,
        True,
        True,
        False,
        True,
        True,
        False,
    ]
    assert all(item.claim_verdict is None for item in audit.statements[1:6])
