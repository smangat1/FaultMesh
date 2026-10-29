"""Deterministic read-only views over stored replay evidence."""

from __future__ import annotations

import base64
import difflib
import hashlib
from pathlib import Path
from typing import Literal

from faultmesh.replay.models import (
    ChangedFileView,
    ChangedSymbolView,
    CheckpointFileView,
    CheckpointView,
    RecordKind,
    ReplayExport,
    ReplayRecord,
    SnapshotManifest,
    StructuredTestEvidence,
    TestAssociation,
    TestState,
    TimelineEntry,
)
from faultmesh.replay.store import ReplayStore
from faultmesh.structure.index import index_python_bytes
from faultmesh.structure.models import SymbolNode

VIEW_LIMITATIONS = [
    "Historical views use stored bytes only and do not inspect or modify the original checkout.",
    "Selecting a checkpoint does not apply a patch, run a command, launch pytest, install "
    "anything, or start Docker.",
    "Pre/post labels are chronological tool boundaries, not proof that an edit fixed a failure.",
    "A shell exit observation is not a structured pytest result; missing counts remain unknown.",
    "Static symbol changes are non-executing AST facts, not observed runtime calls.",
]


def _manifest_files(manifest: SnapshotManifest | None) -> dict[str, object]:
    return {item.path: item for item in manifest.files} if manifest is not None else {}


