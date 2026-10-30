from __future__ import annotations

import difflib
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from faultmesh.replay.citations import CitationSourceKind, citation_sources
from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimPredicate,
    ClaimVerdictName,
    baseline_claims,
    build_evidence_packet,
)
from faultmesh.replay.history_import import _build_export
from faultmesh.replay.history_reconstruction import reconstruct_history_file_state
from faultmesh.replay.models import (
    AttributionStatus,
    CaptureLimits,
    ChangedFileView,
    Completeness,
    ImportSource,
    RecordKind,
    ReplayExport,
    ReplayRecord,
    ReplaySession,
    SessionStatus,
    TimelineEntry,
)


def _diff(path: str, before: str, after: str) -> str:
    return "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def _record(
    sequence: int,
    *,
    patch: str | None = None,
    command: str | None = None,
    prompt: str | None = None,
    tool_name: str = "FileChange",
    response: object | None = None,
) -> ReplayRecord:
    return ReplayRecord(
        id=f"synthetic-record-{sequence}",
        session_id="synthetic-phase2",
        sequence=sequence,
        source_identity="synthetic-source",
        source_offset=sequence,
        source_sequence=sequence,
        record_type=RecordKind.CHECKPOINT if prompt is not None else RecordKind.POST_TOOL,
        captured_at=datetime(2026, 10, 29, 12, sequence, tzinfo=UTC),
        provenance="synthetic_history_import",
        completeness=Completeness.PARTIAL,
        attribution_status=AttributionStatus.UNKNOWN,
        tool_name=tool_name,
        prompt_text=prompt,
        tool_response=response,
        file_state="unknown" if patch or command else None,
        edit_patch=patch,
        edit_command=command,
    )


def _session() -> ReplaySession:
    return ReplaySession(
        id="synthetic-phase2",
        created_at=datetime(2026, 10, 29, 12, 0, tzinfo=UTC),
        stopped_at=datetime(2026, 10, 29, 12, 59, tzinfo=UTC),
        status=SessionStatus.STOPPED,
        project_root_sha256="a" * 64,
        codex_version="synthetic",
        limits=CaptureLimits(),
        import_source=ImportSource.CODEX,
    )


