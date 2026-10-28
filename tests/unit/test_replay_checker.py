from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimNarrator,
    ClaimPredicate,
    ClaimVerdictName,
    CommandExitAssertion,
    CommandExitFact,
    EvidencePacket,
    EvidenceSource,
    FileChangedAssertion,
    FileState,
    FunctionAddedAssertion,
    FunctionRemovedAssertion,
    FunctionState,
    PytestCountsFact,
    StructuredPytestCountsAssertion,
    TypedClaim,
    packet_hash,
)
from faultmesh.replay.models import TestCounts as ReplayTestCounts

BEFORE = "1" * 64
AFTER = "2" * 64


def _packet(*, ast_complete: bool = True, source_sequence: int = 7) -> EvidencePacket:
    packet = EvidencePacket(
        session_id="session-a",
        checkpoint_id="record-a",
        sequence=7,
        before_manifest_id="manifest:before",
        after_manifest_id="manifest:after",
        record_complete=True,
        files=[
            FileState(
                path="module.py",
                before_sha256=BEFORE,
                after_sha256=AFTER,
                change="modified",
            )
        ],
        functions=[
            FunctionState(
                path="module.py",
                before_content_sha256=BEFORE,
                after_content_sha256=AFTER,
                before_functions=["old", "stable"],
                after_functions=["new", "stable"],
                before_ast_complete=ast_complete,
                after_ast_complete=ast_complete,
            )
        ],
        command_exit=CommandExitFact(record_id="record-a", exit_code=1),
        pytest_counts=[
            PytestCountsFact(
                evidence_id="pytest-a",
                counts=ReplayTestCounts(passed=2, failed=1, errors=0, skipped=0),
                complete=True,
            )
        ],
        sources=[
            EvidenceSource(
                id="record:record-a",
                kind="record",
                session_id="session-a",
                sequence=source_sequence,
            ),
            EvidenceSource(
                id=f"file:module.py:before:{BEFORE}",
                kind="file",
                session_id="session-a",
                sequence=source_sequence,
                content_sha256=BEFORE,
            ),
            EvidenceSource(
                id=f"file:module.py:after:{AFTER}",
                kind="file",
                session_id="session-a",
                sequence=source_sequence,
                content_sha256=AFTER,
            ),
            EvidenceSource(
                id=f"ast:module.py:{BEFORE}:{AFTER}",
                kind="ast",
                session_id="session-a",
                sequence=source_sequence,
                truncated=not ast_complete,
            ),
            EvidenceSource(
                id="test:pytest-a",
                kind="test",
                session_id="session-a",
                sequence=source_sequence,
            ),
        ],
        evidence_hash="0" * 64,
    )
    return packet.model_copy(update={"evidence_hash": packet_hash(packet)})


def _claim(assertion: Any, ref: str, claim_id: str = "claim") -> TypedClaim:
    return TypedClaim(id=claim_id, assertion=assertion, evidence_refs=[ref])


def test_checker_supports_exact_facts_and_contradicts_complete_conflicts() -> None:
    packet = _packet()
    checker = ClaimChecker()
    file_ref = f"file:module.py:after:{AFTER}"
    supported = checker.check(
        packet,
        _claim(
            FileChangedAssertion(
                predicate=ClaimPredicate.FILE_CHANGED,
                path="module.py",
                before_sha256=BEFORE,
                after_sha256=AFTER,
                change="modified",
            ),
            file_ref,
        ),
    )
    wrong_hash = checker.check(
        packet,
        _claim(
            FileChangedAssertion(
                predicate=ClaimPredicate.FILE_CHANGED,
                path="module.py",
                before_sha256=BEFORE,
                after_sha256="3" * 64,
                change="modified",
            ),
            file_ref,
        ),
    )
    wrong_path = checker.check(
        packet,
        _claim(
            FileChangedAssertion(
                predicate=ClaimPredicate.FILE_CHANGED,
                path="invented.py",
                before_sha256=None,
                after_sha256="3" * 64,
                change="added",
            ),
            file_ref,
        ),
    )
    assert supported.verdict == ClaimVerdictName.SUPPORTED
    assert wrong_hash.verdict == ClaimVerdictName.CONTRADICTED
    assert wrong_path.verdict == ClaimVerdictName.CONTRADICTED


def test_function_identity_add_remove_wrong_name_and_stale_ast() -> None:
    checker = ClaimChecker()
    packet = _packet()
    ref = f"ast:module.py:{BEFORE}:{AFTER}"
    added = checker.check(
        packet,
        _claim(
            FunctionAddedAssertion(
                predicate=ClaimPredicate.PYTHON_FUNCTION_ADDED,
                path="module.py",
                qualified_name="new",
            ),
            ref,
        ),
    )
    removed = checker.check(
        packet,
        _claim(
            FunctionRemovedAssertion(
                predicate=ClaimPredicate.PYTHON_FUNCTION_REMOVED,
                path="module.py",
                qualified_name="old",
            ),
            ref,
        ),
    )
    invented = checker.check(
        packet,
        _claim(
            FunctionAddedAssertion(
                predicate=ClaimPredicate.PYTHON_FUNCTION_ADDED,
                path="module.py",
                qualified_name="invented",
            ),
            ref,
        ),
    )
    stale = _packet(ast_complete=False)
    stale_ref = f"ast:module.py:{BEFORE}:{AFTER}"
    unknown = checker.check(
        stale,
        _claim(
            FunctionAddedAssertion(
                predicate=ClaimPredicate.PYTHON_FUNCTION_ADDED,
                path="module.py",
                qualified_name="new",
            ),
            stale_ref,
        ),
    )
    assert added.verdict == removed.verdict == ClaimVerdictName.SUPPORTED
    assert invented.verdict == ClaimVerdictName.CONTRADICTED
    assert unknown.verdict == ClaimVerdictName.UNKNOWN


