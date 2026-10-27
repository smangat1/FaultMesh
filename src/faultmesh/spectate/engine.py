"""Bounded, polling-based observation of stable Python source versions."""

from __future__ import annotations

import difflib
import fnmatch
import hashlib
import json
import os
import re
import signal
import stat
import sys
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from faultmesh.analysis.project import IGNORED_PARTS
from faultmesh.spectate.models import EVENT_ADAPTER, IgnoreSummary, Limits
from faultmesh.structure.index import index_python_bytes
from faultmesh.structure.models import FileNode, SkipRecord, SymbolNode

SECRET_PATTERNS = (".env*", "*.pem", "*.key", "id_rsa*", "credentials*")
_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class SpectateError(RuntimeError):
    """A safe, user-facing watcher setup error."""


@dataclass(frozen=True)
class StatKey:
    device: int
    inode: int
    size: int
    mtime_ns: int

    @classmethod
    def from_stat(cls, value: os.stat_result) -> StatKey:
        return cls(value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)


@dataclass(frozen=True)
class ReadResult:
    key: StatKey
    data: bytes


@dataclass
class FileState:
    path: str
    stat_key: StatKey
    data: bytes
    text: str | None
    sha256: str
    file_node: FileNode
    symbols: list[SymbolNode]
    last_good_symbols: list[SymbolNode]


@dataclass(frozen=True)
class ScanIssue:
    reason: str
    operation: str
    path: str | None
    recoverable: bool = True


@dataclass
class ScanResult:
    files: dict[str, StatKey] = field(default_factory=dict)
    skips: list[SkipRecord] = field(default_factory=list)
    issues: list[ScanIssue] = field(default_factory=list)
    omitted_count: int = 0


@dataclass
class PendingChange:
    marker: StatKey | None
    since: float


def default_limits() -> Limits:
    return Limits(
        max_files=2_000,
        max_file_bytes=512 * 1024,
        max_diff_lines=2_000,
        max_events_per_second=200,
        max_line_length=20_000,
        max_stdout_line_bytes=1024 * 1024,
        debounce_ms=250,
        poll_ms=100,
    )


def _is_secret(name: str) -> bool:
    lowered = name.lower()
    return any(fnmatch.fnmatchcase(lowered, pattern) for pattern in SECRET_PATTERNS)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _line_count(data: bytes) -> int:
    return len(data.splitlines())


def _relative_inside(root: Path, path: Path) -> str | None:
    try:
        resolved = path.resolve(strict=True)
        return resolved.relative_to(root).as_posix()
    except (FileNotFoundError, OSError, ValueError):
        return None


def _file_snapshot(state: FileState) -> dict[str, object]:
    return {
        "id": state.file_node.id,
        "path": state.path,
        "content_sha256": state.sha256,
        "line_count": state.file_node.line_count,
        "parse_ok": state.file_node.parse_error is None,
        "parse_error": state.file_node.parse_error,
    }


def _changed_ranges(
    before: str | None, after: str | None
) -> tuple[list[dict[str, int]], list[tuple[int, int]], list[tuple[int, int]]]:
    old_lines = before.splitlines() if before is not None else []
    new_lines = after.splitlines() if after is not None else []
    public: list[dict[str, int]] = []
    old_ranges: list[tuple[int, int]] = []
    new_ranges: list[tuple[int, int]] = []
    for tag, old_start, old_end, new_start, new_end in difflib.SequenceMatcher(
        None, old_lines, new_lines, autojunk=False
    ).get_opcodes():
        if tag == "equal":
            continue
        if old_end > old_start:
            old_ranges.append((old_start + 1, old_end))
        if new_end > new_start:
            new_range = (new_start + 1, new_end)
            new_ranges.append(new_range)
            public.append({"start_line": new_range[0], "end_line": new_range[1]})
        else:
            anchor = max(1, min(new_start + 1, max(1, len(new_lines))))
            public.append({"start_line": anchor, "end_line": anchor})
    return public, old_ranges, new_ranges


def _overlaps(symbol: SymbolNode, ranges: Sequence[tuple[int, int]]) -> bool:
    return any(start <= symbol.end_line and end >= symbol.start_line for start, end in ranges)