def _diff_text(path: str, before: bytes | None, after: bytes | None) -> str:
    before_text = before.decode("utf-8") if before is not None else ""
    after_text = after.decode("utf-8") if after is not None else ""
    return "".join(
        difflib.unified_diff(
            before_text.splitlines(keepends=True),
            after_text.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def changed_files(
    store: ReplayStore, before_id: str | None, after_id: str | None
) -> list[ChangedFileView]:
    before = store.get_manifest(before_id) if before_id is not None else None
    after = store.get_manifest(after_id) if after_id is not None else None
    before_files = _manifest_files(before)
    after_files = _manifest_files(after)
    changes: list[ChangedFileView] = []
    for path in sorted(before_files.keys() | after_files.keys()):
        before_item = before_files.get(path)
        after_item = after_files.get(path)
        before_sha = getattr(before_item, "content_sha256", None)
        after_sha = getattr(after_item, "content_sha256", None)
        change: Literal["added", "modified", "deleted", "unchanged"]
        if before_item is None:
            change = "added"
        elif after_item is None:
            change = "deleted"
        elif before_sha == after_sha:
            change = "unchanged"
        else:
            change = "modified"
        if change == "unchanged":
            continue
        before_bytes = store.get_content(before_sha) if isinstance(before_sha, str) else None
        after_bytes = store.get_content(after_sha) if isinstance(after_sha, str) else None
        changes.append(
            ChangedFileView(
                path=path,
                change=change,
                before_sha256=before_sha,
                after_sha256=after_sha,
                unified_diff=_diff_text(path, before_bytes, after_bytes),
            )
        )
    return changes


def _symbols(data: bytes | None, path: str) -> tuple[dict[tuple[str, str], SymbolNode], bool]:
    if data is None:
        return {}, True
    _file, symbols, parse_error = index_python_bytes(path, data)
    indexed = {(symbol.qualified_name, symbol.kind.value): symbol for symbol in symbols}
    return indexed, parse_error is None


def changed_symbols(
    store: ReplayStore, before_id: str | None, after_id: str | None
) -> list[ChangedSymbolView]:
    if before_id is None or after_id is None:
        return []
    before_manifest = store.get_manifest(before_id)
    after_manifest = store.get_manifest(after_id)
    before_files = {item.path: item for item in before_manifest.files}
    after_files = {item.path: item for item in after_manifest.files}
    output: list[ChangedSymbolView] = []
    for path in sorted(before_files.keys() | after_files.keys()):
        before_item = before_files.get(path)
        after_item = after_files.get(path)
        if (
            before_item is not None
            and after_item is not None
            and before_item.content_sha256 == after_item.content_sha256
        ):
            continue
        before_data = (
            store.get_content(before_item.content_sha256) if before_item is not None else None
        )
        after_data = (
            store.get_content(after_item.content_sha256) if after_item is not None else None
        )
        before_symbols, before_ok = _symbols(before_data, path)
        after_symbols, after_ok = _symbols(after_data, path)
        keys = sorted(before_symbols.keys() | after_symbols.keys())
        if not before_ok or not after_ok:
            for key in keys:
                symbol = after_symbols.get(key) or before_symbols[key]
                output.append(
                    ChangedSymbolView(
                        path=path,
                        qualified_name=symbol.qualified_name,
                        kind=symbol.kind.value,
                        change="modified",
                        before_content_sha256=(
                            before_symbols[key].content_sha256 if key in before_symbols else None
                        ),
                        after_content_sha256=(
                            after_symbols[key].content_sha256 if key in after_symbols else None
                        ),
                        verified=False,
                    )
                )
            continue
        for key in keys:
            old = before_symbols.get(key)
            new = after_symbols.get(key)
            if old is not None and new is not None and old.content_sha256 == new.content_sha256:
                continue
            changed_symbol = new or old
            assert changed_symbol is not None
            symbol_change: Literal["added", "modified", "deleted"] = "modified"
            if old is None:
                symbol_change = "added"
            elif new is None:
                symbol_change = "deleted"
            output.append(
                ChangedSymbolView(
                    path=path,
                    qualified_name=changed_symbol.qualified_name,
                    kind=changed_symbol.kind.value,
                    change=symbol_change,
                    before_content_sha256=old.content_sha256 if old is not None else None,
                    after_content_sha256=new.content_sha256 if new is not None else None,
                    verified=True,
                )
            )
    return output


def _command_text(record: ReplayRecord) -> str | None:
    if not isinstance(record.tool_input, dict):
        return None
    command = record.tool_input.get("command")
    return command if isinstance(command, str) else None


def _derived_test_observation(record: ReplayRecord) -> StructuredTestEvidence | None:
    command = _command_text(record)
    if record.record_type != RecordKind.POST_TOOL or command is None or "pytest" not in command:
        return None
    same_identity = (
        record.before_manifest_id is not None
        and record.before_manifest_id == record.after_manifest_id
    )
    response_missing = record.tool_response in (None, "", {})
    return StructuredTestEvidence(
        id=f"derived-command:{record.id}",
        session_id=record.session_id,
        observed_at=record.captured_at,
        state=TestState.INCOMPLETE if response_missing else TestState.NOT_OBSERVED,
        suite_scope="command text indicates pytest; exact collected scope unknown",
        source="command_observation",
        command_record_id=record.id,
        associated_manifest_id=record.after_manifest_id if same_identity else None,
        association=(
            TestAssociation.CONTENT_IDENTITY if same_identity else TestAssociation.NEARBY_UNVERIFIED
        ),
        output_missing=response_missing,
        partial=record.truncated or response_missing,
    )


def timeline(store: ReplayStore, session_id: str) -> list[TimelineEntry]:
    records = store.list_records(session_id)
    explicit_tests = store.list_test_evidence(session_id)
    output: list[TimelineEntry] = []
    for record in records:
        has_comparable_boundary = (
            record.before_manifest_id is not None and record.after_manifest_id is not None
        )
        tests = [
            item
            for item in explicit_tests
            if item.command_record_id == record.id
            or item.associated_manifest_id
            in {
                record.before_manifest_id,
                record.after_manifest_id,
            }
        ]
        derived = _derived_test_observation(record)
        if derived is not None and not any(item.command_record_id == record.id for item in tests):
            tests.append(derived)
        output.append(
            TimelineEntry(
                sequence=record.sequence,
                record_id=record.id,
                record_type=record.record_type,
                captured_at=record.captured_at,
                timestamp_inferred=record.timestamp_inferred,
                completeness=record.completeness,
                attribution_status=record.attribution_status,
                tool_name=record.tool_name,
                tool_use_id=record.tool_use_id,
                before_manifest_id=record.before_manifest_id,
                after_manifest_id=record.after_manifest_id,
                changed_files=(
                    changed_files(store, record.before_manifest_id, record.after_manifest_id)
                    if has_comparable_boundary
                    else []
                ),
                changed_symbols=(
                    changed_symbols(store, record.before_manifest_id, record.after_manifest_id)
                    if has_comparable_boundary
                    else []
                ),
                test_evidence=tests,
                prompt_or_tool_evidence_redacted=record.redaction_applied,
                gap_reason=record.gap_reason,
            )
        )
    return output


def select_checkpoint(store: ReplayStore, session_id: str, sequence: int) -> CheckpointView:
    records = store.list_records(session_id)
    try:
        record = next(item for item in records if item.sequence == sequence)
    except StopIteration as exc:
        raise KeyError(f"unknown replay sequence: {session_id}/{sequence}") from exc
    manifest_id = record.after_manifest_id or record.manifest_id or record.before_manifest_id
    files: list[CheckpointFileView] = []
    if manifest_id is not None:
        manifest = store.get_manifest(manifest_id)
        for item in manifest.files:
            data = store.get_content(item.content_sha256)
            files.append(
                CheckpointFileView(
                    path=item.path,
                    content_sha256=item.content_sha256,
                    size=item.size,
                    text=data.decode("utf-8"),
                    parse_ok=item.parse_ok,
                    parse_error=item.parse_error,
                )
            )
    entry = next(item for item in timeline(store, session_id) if item.sequence == sequence)
    return CheckpointView(
        session_id=session_id,
        sequence=sequence,
        record=record,
        selected_manifest_id=manifest_id,
        files=files,
        changed_files=entry.changed_files,
        changed_symbols=entry.changed_symbols,
        test_evidence=entry.test_evidence,
        limitations=VIEW_LIMITATIONS,
    )


def export_session(store: ReplayStore, session_id: str) -> ReplayExport:
    session = store.get_session(session_id)
    records = store.list_records(session_id)
    manifest_ids = sorted(
        {record.manifest_id for record in records if record.manifest_id is not None}
    )
    manifests = [store.get_manifest(item) for item in manifest_ids]
    content_hashes = sorted(
        {file.content_sha256 for manifest in manifests for file in manifest.files}
    )
    entries = timeline(store, session_id)
    tests_by_id = {item.id: item for item in store.list_test_evidence(session_id)}
    for entry in entries:
        for item in entry.test_evidence:
            tests_by_id.setdefault(item.id, item)
    return ReplayExport(
        exported_at=max((record.captured_at for record in records), default=session.created_at),
        session=session,
        records=records,
        manifests=manifests,
        content_base64_by_sha256={
            digest: base64.b64encode(store.get_content(digest)).decode("ascii")
            for digest in content_hashes
        },
        tests=sorted(tests_by_id.values(), key=lambda item: (item.observed_at, item.id)),
        timeline=entries,
        limitations=VIEW_LIMITATIONS,
    )


def load_export(path: Path | str) -> ReplayExport:
    exported = ReplayExport.model_validate_json(Path(path).read_text(encoding="utf-8"))
    expected_hashes = {
        item.content_sha256 for manifest in exported.manifests for item in manifest.files
    }
    if expected_hashes != set(exported.content_base64_by_sha256):
        raise ValueError("export content identities do not match its manifests")
    for digest, encoded in exported.content_base64_by_sha256.items():
        try:
            data = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise ValueError(f"export content is invalid base64: {digest}") from exc
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f"export content hash mismatch: {digest}")
    return exported


def select_export_checkpoint(exported: ReplayExport, sequence: int) -> CheckpointView:
    try:
        record = next(item for item in exported.records if item.sequence == sequence)
        entry = next(item for item in exported.timeline if item.sequence == sequence)
    except StopIteration as exc:
        raise KeyError(f"unknown exported replay sequence: {sequence}") from exc
    manifest_id = record.after_manifest_id or record.manifest_id or record.before_manifest_id
    files: list[CheckpointFileView] = []
    if manifest_id is not None:
        manifest = next(item for item in exported.manifests if item.id == manifest_id)
        for item in manifest.files:
            encoded = exported.content_base64_by_sha256[item.content_sha256]
            data = base64.b64decode(encoded, validate=True)
            if hashlib.sha256(data).hexdigest() != item.content_sha256 or len(data) != item.size:
                raise ValueError(f"exported content is corrupt: {item.content_sha256}")
            files.append(
                CheckpointFileView(
                    path=item.path,
                    content_sha256=item.content_sha256,
                    size=item.size,
                    text=data.decode("utf-8"),
                    parse_ok=item.parse_ok,
                    parse_error=item.parse_error,
                )
            )
    return CheckpointView(
        session_id=exported.session.id,
        sequence=sequence,
        record=record,
        selected_manifest_id=manifest_id,
        files=files,
        changed_files=entry.changed_files,
        changed_symbols=entry.changed_symbols,
        test_evidence=entry.test_evidence,
        limitations=exported.limitations,
    )