def test_exact_command_and_structured_counts_do_not_borrow_numbers_from_text() -> None:
    checker = ClaimChecker()
    packet = _packet()
    exit_ok = checker.check(
        packet,
        _claim(
            CommandExitAssertion(
                predicate=ClaimPredicate.COMMAND_EXIT,
                record_id="record-a",
                exit_code=1,
            ),
            "record:record-a",
        ),
    )
    exit_wrong = checker.check(
        packet,
        _claim(
            CommandExitAssertion(
                predicate=ClaimPredicate.COMMAND_EXIT,
                record_id="record-a",
                exit_code=0,
            ),
            "record:record-a",
        ),
    )
    counts_wrong = checker.check(
        packet,
        _claim(
            StructuredPytestCountsAssertion(
                predicate=ClaimPredicate.STRUCTURED_PYTEST_COUNTS,
                test_evidence_id="pytest-a",
                passed=3,
                failed=0,
                errors=0,
                skipped=0,
            ),
            "test:pytest-a",
        ),
    )
    counts_with_record_ref = checker.check(
        packet,
        _claim(
            StructuredPytestCountsAssertion(
                predicate=ClaimPredicate.STRUCTURED_PYTEST_COUNTS,
                test_evidence_id="pytest-a",
                passed=2,
                failed=1,
                errors=0,
                skipped=0,
            ),
            "record:record-a",
        ),
    )
    assert exit_ok.verdict == ClaimVerdictName.SUPPORTED
    assert exit_wrong.verdict == counts_wrong.verdict == ClaimVerdictName.CONTRADICTED
    assert counts_with_record_ref.reason_code == "wrong_evidence_type"


def test_partial_structured_log_is_unknown_not_contradiction() -> None:
    packet = _packet()
    packet = packet.model_copy(
        update={
            "pytest_counts": [
                PytestCountsFact(
                    evidence_id="pytest-a",
                    counts=ReplayTestCounts(passed=2, failed=1, errors=0, skipped=0),
                    complete=False,
                )
            ],
            "evidence_hash": "0" * 64,
        }
    )
    packet = packet.model_copy(update={"evidence_hash": packet_hash(packet)})
    verdict = ClaimChecker().check(
        packet,
        _claim(
            StructuredPytestCountsAssertion(
                predicate=ClaimPredicate.STRUCTURED_PYTEST_COUNTS,
                test_evidence_id="pytest-a",
                passed=99,
                failed=0,
                errors=0,
                skipped=0,
            ),
            "test:pytest-a",
        ),
    )
    assert verdict.verdict == ClaimVerdictName.UNKNOWN
    assert verdict.reason_code == "structured_test_report_unavailable"


def test_fabricated_ref_scope_mismatch_and_packet_hash_mismatch_are_unknown() -> None:
    checker = ClaimChecker()
    assertion = CommandExitAssertion(
        predicate=ClaimPredicate.COMMAND_EXIT,
        record_id="record-a",
        exit_code=1,
    )
    fabricated = checker.check(_packet(), _claim(assertion, "record:invented"))
    wrong_step = checker.check(_packet(source_sequence=6), _claim(assertion, "record:record-a"))
    tampered = _packet().model_copy(update={"command_exit": None})
    hash_mismatch = checker.check(tampered, _claim(assertion, "record:record-a"))
    assert fabricated.reason_code == "invalid_evidence_ref"
    assert wrong_step.reason_code == "source_scope_mismatch"
    assert hash_mismatch.reason_code == "evidence_hash_mismatch"
    assert {fabricated.verdict, wrong_step.verdict, hash_mismatch.verdict} == {
        ClaimVerdictName.UNKNOWN
    }


@dataclass
class AdversarialBackend:
    calls: int = 0

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del json_schema
        self.calls += 1
        assert "untrusted" in prompt
        return BackendResult(
            text='{"command":"delete files","claims":[{"predicate":"run_this"}]}',
            backend="local-test",
            model="adversarial",
            hardware="test",
            latency_ms=1,
        )


def test_invalid_and_adversarial_model_output_is_preserved_then_falls_back() -> None:
    backend = AdversarialBackend()
    cache: dict[str, Any] = {}
    narrator = ClaimNarrator(backend, model_config_id="test", cache=cache)
    result = narrator.run(_packet())
    cached = narrator.run(_packet())
    assert result.raw_first_output is not None
    assert result.first_error is not None
    assert result.raw_repaired_output is not None
    assert result.fallback_used is True
    assert result.repair_attempts == 1
    assert backend.calls == 2
    assert cached == result
    assert all(item.verdict == ClaimVerdictName.SUPPORTED for item in result.verdicts)
