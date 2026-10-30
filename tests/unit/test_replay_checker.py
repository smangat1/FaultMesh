from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimNarrator,
    ClaimPredicate,
    ClaimRunRecord,
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
    baseline_claims,
    build_evidence_packet,
    packet_hash,
    render_final_claims,
)
from faultmesh.replay.models import Completeness
from faultmesh.replay.models import TestCounts as ReplayTestCounts
from faultmesh.replay.narration import ModelExplanation
from faultmesh.replay.store import ReplayStore
from faultmesh.replay.views import export_session

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


def test_incomplete_real_manifest_record_file_changed_is_unknown(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    source = project / "module.py"
    source.write_text("VALUE = 1\n", encoding="utf-8")
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(project, codex_version="synthetic")
        source.write_text("VALUE = 2\n", encoding="utf-8")
        store.capture_checkpoint(session.id, provenance="synthetic")
        exported = export_session(store, session.id)
    target = exported.records[-1].model_copy(update={"completeness": Completeness.PARTIAL})
    exported = exported.model_copy(update={"records": [exported.records[0], target]})
    packet = build_evidence_packet(exported, target.sequence)
    claim = baseline_claims(packet).claims[0]

    verdict = ClaimChecker().check(packet, claim)

    assert verdict.verdict is ClaimVerdictName.UNKNOWN
    assert verdict.reason_code == "incomplete_record"


def test_derived_incomplete_state_never_green() -> None:
    packet = _packet().model_copy(
        update={
            "files": [
                FileState(
                    path="module.py",
                    before_sha256=BEFORE,
                    after_sha256=AFTER,
                    change="modified",
                    complete=False,
                    derived_from="recorded_patch",
                )
            ],
            "evidence_hash": "0" * 64,
        }
    )
    packet = packet.model_copy(update={"evidence_hash": packet_hash(packet)})
    verdict = ClaimChecker().check(
        packet,
        _claim(
            FileChangedAssertion(
                predicate=ClaimPredicate.FILE_CHANGED,
                path="module.py",
                before_sha256=BEFORE,
                after_sha256=AFTER,
                change="modified",
            ),
            f"file:module.py:after:{AFTER}",
        ),
    )
    assert verdict.verdict is ClaimVerdictName.UNKNOWN
    assert verdict.reason_code == "derived_file_state_unavailable"


def test_model_explanation_has_no_verdict_badge() -> None:
    explanation = ModelExplanation(text="This is a model interpretation of the recorded step.")
    assert explanation.label == "model interpretation"
    assert "verdict" not in explanation.model_dump()


def test_verdict_reports_evidence_source() -> None:
    packet = _packet()
    verdict = ClaimChecker().check(
        packet,
        _claim(
            FileChangedAssertion(
                predicate=ClaimPredicate.FILE_CHANGED,
                path="module.py",
                before_sha256=BEFORE,
                after_sha256=AFTER,
                change="modified",
            ),
            f"file:module.py:after:{AFTER}",
        ),
    )
    assert verdict.evidence_source == "rebuilt_file"


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
    assert result.final_source == "deterministic_fallback"
    assert result.final_claims.claims
    assert result.repair_attempts == 1
    assert backend.calls == 2
    assert cached == result
    assert all(item.verdict == ClaimVerdictName.SUPPORTED for item in result.verdicts)
    rendered = render_final_claims(result)
    assert [item.claim_id for item in rendered] == [
        claim.id for claim in result.final_claims.claims
    ]
    assert all(item.canonical_text for item in rendered)

    broken = result.model_dump(mode="json")
    broken["verdicts"][0]["claim_id"] = "unlinked-verdict"
    with pytest.raises(ValidationError, match="one-to-one ID mapping"):
        ClaimRunRecord.model_validate(broken)


@dataclass
class UnavailableBackend:
    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        raise RuntimeError("local model unavailable")


def test_backend_failure_still_persists_renderable_final_claim_batch() -> None:
    result = ClaimNarrator(UnavailableBackend(), model_config_id="missing").run(_packet())
    assert result.raw_first_output is None
    assert result.first_error == "local model unavailable"
    assert result.parsed_first_claims is None
    assert result.parsed_repaired_claims is None
    assert result.final_source == "deterministic_fallback"
    assert result.fallback_used is True
    assert len(render_final_claims(result)) == len(result.final_claims.claims)


@dataclass
class RepairingBackend:
    calls: int = 0

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        del prompt, json_schema
        self.calls += 1
        if self.calls == 1:
            text = "invalid first output"
        else:
            text = (
                '{"schema_version":"replay-claims-1.0","claims":[{'
                '"id":"repaired-file","assertion":{"predicate":"file_changed",'
                '"path":"module.py","before_sha256":"'
                + BEFORE
                + '","after_sha256":"'
                + AFTER
                + '","change":"modified"},"evidence_refs":["file:module.py:after:'
                + AFTER
                + '"]}]}'
            )
        return BackendResult(text, "test", "repair", "test", 1)


def test_successful_repair_is_the_persisted_final_batch() -> None:
    backend = RepairingBackend()
    result = ClaimNarrator(backend, model_config_id="repair").run(_packet())
    assert result.raw_first_output == "invalid first output"
    assert result.parsed_first_claims is None
    assert result.raw_repaired_output is not None
    assert result.parsed_repaired_claims is not None
    assert result.final_source == "repaired"
    assert result.final_claims == result.parsed_repaired_claims
    assert result.fallback_used is False
    assert render_final_claims(result)[0].verdict.verdict == ClaimVerdictName.SUPPORTED
