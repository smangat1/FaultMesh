"""Restart-safe ingestion of the frozen replay-capture NDJSON contract."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from faultmesh.replay.models import CAPTURE_SCHEMA_VERSION, CaptureEnvelope
from faultmesh.replay.store import ReplayStore, ReplayStoreError


@dataclass(frozen=True)
class IngestResult:
    ingested: int
    duplicates: int
    gaps: int
    unsupported: int
    next_offset: int
    partial_tail: bool
    generation: int


def ingest_jsonl(
    store: ReplayStore,
    session_id: str,
    path: Path | str,
    *,
    source_name: str | None = None,
    max_read_bytes: int = 16 * 1024 * 1024,
) -> IngestResult:
    source = Path(path).resolve(strict=True)
    if not source.is_file():
        raise ReplayStoreError("capture source must be a regular file")
    stat = source.stat()
    name = source_name or source.name
    cursor = store.get_cursor(session_id, name)
    generation = int(cursor["generation"]) if cursor is not None else 0
    offset = int(cursor["offset"]) if cursor is not None else 0
    last_sequence = (
        int(cursor["last_source_sequence"])
        if cursor is not None and cursor["last_source_sequence"] is not None
        else None
    )
    rotated = cursor is not None and (
        int(cursor["device"]) != stat.st_dev
        or int(cursor["inode"]) != stat.st_ino
        or stat.st_size < offset
    )
    gaps = 0
    if rotated:
        generation += 1
        store.append_gap(
            session_id,
            source_identity=f"jsonl:{name}:rotation:g{generation}",
            source_offset=0,
            reason="source_rotated_or_truncated",
            provenance="capture_jsonl",
        )
        offset = 0
        last_sequence = None
        gaps += 1
    with source.open("rb") as handle:
        handle.seek(offset)
        data = handle.read(max_read_bytes + 1)
    if len(data) > max_read_bytes:
        raise ReplayStoreError("capture source read exceeds configured ingestion bound")
    lines = data.splitlines(keepends=True)
    partial_tail = bool(lines and not lines[-1].endswith(b"\n"))
    complete_lines = lines[:-1] if partial_tail else lines
    ingested = 0
    duplicates = 0
    unsupported = 0
    current_offset = offset
    identity = f"jsonl:{name}:g{generation}"
    for raw_line in complete_lines:
        line_offset = current_offset
        current_offset += len(raw_line)
        try:
            decoded = raw_line.decode("utf-8")
            value = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            store.append_gap(
                session_id,
                source_identity=f"{identity}:corrupt",
                source_offset=line_offset,
                reason="corrupt_jsonl_record",
                provenance="capture_jsonl",
            )
            gaps += 1
            continue
        if not isinstance(value, dict):
            store.append_gap(
                session_id,
                source_identity=f"{identity}:unsupported",
                source_offset=line_offset,
                reason="capture_record_is_not_an_object",
                provenance="capture_jsonl",
                unsupported=True,
            )
            unsupported += 1
            continue
        schema_version = value.get("schema_version")
        if schema_version != CAPTURE_SCHEMA_VERSION:
            raise ReplayStoreError(f"unsupported capture schema: {schema_version!r}")
        try:
            envelope = CaptureEnvelope.model_validate(value)
        except ValidationError as exc:
            record_type = value.get("record_type")
            if isinstance(record_type, str) and "record_type" in str(exc):
                store.append_gap(
                    session_id,
                    source_identity=f"{identity}:unsupported",
                    source_offset=line_offset,
                    reason=f"unsupported_record_type:{record_type}",
                    provenance="capture_jsonl",
                    unsupported=True,
                )
                unsupported += 1
                continue
            store.append_gap(
                session_id,
                source_identity=f"{identity}:invalid",
                source_offset=line_offset,
                reason="invalid_capture_record",
                provenance="capture_jsonl",
            )
            gaps += 1
            continue
        if envelope.session_id != session_id:
            raise ReplayStoreError("capture record belongs to a different replay session")
        if envelope.source_sequence is not None and last_sequence is not None:
            if envelope.source_sequence > last_sequence + 1:
                store.append_gap(
                    session_id,
                    source_identity=f"{identity}:sequence-gap",
                    source_offset=line_offset,
                    reason=(
                        f"source_sequence_gap:{last_sequence + 1}-"
                        f"{envelope.source_sequence - 1}"
                    ),
                    provenance="capture_jsonl",
                    source_sequence=last_sequence + 1,
                )
                gaps += 1
            elif envelope.source_sequence <= last_sequence:
                store.append_gap(
                    session_id,
                    source_identity=f"{identity}:sequence-regression",
                    source_offset=line_offset,
                    reason="source_sequence_regression_or_duplicate",
                    provenance="capture_jsonl",
                    source_sequence=envelope.source_sequence,
                )
                gaps += 1
        before = len(store.list_records(session_id))
        try:
            store.add_envelope(
                envelope,
                source_identity=identity,
                source_offset=line_offset,
                provenance="capture_jsonl",
            )
        except ReplayStoreError as exc:
            reason = str(exc)
            if reason in {
                "capture root does not match the selected session root",
                "capture Codex version does not match the selected adapter",
            }:
                store.append_gap(
                    session_id,
                    source_identity=f"{identity}:mismatch",
                    source_offset=line_offset,
                    reason=reason.replace(" ", "_"),
                    provenance="capture_jsonl",
                )
                gaps += 1
                continue
            raise
        after = len(store.list_records(session_id))
        if after == before:
            duplicates += 1
        else:
            ingested += 1
        if envelope.source_sequence is not None:
            last_sequence = envelope.source_sequence
    store.set_cursor(
        session_id,
        name,
        generation=generation,
        device=stat.st_dev,
        inode=stat.st_ino,
        offset=current_offset,
        last_source_sequence=last_sequence,
    )
    return IngestResult(
        ingested=ingested,
        duplicates=duplicates,
        gaps=gaps,
        unsupported=unsupported,
        next_offset=current_offset,
        partial_tail=partial_tail,
        generation=generation,
    )