def test_reconstructs_consecutive_updates_and_claim_checker_consumes_derived_state(
    tmp_path: Path,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    old = "def keep() -> int:\n    return 1\n"
    middle = old + "\ndef added() -> int:\n    return 2\n"
    latest = middle.replace("return 2", "return 3")
    source = project / "app.py"
    source.write_text(latest, encoding="utf-8")
    original_bytes = source.read_bytes()
    records = (
        _record(1, patch=f"*** update: app.py\n{_diff('app.py', old, middle)}"),
        _record(2, patch=f"*** update: app.py\n{_diff('app.py', middle, latest)}"),
    )

    exported = _build_export(_session(), records, project_root=project)

    assert exported.schema_version == "replay-export-1.1"
    first = exported.timeline[0].changed_files[0]
    second = exported.timeline[1].changed_files[0]
    assert (first.before_text, first.after_text) == (old, middle)
    assert (second.before_text, second.after_text) == (middle, latest)
    assert first.derived_from == "recorded_patch"
    assert first.reconstruction_label == "reconstructed from current checkout (unverified)"
    assert exported.records[0].file_state == "reconstructed_from_current_checkout_unverified"
    assert source.read_bytes() == original_bytes

    packet = build_evidence_packet(exported, 1)
    claims = baseline_claims(packet)
    checker = ClaimChecker()
    verdicts = {claim.assertion.predicate: checker.check(packet, claim) for claim in claims.claims}
    assert verdicts[ClaimPredicate.FILE_CHANGED].verdict is ClaimVerdictName.SUPPORTED
    assert verdicts[ClaimPredicate.PYTHON_FUNCTION_ADDED].verdict is ClaimVerdictName.SUPPORTED
    assert "derived patch reconstruction" in verdicts[ClaimPredicate.FILE_CHANGED].reason


def test_reconstructs_add_move_and_delete_from_synthetic_recorded_patches(
    tmp_path: Path,
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    added_text = "VALUE = 1\n"
    moved_text = "def moved() -> None:\n    pass\n"
    (project / "added.py").write_text(added_text, encoding="utf-8")
    (project / "new.py").write_text(moved_text, encoding="utf-8")
    deleted_text = "OLD = True\n"
    records = (
        _record(1, patch=f"*** add: added.py\n{_diff('added.py', '', added_text)}"),
        _record(2, patch="*** move: old.py\n*** move to: new.py"),
        _record(3, patch=f"*** delete: deleted.py\n{_diff('deleted.py', deleted_text, '')}"),
    )

    result = reconstruct_history_file_state(
        records,
        project,
        max_file_bytes=1024 * 1024,
    )

    added = result.changed_files_by_sequence[1][0]
    assert added.change == "added"
    assert added.before_text is None and added.after_text == added_text
    moved = result.changed_files_by_sequence[2]
    assert {(item.path, item.change) for item in moved} == {
        ("old.py", "deleted"),
        ("new.py", "added"),
    }
    assert all(
        item.file_state == "reconstructed_from_current_checkout_unverified"
        for item in moved
    )
    deleted = result.changed_files_by_sequence[3][0]
    assert deleted.change == "deleted"
    assert deleted.before_text == deleted_text and deleted.after_text is None


def test_unappliable_missing_and_command_only_changes_remain_unknown(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "mismatch.py").write_text("VALUE = 99\n", encoding="utf-8")
    mismatch_diff = _diff("mismatch.py", "VALUE = 0\n", "VALUE = 1\n")
    missing_diff = _diff("missing.py", "OLD = 1\n", "NEW = 1\n")
    records = (
        _record(
            1,
            patch=f"*** update: mismatch.py\n{mismatch_diff}",
        ),
        _record(
            2,
            patch=f"*** update: missing.py\n{missing_diff}",
        ),
        _record(
            3,
            command="python -c \"from pathlib import Path; Path('generated.py').write_text('x')\"",
            tool_name="Command",
        ),
    )

    result = reconstruct_history_file_state(records, project, max_file_bytes=1024 * 1024)

    for sequence in (1, 2, 3):
        changed = result.changed_files_by_sequence[sequence][0]
        assert changed.derived_from == "recorded_patch"
        assert changed.file_state == "unknown"
        assert changed.before_text is None and changed.after_text is None
    assert result.changed_files_by_sequence[3][0].path == "generated.py"


def test_unknown_write_command_blocks_reconstruction_of_earlier_patch(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "generated.py").write_text("VALUE = 1\n", encoding="utf-8")
    records = (
        _record(
            1,
            patch=(
                "*** update: generated.py\n"
                + _diff("generated.py", "VALUE = 0\n", "VALUE = 1\n")
            ),
        ),
        _record(
            2,
            command=(
                "python -c \"from pathlib import Path; "
                "Path('generated.py').write_text('VALUE = 1\\n')\""
            ),
            tool_name="Command",
        ),
    )

    result = reconstruct_history_file_state(records, project, max_file_bytes=1024 * 1024)

    assert result.changed_files_by_sequence[2][0].file_state == "unknown"
    assert result.changed_files_by_sequence[1][0].file_state == "unknown"


def test_exports_redacted_citation_ready_transcript_spans() -> None:
    records = (
        _record(1, prompt="Synthetic prompt with [redacted: secret]."),
        _record(
            2,
            tool_name="Narration",
            response={"text": "Synthetic agent message."},
        ),
        _record(
            3,
            tool_name="Command",
            response={"aggregatedOutput": "synthetic command output"},
        ),
    )
    records = tuple(
        record.model_copy(update={"redaction_applied": index == 0})
        for index, record in enumerate(records)
    )

    exported = _build_export(_session(), records)

    assert [span.kind for span in exported.transcript_spans] == [
        "prompt",
        "agent_message",
        "command_output",
    ]
    assert all(
        span.start_offset == 0 and span.end_offset == len(span.text)
        for span in exported.transcript_spans
    )
    assert exported.transcript_spans[0].redacted is True
    sources = citation_sources(exported, 3)
    assert [source.kind for source in sources[:3]] == [
        CitationSourceKind.USER_PROMPT,
        CitationSourceKind.AGENT_EXPLANATION,
        CitationSourceKind.PRIOR_EVENT,
    ]


def test_export_contract_rejects_derived_state_under_legacy_schema() -> None:
    changed = ChangedFileView(
        path="app.py",
        change="modified",
        derived_from="recorded_patch",
        file_state="unknown",
    )
    timeline = TimelineEntry(
        sequence=1,
        record_id="synthetic-record-1",
        record_type=RecordKind.POST_TOOL,
        captured_at=datetime(2026, 10, 29, 12, 1, tzinfo=UTC),
        completeness=Completeness.PARTIAL,
        attribution_status=AttributionStatus.UNKNOWN,
        changed_files=[changed],
    )
    with pytest.raises(ValidationError, match="require replay-export-1.1"):
        ReplayExport(
            schema_version="replay-export-1.0",
            exported_at=datetime(2026, 10, 29, 12, 1, tzinfo=UTC),
            session=_session(),
            records=[_record(1)],
            manifests=[],
            content_base64_by_sha256={},
            tests=[],
            timeline=[timeline],
            limitations=[],
        )