def _diff_hunks(
    before: str | None,
    after: str | None,
    before_path: str,
    after_path: str,
    max_lines: int,
) -> tuple[str, list[dict[str, object]], bool]:
    old_lines = before.splitlines() if before is not None else []
    new_lines = after.splitlines() if after is not None else []
    lines = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=before_path,
            tofile=after_path,
            lineterm="",
        )
    )
    truncated = len(lines) > max_lines
    kept = lines[:max_lines]
    hunks: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in kept:
        match = _HUNK.match(line)
        if match is not None:
            current = {
                "old_start": int(match[1]),
                "old_count": int(match[2] or "1"),
                "new_start": int(match[3]),
                "new_count": int(match[4] or "1"),
                "lines": [],
            }
            hunks.append(current)
        elif current is not None:
            hunk_lines = current["lines"]
            assert isinstance(hunk_lines, list)
            hunk_lines.append(line)
    return "\n".join(kept), hunks, truncated


class SpectateEngine:
    """Observe one resolved root and emit ordered `spectate-1.0` facts."""

    def __init__(
        self,
        root: Path,
        *,
        limits: Limits | None = None,
        sink: Callable[[dict[str, object]], None] | None = None,
        evidence_hashes: Mapping[str, Collection[str]] | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if root.is_symlink():
            raise SpectateError("watch root must not be a symlink")
        try:
            resolved = root.resolve(strict=True)
        except (FileNotFoundError, OSError) as exc:
            raise SpectateError(f"watch root is unavailable: {root}") from exc
        if not resolved.is_dir():
            raise SpectateError(f"watch root is not a directory: {resolved}")
        self.root = resolved
        root_details = self.root.stat()
        self.root_identity = (root_details.st_dev, root_details.st_ino)
        self.limits = limits or default_limits()
        self.sink = sink or (lambda _record: None)
        self.evidence_hashes = {
            path: set(hashes) for path, hashes in (evidence_hashes or {}).items()
        }
        self.clock = clock
        self.sleeper = sleeper
        self.session_id = str(uuid.uuid4())
        self.sequence = 0
        self.states: dict[str, FileState] = {}
        self.pending: dict[str, PendingChange] = {}
        self.blocked: dict[str, StatKey | None] = {}
        self.started = False
        self.ended = False
        self._last_omitted_count = 0
        self._event_times: deque[float] = deque()

    def _emit(self, event: str, **payload: object) -> bool:
        now = self.clock()
        while self._event_times and now - self._event_times[0] >= 1.0:
            self._event_times.popleft()
        if len(self._event_times) >= self.limits.max_events_per_second:
            wait = max(0.0, 1.0 - (now - self._event_times[0]))
            self.sleeper(wait)
            now = self.clock()
            while self._event_times and now - self._event_times[0] >= 1.0:
                self._event_times.popleft()
        candidate: dict[str, object] = {
            "schema_version": "spectate-1.0",
            "session_id": self.session_id,
            "sequence": self.sequence + 1,
            "emitted_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "event": event,
            **payload,
        }
        validated = EVENT_ADAPTER.validate_python(candidate)
        record = validated.model_dump(mode="json")
        size = len(json.dumps(record, separators=(",", ":")).encode("utf-8"))
        if size > self.limits.max_stdout_line_bytes:
            if event == "watch_error":
                raise SpectateError("max stdout line size is too small for a watch_error record")
            self._emit(
                "watch_error",
                reason="max_stdout_line_bytes",
                operation=f"emit_{event}",
                path=payload.get("path"),
                recoverable=True,
                skipped_count=1,
            )
            return False
        self.sequence += 1
        self._event_times.append(now)
        self.sink(record)
        return True

    def _watch_error(
        self,
        reason: str,
        operation: str,
        *,
        path: str | None = None,
        recoverable: bool = True,
        skipped_count: int = 0,
    ) -> None:
        self._emit(
            "watch_error",
            reason=reason,
            operation=operation,
            path=path,
            recoverable=recoverable,
            skipped_count=skipped_count,
        )

    def _scan(self) -> ScanResult:
        result = ScanResult()
        try:
            root_stat = self.root.stat()
        except FileNotFoundError:
            reason = "deleted"
            try:
                for entry in os.scandir(self.root.parent):
                    details = entry.stat(follow_symlinks=False)
                    if (details.st_dev, details.st_ino) == self.root_identity:
                        reason = "renamed"
                        break
            except OSError:
                pass
            raise SpectateError(f"root_missing:{reason}") from None
        except PermissionError:
            raise SpectateError("root_missing:permission_denied") from None
        except OSError:
            raise SpectateError("root_missing:unmounted") from None
        if not stat.S_ISDIR(root_stat.st_mode):
            raise SpectateError("root_missing:renamed")
        stack = [self.root]
        new_capacity = max(0, self.limits.max_files - len(self.states))
        new_files = 0
        while stack:
            current = stack.pop()
            try:
                entries = sorted(os.scandir(current), key=lambda item: item.name)
            except PermissionError:
                relative = current.relative_to(self.root).as_posix()
                result.issues.append(
                    ScanIssue("permission_denied", "scan_directory", relative or None)
                )
                continue
            except OSError:
                relative = current.relative_to(self.root).as_posix()
                result.issues.append(ScanIssue("unreadable", "scan_directory", relative or None))
                continue
            directories: list[Path] = []
            for entry in entries:
                name = entry.name
                if _is_secret(name):
                    continue
                path = Path(entry.path)
                try:
                    if entry.is_symlink():
                        if name.endswith(".py"):
                            relative = path.relative_to(self.root).as_posix()
                            result.skips.append(
                                SkipRecord(path=relative, reason="symlink_file", count=1)
                            )
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if name in IGNORED_PARTS:
                            continue
                        if (path / ".git").is_file():
                            relative = path.relative_to(self.root).as_posix()
                            result.skips.append(
                                SkipRecord(path=relative, reason="git_submodule", count=1)
                            )
                            continue
                        directories.append(path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or not name.endswith(".py"):
                        continue
                    file_relative = _relative_inside(self.root, path)
                    if file_relative is None or _is_secret(Path(file_relative).name):
                        continue
                    key = StatKey.from_stat(entry.stat(follow_symlinks=False))
                    if file_relative in self.states:
                        result.files[file_relative] = key
                    elif new_files >= new_capacity:
                        result.omitted_count += 1
                    else:
                        result.files[file_relative] = key
                        new_files += 1
                except (FileNotFoundError, OSError):
                    continue
            stack.extend(reversed(directories))
        result.files = dict(sorted(result.files.items()))
        result.skips.sort(key=lambda item: (item.path, item.reason))
        return result

    def _read_once(self, relative: str) -> ReadResult:
        path = self.root / relative
        resolved = _relative_inside(self.root, path)
        if resolved != relative or path.is_symlink():
            raise SpectateError("path_escape_or_symlink")
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(path, flags)
        except PermissionError:
            raise SpectateError("permission_denied") from None
        except OSError as exc:
            raise SpectateError("unreadable") from exc
        try:
            details = os.fstat(descriptor)
            if not stat.S_ISREG(details.st_mode):
                raise SpectateError("not_regular_file")
            if details.st_size > self.limits.max_file_bytes:
                raise SpectateError("max_file_bytes")
            chunks: list[bytes] = []
            remaining = self.limits.max_file_bytes + 1
            while remaining:
                chunk = os.read(descriptor, min(64 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b"".join(chunks)
            if len(data) > self.limits.max_file_bytes:
                raise SpectateError("max_file_bytes")
            return ReadResult(StatKey.from_stat(details), data)
        finally:
            os.close(descriptor)

    def _stable_read(self, relative: str) -> ReadResult:
        first = self._read_once(relative)
        second = self._read_once(relative)
        if first.key != second.key or first.data != second.data:
            raise SpectateError("unstable_write")
        return second

    def _state_from_read(
        self, relative: str, read: ReadResult, previous: FileState | None = None
    ) -> FileState:
        file_node, parsed_symbols, _error = index_python_bytes(relative, read.data)
        try:
            text = read.data.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if file_node.parse_error is None:
            symbols = parsed_symbols
            last_good = parsed_symbols
        elif previous is not None:
            symbols = previous.last_good_symbols
            last_good = previous.last_good_symbols
        else:
            symbols = []
            last_good = []
        return FileState(
            path=relative,
            stat_key=read.key,
            data=read.data,
            text=text,
            sha256=file_node.content_sha256,
            file_node=file_node,
            symbols=symbols,
            last_good_symbols=last_good,
        )

    def start(self) -> None:
        if self.started:
            raise SpectateError("watch session already started")
        self.started = True
        self._emit(
            "session_started",
            root_display_name=self.root.name,
            limits=self.limits,
            ignore=IgnoreSummary(
                ignored_parts=sorted(IGNORED_PARTS),
                secret_patterns=list(SECRET_PATTERNS),
            ),
            diff_base="previous stable snapshot",
            tests_rerun=False,
        )
        scan = self._scan()
        for issue in scan.issues:
            self._watch_error(
                issue.reason,
                issue.operation,
                path=issue.path,
                recoverable=issue.recoverable,
            )
        if scan.omitted_count:
            self._watch_error(
                "max_files",
                "initial_scan",
                skipped_count=scan.omitted_count,
            )
        self._last_omitted_count = scan.omitted_count
        for relative in scan.files:
            try:
                read = self._stable_read(relative)
                self.states[relative] = self._state_from_read(relative, read)
            except SpectateError as exc:
                self.blocked[relative] = scan.files[relative]
                self._watch_error(str(exc), "initial_read", path=relative, skipped_count=1)
        files = [self.states[path].file_node for path in sorted(self.states)]
        symbols = [
            symbol
            for path in sorted(self.states)
            for symbol in sorted(
                self.states[path].symbols, key=lambda item: (item.start_line, item.id)
            )
        ]
        self._emit(
            "initial_snapshot",
            files=[_file_snapshot(self.states[path]) for path in sorted(self.states)],
            structure={"files": files, "symbols": symbols, "skips": scan.skips},
        )

    def _source_reason(self, state: FileState) -> str | None:
        if state.text is None:
            return "non_utf8"
        if any(len(line) > self.limits.max_line_length for line in state.text.splitlines()):
            return "max_line_length"
        return None

    def _symbol_delta(
        self, previous: FileState | None, current: FileState | None
    ) -> tuple[list[str], list[str], list[str]]:
        before = {item.id: item for item in previous.symbols} if previous else {}
        after = {item.id: item for item in current.symbols} if current else {}
        added = sorted(after.keys() - before.keys())
        removed = sorted(before.keys() - after.keys())
        modified = sorted(
            identity
            for identity in before.keys() & after.keys()
            if before[identity].content_sha256 != after[identity].content_sha256
        )
        return added, modified, removed

    def _emit_change(
        self,
        kind: str,
        path: str,
        previous: FileState | None,
        current: FileState | None,
        *,
        from_path: str | None = None,
    ) -> None:
        before_text = previous.text if previous else ""
        after_text = current.text if current else ""
        public_ranges, old_ranges, new_ranges = _changed_ranges(before_text, after_text)
        affected = {
            symbol.id
            for symbol in (previous.symbols if previous is not None else [])
            if _overlaps(symbol, old_ranges)
        }
        if current is not None:
            affected.update(
                symbol.id for symbol in current.symbols if _overlaps(symbol, new_ranges)
            )
        if kind == "deleted" and previous is not None:
            affected.update(symbol.id for symbol in previous.symbols)
        parse_error = current.file_node.parse_error if current is not None else None
        self._emit(
            "file_changed",
            path=path,
            kind=kind,
            from_path=from_path,
            to_path=path if kind == "renamed" else None,
            previous_sha256=previous.sha256 if previous else None,
            new_sha256=current.sha256 if current else None,
            line_count=current.file_node.line_count if current else None,
            changed_line_ranges=public_ranges,
            affected_file_ids=[f"file:{path}"],
            affected_symbol_ids=sorted(affected),
            parse_ok=current is None or parse_error is None,
            parse_error=parse_error,
        )
        if current is not None:
            source_reason = self._source_reason(current)
            self._emit(
                "source",
                path=path,
                sha256=current.sha256,
                text=current.text if source_reason is None else None,
                complete=source_reason is None,
                skipped_reason=source_reason,
            )
            if source_reason is None and (previous is None or previous.text is not None):
                diff_text, hunks, truncated = _diff_hunks(
                    previous.text if previous else "",
                    current.text,
                    from_path or path,
                    path,
                    self.limits.max_diff_lines,
                )
                self._emit(
                    "diff",
                    path=path,
                    base="previous stable snapshot",
                    base_sha256=previous.sha256 if previous else None,
                    new_sha256=current.sha256,
                    hunks=hunks,
                    text=diff_text,
                    truncated=truncated,
                    skipped_reason="max_diff_lines" if truncated else None,
                )
            else:
                self._emit(
                    "diff",
                    path=path,
                    base="previous stable snapshot",
                    base_sha256=previous.sha256 if previous else None,
                    new_sha256=current.sha256,
                    hunks=[],
                    text="",
                    truncated=False,
                    skipped_reason=source_reason or "previous_non_utf8",
                )
        else:
            diff_text, hunks, truncated = _diff_hunks(
                previous.text if previous and previous.text is not None else "",
                "",
                from_path or path,
                path,
                self.limits.max_diff_lines,
            )
            self._emit(
                "diff",
                path=path,
                base="previous stable snapshot",
                base_sha256=previous.sha256 if previous else None,
                new_sha256=None,
                hunks=hunks,
                text=diff_text,
                truncated=truncated,
                skipped_reason="max_diff_lines" if truncated else None,
            )
        added, modified, removed = self._symbol_delta(previous, current)
        changed_nodes = sorted(
            {
                f"file:{path}",
                *affected,
                *added,
                *modified,
                *removed,
            }
        )
        kept = bool(
            current is not None
            and current.file_node.parse_error is not None
            and current.symbols
        )
        self._emit(
            "structure_update",
            path=path,
            file=current.file_node if current else None,
            symbols=current.symbols if current else [],
            added_symbol_ids=added,
            modified_symbol_ids=modified,
            removed_symbol_ids=removed,
            changed_node_ids=changed_nodes,
            kept_last_good_symbols=kept,
            parse_ok=current is None or current.file_node.parse_error is None,
            parse_error=parse_error,
        )
        if current is not None:
            for evidence_hash in sorted(self.evidence_hashes.get(path, set())):
                if evidence_hash != current.sha256:
                    self._emit(
                        "evidence_stale",
                        path=path,
                        evidence_content_sha256=evidence_hash,
                        new_content_sha256=current.sha256,
                        rule="containing file content_sha256",
                    )

    def _process_ready(self, ready: set[str], scan: ScanResult) -> None:
        deleted = sorted(path for path in ready if path in self.states and path not in scan.files)
        created = sorted(path for path in ready if path not in self.states and path in scan.files)
        modified = sorted(path for path in ready if path in self.states and path in scan.files)
        created_reads: dict[str, ReadResult] = {}
        for path in [*created, *modified]:
            try:
                created_reads[path] = self._stable_read(path)
            except SpectateError as exc:
                marker = scan.files.get(path)
                if str(exc) == "unstable_write":
                    self.pending[path] = PendingChange(marker, self.clock())
                    continue
                self.blocked[path] = marker
                self.pending.pop(path, None)
                self._watch_error(str(exc), "stable_read", path=path, skipped_count=1)

        rename_pairs: list[tuple[str, str]] = []
        unmatched_created = set(created_reads).intersection(created)
        unmatched_deleted = set(deleted)
        for old_path in deleted:
            old = self.states[old_path]
            matches = sorted(
                path
                for path in unmatched_created
                if created_reads[path].key.device == old.stat_key.device
                and created_reads[path].key.inode == old.stat_key.inode
            )
            if not matches:
                matches = sorted(
                    path
                    for path in unmatched_created
                    if _sha256(created_reads[path].data) == old.sha256
                )
            if len(matches) == 1:
                new_path = matches[0]
                rename_pairs.append((old_path, new_path))
                unmatched_created.remove(new_path)
                unmatched_deleted.remove(old_path)

        for old_path, new_path in rename_pairs:
            previous = self.states.pop(old_path)
            current = self._state_from_read(new_path, created_reads[new_path], previous)
            self.states[new_path] = current
            self._emit_change("renamed", new_path, previous, current, from_path=old_path)
            self.pending.pop(old_path, None)
            self.pending.pop(new_path, None)
            self.blocked.pop(old_path, None)
            self.blocked.pop(new_path, None)

        for path in sorted(unmatched_deleted):
            previous = self.states.pop(path)
            self._emit_change("deleted", path, previous, None)
            self.pending.pop(path, None)
            self.blocked.pop(path, None)

        for path in sorted(unmatched_created):
            current = self._state_from_read(path, created_reads[path])
            self.states[path] = current
            self._emit_change("created", path, None, current)
            self.pending.pop(path, None)
            self.blocked.pop(path, None)

        for path in modified:
            if path not in created_reads:
                continue
            previous = self.states[path]
            current = self._state_from_read(path, created_reads[path], previous)
            if current.sha256 == previous.sha256:
                previous.stat_key = current.stat_key
            else:
                self.states[path] = current
                self._emit_change("modified", path, previous, current)
            self.pending.pop(path, None)
            self.blocked.pop(path, None)

    def poll_once(self, now: float | None = None) -> bool:
        if not self.started or self.ended:
            raise SpectateError("watch session is not active")
        observed_at = self.clock() if now is None else now
        try:
            scan = self._scan()
        except SpectateError as exc:
            value = str(exc)
            if value.startswith("root_missing:"):
                reason = value.split(":", 1)[1]
                self._emit("root_missing", reason=reason)
                self.stop(f"root_{reason}")
                return False
            raise
        for issue in scan.issues:
            self._watch_error(
                issue.reason,
                issue.operation,
                path=issue.path,
                recoverable=issue.recoverable,
            )
        if scan.omitted_count and scan.omitted_count != self._last_omitted_count:
            self._watch_error("max_files", "poll_scan", skipped_count=scan.omitted_count)
        self._last_omitted_count = scan.omitted_count

        all_paths = set(self.states) | set(scan.files)
        changed: dict[str, StatKey | None] = {}
        for path in all_paths:
            current = scan.files.get(path)
            previous = self.states.get(path)
            if previous is None or current is None or previous.stat_key != current:
                if path in self.blocked and self.blocked[path] == current:
                    continue
                changed[path] = current
        for path in set(self.pending) - set(changed):
            self.pending.pop(path, None)
        for path, marker in changed.items():
            candidate = self.pending.get(path)
            if candidate is None or candidate.marker != marker:
                self.pending[path] = PendingChange(marker, observed_at)
        quiet_seconds = self.limits.debounce_ms / 1000
        ready = {
            path
            for path, candidate in self.pending.items()
            if observed_at - candidate.since >= quiet_seconds
        }
        if ready:
            self._process_ready(ready, scan)
        return True

    def stop(self, reason: str = "stopped") -> None:
        if not self.started or self.ended:
            return
        self.ended = True
        self._emit("session_ended", reason=reason)

    def run(self, stop_event: threading.Event) -> None:
        self.start()
        try:
            while not stop_event.wait(self.limits.poll_ms / 1000):
                if not self.poll_once():
                    return
        finally:
            self.stop("stdin_closed_or_signal" if stop_event.is_set() else "stopped")


def stdout_sink(record: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run_until_stdin_close_or_signal(engine: SpectateEngine) -> None:
    stop_event = threading.Event()

    def monitor_stdin() -> None:
        try:
            while sys.stdin.buffer.read(1):
                pass
        except (AttributeError, OSError):
            pass
        stop_event.set()

    monitor = threading.Thread(target=monitor_stdin, name="faultmesh-spectate-stdin", daemon=True)
    monitor.start()
    old_term = signal.getsignal(signal.SIGTERM)
    old_int = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGTERM, lambda _number, _frame: stop_event.set())
    signal.signal(signal.SIGINT, lambda _number, _frame: stop_event.set())
    try:
        engine.run(stop_event)
    finally:
        signal.signal(signal.SIGTERM, old_term)
        signal.signal(signal.SIGINT, old_int)
