"""Append-only SQLite metadata and content-addressed replay bytes."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import sqlite3
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

from pydantic import ValidationError

from faultmesh.replay.capture import CapturedSnapshot, capture_snapshot, root_identity
from faultmesh.replay.models import (
    AttributionStatus,
    CapturedFile,
    CaptureEnvelope,
    CaptureLimits,
    Completeness,
    RecordKind,
    ReplayRecord,
    ReplaySession,
    SessionStatus,
    SnapshotManifest,
)
from faultmesh.replay.privacy import redact_value
from faultmesh.structure.index import index_python_bytes

STORE_SCHEMA_VERSION = 1


class ReplayStoreError(RuntimeError):
    """A replay store is corrupt, incompatible, or violates its contract."""


def default_replay_root() -> Path:
    return Path.home() / ".faultmesh" / "replay"


def _now() -> datetime:
    return datetime.now(UTC)


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _manifest_id(
    files: list[CapturedFile], partial: bool, skipped_json: Sequence[object]
) -> str:
    value = {
        "files": [item.model_dump(mode="json") for item in files],
        "partial": partial,
        "skipped": skipped_json,
    }
    return f"manifest:{hashlib.sha256(_canonical_json(value).encode()).hexdigest()}"


class ReplayStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.objects = self.root / "objects"
        self.objects.mkdir(exist_ok=True)
        self._cleanup_temporary_objects()
        self.path = self.root / "replay.sqlite3"
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        try:
            self.connection.execute("PRAGMA foreign_keys = ON")
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.execute("PRAGMA synchronous = FULL")
            self._open_schema()
        except Exception:
            self.connection.close()
            raise

    def __enter__(self) -> ReplayStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def _open_schema(self) -> None:
        tables = {
            str(row["name"])
            for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        expected = {
            "schema_metadata",
            "sessions",
            "records",
            "manifests",
            "manifest_files",
            "structures",
            "ingestion_cursors",
        }
        if not tables:
            self._create_schema()
            return
        if tables != expected:
            raise ReplayStoreError("replay store schema is unsupported; choose a fresh store root")
        row = self.connection.execute("SELECT version FROM schema_metadata").fetchone()
        if row is None or int(row["version"]) != STORE_SCHEMA_VERSION:
            raise ReplayStoreError("replay store version is unsupported; choose a fresh store root")

    def _create_schema(self) -> None:
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            self.connection.execute("CREATE TABLE schema_metadata (version INTEGER NOT NULL)")
            self.connection.execute(
                "CREATE TABLE sessions ("
                "id TEXT PRIMARY KEY, created_at TEXT NOT NULL, stopped_at TEXT, "
                "status TEXT NOT NULL, project_root TEXT NOT NULL, "
                "project_root_sha256 TEXT NOT NULL, codex_version TEXT NOT NULL, "
                "raw_logging INTEGER NOT NULL, limits_json TEXT NOT NULL, "
                "record_json TEXT NOT NULL)"
            )
            self.connection.execute(
                "CREATE TABLE manifests ("
                "id TEXT PRIMARY KEY, created_at TEXT NOT NULL, partial INTEGER NOT NULL, "
                "manifest_json TEXT NOT NULL)"
            )
            self.connection.execute(
                "CREATE TABLE manifest_files ("
                "manifest_id TEXT NOT NULL REFERENCES manifests(id), path TEXT NOT NULL, "
                "content_sha256 TEXT NOT NULL, size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, "
                "parse_ok INTEGER NOT NULL, parse_error TEXT, "
                "PRIMARY KEY (manifest_id, path))"
            )
            self.connection.execute(
                "CREATE TABLE records ("
                "session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, "
                "sequence INTEGER NOT NULL, id TEXT NOT NULL, source_identity TEXT NOT NULL, "
                "source_offset INTEGER NOT NULL, source_sequence INTEGER, "
                "captured_at TEXT NOT NULL, "
                "manifest_id TEXT REFERENCES manifests(id), record_json TEXT NOT NULL, "
                "PRIMARY KEY (session_id, sequence), UNIQUE (session_id, id), "
                "UNIQUE (session_id, source_identity, source_offset))"
            )
            self.connection.execute(
                "CREATE TABLE structures ("
                "session_id TEXT NOT NULL, record_sequence INTEGER NOT NULL, path TEXT NOT NULL, "
                "current_content_sha256 TEXT NOT NULL, verified_content_sha256 TEXT, "
                "stale INTEGER NOT NULL, file_json TEXT NOT NULL, symbols_json TEXT NOT NULL, "
                "PRIMARY KEY (session_id, record_sequence, path), "
                "FOREIGN KEY (session_id, record_sequence) "
                "REFERENCES records(session_id, sequence) ON DELETE CASCADE)"
            )
            self.connection.execute(
                "CREATE TABLE ingestion_cursors ("
                "session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, "
                "source_name TEXT NOT NULL, generation INTEGER NOT NULL, device INTEGER NOT NULL, "
                "inode INTEGER NOT NULL, offset INTEGER NOT NULL, last_source_sequence INTEGER, "
                "PRIMARY KEY (session_id, source_name))"
            )
            self.connection.execute(
                "INSERT INTO schema_metadata VALUES (?)", (STORE_SCHEMA_VERSION,)
            )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    def _session_row(self, session_id: str) -> sqlite3.Row:
        row = self.connection.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown replay session: {session_id}")
        return cast(sqlite3.Row, row)

    def get_session(self, session_id: str) -> ReplaySession:
        row = self._session_row(session_id)
        return ReplaySession.model_validate_json(row["record_json"])

    def get_project_root(self, session_id: str) -> Path:
        return Path(str(self._session_row(session_id)["project_root"]))

    def list_sessions(self) -> list[ReplaySession]:
        rows = self.connection.execute(
            "SELECT record_json FROM sessions ORDER BY created_at, id"
        ).fetchall()
        return [ReplaySession.model_validate_json(row["record_json"]) for row in rows]

    def create_session(
        self,
        project_root: Path | str,
        *,
        codex_version: str,
        limits: CaptureLimits | None = None,
        raw_logging: bool = False,
        session_id: str | None = None,
    ) -> ReplaySession:
        root = Path(project_root).resolve(strict=True)
        if not root.is_dir():
            raise ReplayStoreError("selected replay root must be a directory")
        active_limits = limits or CaptureLimits()
        snapshot = capture_snapshot(root, active_limits)
        created_at = _now()
        identity = session_id or f"replay-{uuid4().hex[:16]}"
        session = ReplaySession(
            id=identity,
            created_at=created_at,
            status=SessionStatus.ACTIVE,
            project_root_sha256=root_identity(root),
            codex_version=codex_version,
            raw_logging=raw_logging,
            limits=active_limits,
        )
        try:
            with self.connection:
                self.connection.execute(
                    "INSERT INTO sessions VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        identity,
                        created_at.isoformat(),
                        SessionStatus.ACTIVE.value,
                        str(root),
                        session.project_root_sha256,
                        codex_version,
                        int(raw_logging),
                        active_limits.model_dump_json(),
                        session.model_dump_json(),
                    ),
                )
            envelope = self._snapshot_envelope(session, snapshot, RecordKind.INITIAL_SNAPSHOT)
            self.add_envelope(
                envelope,
                source_identity=f"session:{identity}:initial",
                source_offset=0,
                provenance="selected_root_snapshot",
            )
        except Exception:
            with self.connection:
                self.connection.execute("DELETE FROM sessions WHERE id = ?", (identity,))
            raise
        return session

    @staticmethod
    def _snapshot_envelope(
        session: ReplaySession, snapshot: CapturedSnapshot, kind: RecordKind
    ) -> CaptureEnvelope:
        return CaptureEnvelope(
            record_id=f"record-{uuid4().hex}",
            record_type=kind,
            captured_at=_now(),
            project_root_sha256=session.project_root_sha256,
            codex_version=session.codex_version,
            session_id=session.id,
            files=snapshot.payloads,
            skipped=snapshot.manifest.skipped,
            partial=snapshot.manifest.partial,
        )

    def stop_session(self, session_id: str) -> ReplaySession:
        session = self.get_session(session_id)
        if session.status == SessionStatus.STOPPED:
            return session
        stopped = session.model_copy(update={"status": SessionStatus.STOPPED, "stopped_at": _now()})
        with self.connection:
            self.connection.execute(
                "UPDATE sessions SET stopped_at = ?, status = ?, record_json = ? WHERE id = ?",
                (
                    stopped.stopped_at.isoformat() if stopped.stopped_at else None,
                    stopped.status.value,
                    stopped.model_dump_json(),
                    session_id,
                ),
            )
        return stopped

    def _object_path(self, digest: str) -> Path:
        return self.objects / digest[:2] / digest

    def _object_bytes_used(self) -> int:
        return sum(
            path.stat().st_size
            for directory in self.objects.iterdir()
            if directory.is_dir() and not directory.is_symlink()
            for path in directory.iterdir()
            if path.is_file() and not path.name.startswith(".")
        )

    def _cleanup_temporary_objects(self) -> None:
        for directory in self.objects.iterdir():
            if not directory.is_dir() or directory.is_symlink():
                continue
            for path in directory.iterdir():
                if path.is_file() and path.name.startswith(".") and path.name.endswith(".tmp"):
                    path.unlink()

    def _write_object(self, digest: str, data: bytes) -> None:
        path = self._object_path(digest)
        if path.exists():
            existing = path.read_bytes()
            if hashlib.sha256(existing).hexdigest() != digest or existing != data:
                raise ReplayStoreError(f"content object is corrupt: {digest}")
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def _decode_payloads(
        self, envelope: CaptureEnvelope, limits: CaptureLimits
    ) -> tuple[list[CapturedFile], dict[str, bytes]]:
        files: list[CapturedFile] = []
        contents: dict[str, bytes] = {}
        new_bytes = 0
        for payload in envelope.files:
            try:
                data = base64.b64decode(payload.content_base64, validate=True)
            except ValueError as exc:
                raise ReplayStoreError("capture payload contains invalid base64") from exc
            digest = hashlib.sha256(data).hexdigest()
            if digest != payload.content_sha256 or len(data) != payload.size:
                raise ReplayStoreError("capture payload hash or size mismatch")
            if payload.size > limits.max_file_bytes:
                raise ReplayStoreError("capture payload exceeds per-file limit")
            if payload.path in contents:
                raise ReplayStoreError("capture payload contains a duplicate path")
            try:
                data.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ReplayStoreError("capture payload is not bounded UTF-8 source") from exc
            file_node, _symbols, parse_error = index_python_bytes(payload.path, data)
            files.append(
                CapturedFile(
                    path=payload.path,
                    content_sha256=digest,
                    size=len(data),
                    mtime_ns=payload.mtime_ns,
                    parse_ok=parse_error is None,
                    parse_error=file_node.parse_error,
                )
            )
            contents[payload.path] = data
            if not self._object_path(digest).exists():
                new_bytes += len(data)
        if sum(len(value) for value in contents.values()) > limits.max_snapshot_bytes:
            raise ReplayStoreError("capture payload exceeds snapshot limit")
        if self._object_bytes_used() + new_bytes > limits.max_store_bytes:
            raise ReplayStoreError("capture payload exceeds selected store byte limit")
        return sorted(files, key=lambda item: item.path), contents

    def add_envelope(
        self,
        envelope: CaptureEnvelope,
        *,
        source_identity: str,
        source_offset: int,
        provenance: str,
    ) -> ReplayRecord:
        existing = self.connection.execute(
            "SELECT record_json FROM records "
            "WHERE session_id = ? AND source_identity = ? AND source_offset = ?",
            (envelope.session_id, source_identity, source_offset),
        ).fetchone()
        if existing is not None:
            return ReplayRecord.model_validate_json(existing["record_json"])
        session = self.get_session(envelope.session_id)
        if session.status != SessionStatus.ACTIVE:
            raise ReplayStoreError("replay session is stopped")
        if envelope.project_root_sha256 != session.project_root_sha256:
            raise ReplayStoreError("capture root does not match the selected session root")
        if envelope.codex_version != session.codex_version:
            raise ReplayStoreError("capture Codex version does not match the selected adapter")
        files, contents = self._decode_payloads(envelope, session.limits)
        manifest: SnapshotManifest | None = None
        if envelope.record_type not in {RecordKind.GAP, RecordKind.UNSUPPORTED}:
            skipped_json = [item.model_dump(mode="json") for item in envelope.skipped]
            manifest = SnapshotManifest(
                id=_manifest_id(files, envelope.partial, skipped_json),
                files=files,
                skipped=envelope.skipped,
                partial=envelope.partial,
            )
            for path, data in contents.items():
                digest = next(item.content_sha256 for item in files if item.path == path)
                self._write_object(digest, data)

        clean_input: object | None = envelope.raw_tool_input
        clean_response: object | None = envelope.raw_tool_response
        redacted = envelope.redaction_applied
        truncated = envelope.truncated
        if not session.raw_logging:
            clean_input, input_redacted, input_truncated = redact_value(
                clean_input, session.limits.max_text_field_bytes
            )
            clean_response, response_redacted, response_truncated = redact_value(
                clean_response, session.limits.max_text_field_bytes
            )
            redacted = redacted or input_redacted or response_redacted
            truncated = truncated or input_truncated or response_truncated

        try:
            self.connection.execute("BEGIN IMMEDIATE")
            duplicate = self.connection.execute(
                "SELECT record_json FROM records "
                "WHERE session_id = ? AND source_identity = ? AND source_offset = ?",
                (envelope.session_id, source_identity, source_offset),
            ).fetchone()
            if duplicate is not None:
                self.connection.rollback()
                return ReplayRecord.model_validate_json(duplicate["record_json"])
            if manifest is not None:
                self._insert_manifest(manifest)
            sequence_row = self.connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM records WHERE session_id = ?",
                (envelope.session_id,),
            ).fetchone()
            sequence = int(sequence_row["next"])
            before_manifest_id: str | None = None
            after_manifest_id: str | None = None
            attribution = AttributionStatus.UNKNOWN
            if envelope.record_type == RecordKind.INITIAL_SNAPSHOT:
                after_manifest_id = manifest.id if manifest else None
                attribution = AttributionStatus.NOT_APPLICABLE
            elif envelope.record_type == RecordKind.PRE_TOOL:
                before_manifest_id = manifest.id if manifest else None
                attribution = AttributionStatus.UNKNOWN
            elif envelope.record_type == RecordKind.POST_TOOL:
                after_manifest_id = manifest.id if manifest else None
                pre = self.connection.execute(
                    "SELECT record_json FROM records WHERE session_id = ? "
                    "ORDER BY sequence DESC",
                    (envelope.session_id,),
                ).fetchall()
                for row in pre:
                    candidate = ReplayRecord.model_validate_json(row["record_json"])
                    if (
                        candidate.record_type == RecordKind.PRE_TOOL
                        and candidate.tool_use_id == envelope.tool_use_id
                    ):
                        before_manifest_id = candidate.before_manifest_id
                        attribution = AttributionStatus.TOOL_BOUNDARY
                        break
            elif envelope.record_type == RecordKind.CHECKPOINT:
                after_manifest_id = manifest.id if manifest else None
                attribution = AttributionStatus.OBSERVED_CHECKPOINT
            elif envelope.record_type == RecordKind.GAP:
                attribution = AttributionStatus.UNKNOWN
            completeness = Completeness.COMPLETE
            if envelope.record_type == RecordKind.GAP:
                completeness = Completeness.MISSING
            elif envelope.record_type == RecordKind.UNSUPPORTED:
                completeness = Completeness.UNSUPPORTED
            elif envelope.partial or truncated:
                completeness = Completeness.PARTIAL
            record = ReplayRecord(
                id=envelope.record_id,
                session_id=envelope.session_id,
                sequence=sequence,
                source_identity=source_identity,
                source_offset=source_offset,
                source_sequence=envelope.source_sequence,
                record_type=envelope.record_type,
                captured_at=envelope.captured_at,
                source_timestamp=envelope.source_timestamp,
                provenance=provenance,
                completeness=completeness,
                attribution_status=attribution,
                turn_id=envelope.turn_id,
                tool_use_id=envelope.tool_use_id,
                tool_name=envelope.tool_name,
                checkpoint_id=manifest.id if manifest else None,
                manifest_id=manifest.id if manifest else None,
                before_manifest_id=before_manifest_id,
                after_manifest_id=after_manifest_id,
                partial=envelope.partial,
                truncated=truncated,
                redaction_applied=redacted,
                tool_input=clean_input,
                tool_response=clean_response,
                gap_reason=envelope.gap_reason,
            )
            self.connection.execute(
                "INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.session_id,
                    record.sequence,
                    record.id,
                    record.source_identity,
                    record.source_offset,
                    record.source_sequence,
                    record.captured_at.isoformat(),
                    record.manifest_id,
                    record.model_dump_json(),
                ),
            )
            if manifest is not None:
                self._insert_structures(record, manifest, contents)
            self.connection.commit()
            return record
        except sqlite3.IntegrityError as exc:
            self.connection.rollback()
            raise ReplayStoreError(
                "capture record identity already exists with different source"
            ) from exc
        except Exception:
            self.connection.rollback()
            raise

    def _insert_manifest(self, manifest: SnapshotManifest) -> None:
        existing = self.connection.execute(
            "SELECT manifest_json FROM manifests WHERE id = ?", (manifest.id,)
        ).fetchone()
        if existing is not None:
            try:
                stored = SnapshotManifest.model_validate_json(existing["manifest_json"])
            except ValidationError as exc:
                raise ReplayStoreError("stored manifest is corrupt") from exc
            if stored != manifest:
                raise ReplayStoreError("manifest identity collision")
            return
        self.connection.execute(
            "INSERT INTO manifests VALUES (?, ?, ?, ?)",
            (manifest.id, _now().isoformat(), int(manifest.partial), manifest.model_dump_json()),
        )
        self.connection.executemany(
            "INSERT INTO manifest_files VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    manifest.id,
                    item.path,
                    item.content_sha256,
                    item.size,
                    item.mtime_ns,
                    int(item.parse_ok),
                    item.parse_error,
                )
                for item in manifest.files
            ],
        )

    def _insert_structures(
        self, record: ReplayRecord, manifest: SnapshotManifest, contents: dict[str, bytes]
    ) -> None:
        for item in manifest.files:
            data = contents[item.path]
            file_node, symbols, parse_error = index_python_bytes(item.path, data)
            stale = parse_error is not None
            verified_hash: str | None = item.content_sha256 if not stale else None
            file_json = file_node.model_dump_json()
            symbols_json = json.dumps(
                [symbol.model_dump(mode="json") for symbol in symbols], sort_keys=True
            )
            if stale:
                previous = self.connection.execute(
                    "SELECT file_json, symbols_json, verified_content_sha256 FROM structures "
                    "WHERE session_id = ? AND path = ? AND stale = 0 "
                    "ORDER BY record_sequence DESC LIMIT 1",
                    (record.session_id, item.path),
                ).fetchone()
                if previous is not None:
                    file_json = str(previous["file_json"])
                    symbols_json = str(previous["symbols_json"])
                    verified_hash = str(previous["verified_content_sha256"])
            self.connection.execute(
                "INSERT INTO structures VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.session_id,
                    record.sequence,
                    item.path,
                    item.content_sha256,
                    verified_hash,
                    int(stale),
                    file_json,
                    symbols_json,
                ),
            )

    def append_gap(
        self,
        session_id: str,
        *,
        source_identity: str,
        source_offset: int,
        reason: str,
        provenance: str,
        unsupported: bool = False,
        source_sequence: int | None = None,
    ) -> ReplayRecord:
        session = self.get_session(session_id)
        envelope = CaptureEnvelope(
            record_id=f"record-{uuid4().hex}",
            record_type=RecordKind.UNSUPPORTED if unsupported else RecordKind.GAP,
            source_sequence=source_sequence,
            captured_at=_now(),
            project_root_sha256=session.project_root_sha256,
            codex_version=session.codex_version,
            session_id=session_id,
            gap_reason=reason,
            partial=True,
        )
        return self.add_envelope(
            envelope,
            source_identity=source_identity,
            source_offset=source_offset,
            provenance=provenance,
        )

    def list_records(self, session_id: str) -> list[ReplayRecord]:
        self._session_row(session_id)
        rows = self.connection.execute(
            "SELECT record_json FROM records WHERE session_id = ? ORDER BY sequence",
            (session_id,),
        ).fetchall()
        return [ReplayRecord.model_validate_json(row["record_json"]) for row in rows]

    def get_manifest(self, manifest_id: str) -> SnapshotManifest:
        row = self.connection.execute(
            "SELECT manifest_json FROM manifests WHERE id = ?", (manifest_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown replay manifest: {manifest_id}")
        return SnapshotManifest.model_validate_json(row["manifest_json"])

    def get_content(self, digest: str) -> bytes:
        path = self._object_path(digest)
        try:
            data = path.read_bytes()
        except FileNotFoundError as exc:
            raise ReplayStoreError(f"missing content object: {digest}") from exc
        if hashlib.sha256(data).hexdigest() != digest:
            raise ReplayStoreError(f"corrupt content object: {digest}")
        return data

    def validate(self) -> list[str]:
        errors: list[str] = []
        rows = self.connection.execute(
            "SELECT DISTINCT content_sha256, size FROM manifest_files ORDER BY content_sha256"
        ).fetchall()
        for row in rows:
            digest = str(row["content_sha256"])
            try:
                data = self.get_content(digest)
            except ReplayStoreError as exc:
                errors.append(str(exc))
                continue
            if len(data) != int(row["size"]):
                errors.append(f"content object size mismatch: {digest}")
        return errors

    def delete_session(self, session_id: str) -> None:
        self._session_row(session_id)
        with self.connection:
            self.connection.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            self.connection.execute(
                "DELETE FROM manifest_files WHERE manifest_id NOT IN "
                "(SELECT DISTINCT manifest_id FROM records WHERE manifest_id IS NOT NULL)"
            )
            self.connection.execute(
                "DELETE FROM manifests WHERE id NOT IN "
                "(SELECT DISTINCT manifest_id FROM records WHERE manifest_id IS NOT NULL)"
            )
        referenced = {
            str(row["content_sha256"])
            for row in self.connection.execute("SELECT DISTINCT content_sha256 FROM manifest_files")
        }
        for directory in self.objects.iterdir():
            if not directory.is_dir() or directory.is_symlink():
                continue
            for path in directory.iterdir():
                if path.is_file() and path.name not in referenced:
                    path.unlink()
            with contextlib.suppress(OSError):
                directory.rmdir()

    def get_cursor(self, session_id: str, source_name: str) -> sqlite3.Row | None:
        row = self.connection.execute(
            "SELECT * FROM ingestion_cursors WHERE session_id = ? AND source_name = ?",
            (session_id, source_name),
        ).fetchone()
        return cast(sqlite3.Row | None, row)

    def set_cursor(
        self,
        session_id: str,
        source_name: str,
        *,
        generation: int,
        device: int,
        inode: int,
        offset: int,
        last_source_sequence: int | None,
    ) -> None:
        with self.connection:
            self.connection.execute(
                "INSERT INTO ingestion_cursors VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(session_id, source_name) DO UPDATE SET "
                "generation=excluded.generation, device=excluded.device, inode=excluded.inode, "
                "offset=excluded.offset, last_source_sequence=excluded.last_source_sequence",
                (
                    session_id,
                    source_name,
                    generation,
                    device,
                    inode,
                    offset,
                    last_source_sequence,
                ),
            )
