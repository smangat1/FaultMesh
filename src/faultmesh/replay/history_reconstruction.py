"""Read-only, best-effort reconstruction of history file state from recorded patches."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, Literal

from faultmesh.replay.models import ChangedFileView, ReplayRecord, TranscriptSpan

RECONSTRUCTION_LABEL: Final = "reconstructed from current checkout (unverified)"

_HEADER = re.compile(r"^\*\*\* ([^:]+):\s*(.+?)\s*$", re.MULTILINE)
_HUNK = re.compile(
    r"^@@\s+-(?P<old_start>\d+)(?:,(?P<old_count>\d+))?\s+"
    r"\+(?P<new_start>\d+)(?:,(?P<new_count>\d+))?\s+@@"
)
_PYTHON_PATH = re.compile(
    r"Path\(\s*(['\"])(?P<path>[^'\"]+)\1\s*\)\."
    r"(?P<action>write_text|write_bytes|touch|unlink|rename|replace)"
)
_REDIRECT_PATH = re.compile(r"(?:^|[;&|]\s*|\s)(?:>>|>)\s*(['\"]?)([^\s'\";&|]+)\1")
_SHELL_PATH = re.compile(
    r"(?:^|[;&|]\s*)(?P<action>rm|touch|truncate)\s+(?:-[^\s]+\s+)*(?P<path>[^\s;&|]+)"
)
_MOVE = re.compile(
    r"(?:^|[;&|]\s*)(?:mv|move)\s+(?:-[^\s]+\s+)*(?P<source>[^\s;&|]+)\s+"
    r"(?P<target>[^\s;&|]+)"
)

_UNKNOWN: Final = object()
_FileText = str | None | object


@dataclass(frozen=True)
class _Replacement:
    old: str
    new: str


@dataclass(frozen=True)
class _PatchOperation:
    kind: str
    path: str
    patch: str
    move_to: str | None = None
    content: str | None = None
    replacements: tuple[_Replacement, ...] = ()


@dataclass(frozen=True)
class ReconstructionResult:
    records: tuple[ReplayRecord, ...]
    changed_files_by_sequence: dict[int, tuple[ChangedFileView, ...]]


def _safe_path(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith(("a/", "b/")):
        normalized = normalized[2:]
    candidate = PurePosixPath(normalized)
    if not normalized or candidate.is_absolute() or ".." in candidate.parts:
        return None
    cleaned = "/".join(part for part in candidate.parts if part not in {"", "."})
    return cleaned or None


def _json_operations(patch: str) -> list[_PatchOperation]:
    try:
        raw = json.loads(patch)
    except json.JSONDecodeError:
        return []
    entries: list[dict[str, object]] = []
    if isinstance(raw, list):
        entries = [item for item in raw if isinstance(item, dict)]
    elif isinstance(raw, dict):
        if isinstance(raw.get("path"), str):
            entries = [raw]
        else:
            for path, value in raw.items():
                if isinstance(value, dict):
                    entries.append({"path": path, **value})
    output: list[_PatchOperation] = []
    for entry in entries:
        path = _safe_path(entry.get("path"))
        if path is None:
            continue
        kind_value = entry.get("kind", entry.get("type", "change"))
        kind = str(kind_value).lower().replace("_path", "")
        diff_value = entry.get("diff", entry.get("unified_diff"))
        diff = diff_value if isinstance(diff_value, str) else ""
        content_value = entry.get("content")
        move_value = entry.get("move_to", entry.get("move_path"))
        output.append(
            _PatchOperation(
                kind=kind,
                path=path,
                patch=diff or (content_value if isinstance(content_value, str) else ""),
                move_to=_safe_path(move_value),
                content=content_value if isinstance(content_value, str) else None,
            )
        )
    return output


def _replacement_sections(body: str) -> tuple[_Replacement, ...]:
    markers = list(
        re.finditer(
            r"^(--- source old(?: \d+)?)$|^(\+\+\+ source new(?: \d+)?)$",
            body,
            re.MULTILINE,
        )
    )
    replacements: list[_Replacement] = []
    index = 0
    while index + 1 < len(markers):
        old_marker = markers[index]
        new_marker = markers[index + 1]
        if not old_marker.group(1) or not new_marker.group(2):
            index += 1
            continue
        old_start = old_marker.end() + (1 if body[old_marker.end() :].startswith("\n") else 0)
        new_start = new_marker.end() + (1 if body[new_marker.end() :].startswith("\n") else 0)
        old = body[old_start : new_marker.start()]
        next_old = next(
            (item for item in markers[index + 2 :] if item.group(1)),
            None,
        )
        new_end = next_old.start() if next_old is not None else len(body)
        new = body[new_start:new_end]
        replacements.append(_Replacement(old=old.rstrip("\n"), new=new.rstrip("\n")))
        index = markers.index(next_old) if next_old is not None else len(markers)
    return tuple(replacements)


def parse_recorded_patch(patch: str) -> list[_PatchOperation]:
    """Parse supported history patch envelopes without executing any recorded content."""
    json_operations = _json_operations(patch)
    if json_operations:
        return json_operations
    matches = list(_HEADER.finditer(patch))
    output: list[_PatchOperation] = []
    for index, match in enumerate(matches):
        kind = match.group(1).strip().lower()
        if kind == "move to":
            continue
        path = _safe_path(match.group(2))
        if path is None:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(patch)
        body = patch[match.end() : end].lstrip("\n")
        move_to: str | None = None
        if index + 1 < len(matches) and matches[index + 1].group(1).strip().lower() == "move to":
            move_to = _safe_path(matches[index + 1].group(2))
        output.append(
            _PatchOperation(
                kind=kind,
                path=path,
                patch=body,
                move_to=move_to,
                content=(
                    body
                    if kind in {"add", "delete", "write"} and "@@" not in body
                    else None
                ),
                replacements=(
                    _replacement_sections(body)
                    if kind in {"edit", "multi-edit"}
                    else ()
                ),
            )
        )
    return output


def _apply_reverse_unified(after_text: str, patch: str) -> str:
    source = after_text.splitlines(keepends=True)
    patch_lines = patch.splitlines(keepends=True)
    output: list[str] = []
    source_index = 0
    index = 0
    found_hunk = False
    while index < len(patch_lines):
        header = _HUNK.match(patch_lines[index].rstrip("\r\n"))
        if header is None:
            index += 1
            continue
        found_hunk = True
        new_start = int(header.group("new_start"))
        hunk_index = max(new_start - 1, 0)
        if hunk_index < source_index or hunk_index > len(source):
            raise ValueError("patch hunk is outside the available text")
        output.extend(source[source_index:hunk_index])
        source_index = hunk_index
        index += 1
        while index < len(patch_lines) and _HUNK.match(
            patch_lines[index].rstrip("\r\n")
        ) is None:
            line = patch_lines[index]
            if line.startswith(("--- ", "+++ ")):
                index += 1
                continue
            if line.startswith("\\ No newline at end of file"):
                index += 1
                continue
            if not line or line[0] not in {" ", "+", "-"}:
                index += 1
                continue
            payload = line[1:]
            prefix = line[0]
            if prefix in {" ", "+"}:
                if source_index >= len(source) or source[source_index] != payload:
                    raise ValueError("recorded patch does not match the linked checkout")
                source_index += 1
            if prefix in {" ", "-"}:
                output.append(payload)
            index += 1
    if not found_hunk:
        raise ValueError("recorded patch contains no unified diff hunks")
    output.extend(source[source_index:])
    return "".join(output)


def _reverse_replacements(after_text: str, replacements: tuple[_Replacement, ...]) -> str:
    text = after_text
    if not replacements:
        raise ValueError("recorded edit has no reversible replacement")
    for replacement in reversed(replacements):
        if not replacement.new or text.count(replacement.new) != 1:
            raise ValueError("recorded replacement is not uniquely reversible")
        text = text.replace(replacement.new, replacement.old, 1)
    return text


def _digest(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


def _view(
    operation: _PatchOperation,
    *,
    path: str,
    change: Literal["added", "modified", "deleted"],
    before_text: str | None,
    after_text: str | None,
    reconstructed: bool,
) -> ChangedFileView:
    return ChangedFileView(
        path=path,
        change=change,
        before_sha256=_digest(before_text) if reconstructed else None,
        after_sha256=_digest(after_text) if reconstructed else None,
        unified_diff=operation.patch or None,
        derived_from="recorded_patch",
        file_state=(
            "reconstructed_from_current_checkout_unverified" if reconstructed else "unknown"
        ),
        reconstruction_label=RECONSTRUCTION_LABEL if reconstructed else None,
        before_text=before_text if reconstructed else None,
        after_text=after_text if reconstructed else None,
    )


def _unknown_view(operation: _PatchOperation) -> list[ChangedFileView]:
    kind = operation.kind
    if operation.move_to is not None or kind in {"move", "rename"}:
        destination = operation.move_to
        views = [
            _view(
                operation,
                path=operation.path,
                change="deleted",
                before_text=None,
                after_text=None,
                reconstructed=False,
            )
        ]
        if destination is not None:
            views.append(
                _view(
                    operation,
                    path=destination,
                    change="added",
                    before_text=None,
                    after_text=None,
                    reconstructed=False,
                )
            )
        return views
    change: Literal["added", "modified", "deleted"] = "modified"
    if kind in {"add", "create"}:
        change = "added"
    elif kind in {"delete", "remove"}:
        change = "deleted"
    return [
        _view(
            operation,
            path=operation.path,
            change=change,
            before_text=None,
            after_text=None,
            reconstructed=False,
        )
    ]


def _read_linked_file(root: Path, path: str, max_file_bytes: int) -> _FileText:
    candidate = root.joinpath(*PurePosixPath(path).parts)
    cursor = root
    try:
        for part in PurePosixPath(path).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                return _UNKNOWN
        if not candidate.exists():
            return None
        if not candidate.is_file() or candidate.stat().st_size > max_file_bytes:
            return _UNKNOWN
        return candidate.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return _UNKNOWN


def _command_views(command: str) -> list[ChangedFileView]:
    changes: list[tuple[str, Literal["added", "modified", "deleted"]]] = []
    for match in _PYTHON_PATH.finditer(command):
        path = _safe_path(match.group("path"))
        if path is None:
            continue
        action = match.group("action")
        changes.append((path, "deleted" if action == "unlink" else "modified"))
    for match in _REDIRECT_PATH.finditer(command):
        path = _safe_path(match.group(2))
        if path is not None:
            changes.append((path, "modified"))
    for match in _SHELL_PATH.finditer(command):
        path = _safe_path(match.group("path").strip("'\""))
        if path is not None:
            changes.append((path, "deleted" if match.group("action") == "rm" else "modified"))
    for match in _MOVE.finditer(command):
        source = _safe_path(match.group("source").strip("'\""))
        target = _safe_path(match.group("target").strip("'\""))
        if source is not None:
            changes.append((source, "deleted"))
        if target is not None:
            changes.append((target, "added"))
    output: list[ChangedFileView] = []
    seen: set[tuple[str, str]] = set()
    for path, change in changes:
        if (path, change) in seen:
            continue
        seen.add((path, change))
        output.append(
            ChangedFileView(
                path=path,
                change=change,
                unified_diff=command,
                derived_from="recorded_patch",
                file_state="unknown",
            )
        )
    return output


def reconstruct_history_file_state(
    records: tuple[ReplayRecord, ...],
    project_root: Path | None,
    *,
    max_file_bytes: int,
) -> ReconstructionResult:
    """Reverse recorded patches from a linked checkout; never modify checkout bytes."""
    operations_by_sequence = {
        record.sequence: parse_recorded_patch(record.edit_patch)
        for record in records
        if record.edit_patch
    }
    states: dict[str, _FileText] = {}
    changed: dict[int, tuple[ChangedFileView, ...]] = {}
    root = project_root.resolve() if project_root is not None else None
    root_available = root is not None and root.is_dir()

    def state(path: str) -> _FileText:
        if path not in states:
            states[path] = (
                _read_linked_file(root, path, max_file_bytes)
                if root_available and root is not None
                else _UNKNOWN
            )
        return states[path]

    for record in reversed(records):
        operations = operations_by_sequence.get(record.sequence, [])
        record_view_groups: list[list[ChangedFileView]] = []
        for operation in reversed(operations):
            destination = operation.move_to
            after_path = destination or operation.path
            after = state(after_path)
            try:
                if after is _UNKNOWN:
                    raise ValueError("linked checkout file is unavailable")
                kind = operation.kind
                if destination is not None or kind in {"move", "rename"}:
                    if destination is None or not isinstance(after, str):
                        raise ValueError("move destination is unavailable")
                    before = (
                        _apply_reverse_unified(after, operation.patch)
                        if "@@" in operation.patch
                        else after
                    )
                    record_view_groups.append(
                        [
                            _view(
                                operation,
                                path=operation.path,
                                change="deleted",
                                before_text=before,
                                after_text=None,
                                reconstructed=True,
                            ),
                            _view(
                                operation,
                                path=destination,
                                change="added",
                                before_text=None,
                                after_text=after,
                                reconstructed=True,
                            ),
                        ]
                    )
                    states[destination] = None
                    states[operation.path] = before
                    continue
                if kind in {"add", "create"}:
                    if not isinstance(after, str):
                        raise ValueError("added file is unavailable")
                    if "@@" in operation.patch and _apply_reverse_unified(after, operation.patch):
                        raise ValueError("added patch did not reverse to a missing file")
                    if operation.content is not None and operation.content != after:
                        raise ValueError("recorded added content does not match checkout")
                    record_view_groups.append(
                        [
                            _view(
                                operation,
                                path=operation.path,
                                change="added",
                                before_text=None,
                                after_text=after,
                                reconstructed=True,
                            )
                        ]
                    )
                    states[operation.path] = None
                    continue
                if kind in {"delete", "remove"}:
                    if after is not None:
                        raise ValueError("deleted path exists in the linked checkout state")
                    deleted_before = (
                        _apply_reverse_unified("", operation.patch)
                        if "@@" in operation.patch
                        else operation.content
                    )
                    if deleted_before is None:
                        raise ValueError("deleted patch has no recoverable content")
                    record_view_groups.append(
                        [
                            _view(
                                operation,
                                path=operation.path,
                                change="deleted",
                                before_text=deleted_before,
                                after_text=None,
                                reconstructed=True,
                            )
                        ]
                    )
                    states[operation.path] = deleted_before
                    continue
                if not isinstance(after, str):
                    raise ValueError("updated file is unavailable")
                if kind in {"edit", "multi-edit"}:
                    before = _reverse_replacements(after, operation.replacements)
                else:
                    before = _apply_reverse_unified(after, operation.patch)
                record_view_groups.append(
                    [
                        _view(
                            operation,
                            path=operation.path,
                            change="modified",
                            before_text=before,
                            after_text=after,
                            reconstructed=True,
                        )
                    ]
                )
                states[operation.path] = before
            except ValueError:
                record_view_groups.append(_unknown_view(operation))
                states[operation.path] = _UNKNOWN
                if destination is not None:
                    states[destination] = _UNKNOWN
        if not operations and record.edit_command:
            command_views = _command_views(record.edit_command)
            record_view_groups.append(command_views)
            for command_view in command_views:
                states[command_view.path] = _UNKNOWN
        if record_view_groups:
            changed[record.sequence] = tuple(
                item
                for group in reversed(record_view_groups)
                for item in group
            )

    updated_records = tuple(
        record.model_copy(
            update={
                "file_state": (
                    "reconstructed_from_current_checkout_unverified"
                    if changed.get(record.sequence)
                    and all(
                        item.file_state
                        == "reconstructed_from_current_checkout_unverified"
                        for item in changed[record.sequence]
                    )
                    else record.file_state
                )
            }
        )
        for record in records
    )
    return ReconstructionResult(records=updated_records, changed_files_by_sequence=changed)


def _normalized_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))


def _text_value(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return None
    text = value.get("text")
    if isinstance(text, str):
        return text
    nested = value.get("value")
    return _text_value(nested)


def _command_output(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return None
    for key in ("aggregatedOutput", "aggregated_output", "stdout", "output"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def transcript_spans(records: tuple[ReplayRecord, ...]) -> list[TranscriptSpan]:
    """Export stable, already-redacted source text for later local narration citations."""
    spans: list[TranscriptSpan] = []
    for record in records:
        candidates: list[tuple[Literal["prompt", "agent_message", "command_output"], str]] = []
        if record.prompt_text:
            candidates.append(("prompt", record.prompt_text))
        if record.tool_name in {"FinalAnswer", "Narration", "Plan", "ClaudeAssistantMessage"}:
            agent_text = _text_value(record.tool_response)
            if agent_text:
                candidates.append(("agent_message", agent_text))
        if record.tool_name in {"Command", "Bash"}:
            output = _command_output(record.tool_response)
            if output:
                candidates.append(("command_output", output))
        for kind, raw_text in candidates:
            text = _normalized_text(raw_text)
            if not text:
                continue
            spans.append(
                TranscriptSpan(
                    id=f"transcript:{record.id}:{kind}",
                    record_id=record.id,
                    sequence=record.sequence,
                    kind=kind,
                    text=text,
                    end_offset=len(text),
                    redacted=record.redaction_applied,
                    truncated=record.truncated,
                )
            )
    return spans
