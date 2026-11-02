"""Read-only text plans for reversing a recorded prompt range."""

from __future__ import annotations

import base64
import re
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from faultmesh.replay.models import ChangedFileView, ReplayExport
from faultmesh.replay.privacy import redact_history_text

_MAX_ACTIONS = 500
_MAX_EVIDENCE_BYTES = 64 * 1024
_HUNK = re.compile(
    r"^(?P<prefix>@@\s+)-(?P<before>\d+(?:,\d+)?)\s+\+(?P<after>\d+(?:,\d+)?)"
    r"(?P<suffix>\s+@@.*)$"
)

RevertActionKind = Literal["delete_file", "restore_file", "apply_reverse_diff", "manual_review"]
RevertProvenance = Literal[
    "recorded_patch",
    "reconstructed_from_current_checkout_unverified",
    "unknown",
]


class RevertPlanAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    path: str
    action: RevertActionKind
    instruction: str
    provenance: RevertProvenance
    provenance_label: str
    reverse_diff: str | None = None
    restore_text: str | None = None


class RevertPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["replay-revert-plan-1.0"] = "replay-revert-plan-1.0"
    session_id: str
    start_sequence: int = Field(ge=1)
    end_sequence: int = Field(ge=1)
    actions: list[RevertPlanAction]
    truncated: bool = False
    text: str


def _redacted_text(value: str) -> str:
    result = redact_history_text(value, _MAX_EVIDENCE_BYTES)
    return cast(str, result.value)


def _stored_text(exported: ReplayExport, digest: str | None) -> str | None:
    if digest is None:
        return None
    encoded = exported.content_base64_by_sha256.get(digest)
    if encoded is None:
        return None
    try:
        return base64.b64decode(encoded, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def reverse_unified_diff(value: str) -> str:
    """Reverse a unified diff without applying it to a checkout."""
    lines = value.splitlines(keepends=True)
    output: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if (
            line.startswith("--- ")
            and index + 1 < len(lines)
            and lines[index + 1].startswith("+++ ")
        ):
            before = line[4:]
            after = lines[index + 1][4:]
            output.extend((f"--- {after}", f"+++ {before}"))
            index += 2
            continue
        hunk = _HUNK.match(line.rstrip("\r\n"))
        if hunk is not None:
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            output.append(
                f"{hunk.group('prefix')}-{hunk.group('after')} +{hunk.group('before')}"
                f"{hunk.group('suffix')}{ending}"
            )
        elif line.startswith("+") and not line.startswith("+++"):
            output.append(f"-{line[1:]}")
        elif line.startswith("-") and not line.startswith("---"):
            output.append(f"+{line[1:]}")
        else:
            output.append(line)
        index += 1
    return "".join(output)


def _provenance(changed: ChangedFileView) -> tuple[RevertProvenance, str]:
    if changed.file_state == "reconstructed_from_current_checkout_unverified":
        return (
            "reconstructed_from_current_checkout_unverified",
            "reconstructed from current checkout (unverified)",
        )
    if changed.file_state == "recorded":
        return "recorded_patch", "recorded patch"
    return "unknown", "unknown file state"


def _before_text(exported: ReplayExport, changed: ChangedFileView) -> str | None:
    if changed.before_text is not None:
        return changed.before_text
    return _stored_text(exported, changed.before_sha256)


def _is_unified_diff(value: str) -> bool:
    lines = value.splitlines()
    return (
        any(line.startswith("--- ") for line in lines)
        and any(line.startswith("+++ ") for line in lines)
        and any(line.startswith("@@ ") for line in lines)
    )


def _action(
    exported: ReplayExport,
    sequence: int,
    changed: ChangedFileView,
) -> RevertPlanAction:
    provenance, label = _provenance(changed)
    unknown_prefix = (
        "Current file state is unknown; review before acting. "
        if provenance == "unknown"
        else ""
    )
    if changed.change == "added":
        return RevertPlanAction(
            sequence=sequence,
            path=changed.path,
            action="delete_file",
            instruction=f"{unknown_prefix}Delete the file added by this prompt.",
            provenance=provenance,
            provenance_label=label,
        )
    if changed.change == "deleted":
        before = _before_text(exported, changed)
        if before is None:
            return RevertPlanAction(
                sequence=sequence,
                path=changed.path,
                action="manual_review",
                instruction=(
                    "The file was deleted, but recorded before-text is unavailable. "
                    "Locate a trusted earlier copy before restoring it."
                ),
                provenance="unknown" if provenance == "unknown" else provenance,
                provenance_label=label,
            )
        return RevertPlanAction(
            sequence=sequence,
            path=changed.path,
            action="restore_file",
            instruction=f"{unknown_prefix}Restore the file using the included before-text.",
            provenance=provenance,
            provenance_label=label,
            restore_text=_redacted_text(before),
        )
    if (
        changed.change == "modified"
        and changed.unified_diff
        and _is_unified_diff(changed.unified_diff)
    ):
        return RevertPlanAction(
            sequence=sequence,
            path=changed.path,
            action="apply_reverse_diff",
            instruction=f"{unknown_prefix}Review and apply the included reverse diff.",
            provenance=provenance,
            provenance_label=label,
            reverse_diff=_redacted_text(reverse_unified_diff(changed.unified_diff)),
        )
    return RevertPlanAction(
        sequence=sequence,
        path=changed.path,
        action="manual_review",
        instruction=(
            "Recorded evidence does not contain enough text to construct a reverse diff. "
            "Leave the file unchanged until a trusted earlier version is available."
        ),
        provenance="unknown" if provenance == "unknown" else provenance,
        provenance_label=label,
    )


def _render_text(
    start_sequence: int,
    end_sequence: int,
    actions: list[RevertPlanAction],
    *,
    truncated: bool,
) -> str:
    lines = [
        f"Read-only revert plan for recorded steps {start_sequence}-{end_sequence}",
        "Derived from recorded evidence. This plan does not write files or run commands.",
        "Apply actions in the listed order; later recorded changes are reversed first.",
        "",
    ]
    if not actions:
        lines.append("No recorded file changes are available for this prompt range.")
    for index, action in enumerate(actions, start=1):
        lines.extend(
            [
                f"{index}. {action.path}",
                f"   Action: {action.action.replace('_', ' ')}",
                f"   Provenance: {action.provenance_label}",
                f"   Recorded step: {action.sequence}",
                f"   {action.instruction}",
            ]
        )
        if action.reverse_diff is not None:
            lines.extend(["", "```diff", action.reverse_diff.rstrip("\n"), "```"])
        if action.restore_text is not None:
            lines.extend(["", "```text", action.restore_text.rstrip("\n"), "```"])
        lines.append("")
    if truncated:
        lines.append(f"Only the first {_MAX_ACTIONS} reverse actions are included.")
    return "\n".join(lines).rstrip() + "\n"


def build_revert_plan(
    exported: ReplayExport,
    start_sequence: int,
    end_sequence: int,
) -> RevertPlan:
    """Build a bounded text plan; never inspect or mutate a checkout."""
    if start_sequence < 1 or end_sequence < start_sequence:
        raise ValueError("invalid revert-plan sequence range")
    candidates = [
        (entry.sequence, changed)
        for entry in exported.timeline
        if start_sequence <= entry.sequence <= end_sequence
        for changed in entry.changed_files
        if changed.change != "unchanged"
    ]
    priority = {"added": 0, "modified": 1, "deleted": 2, "unchanged": 3}
    candidates.sort(key=lambda item: (-item[0], priority[item[1].change], item[1].path))
    truncated = len(candidates) > _MAX_ACTIONS
    actions = [
        _action(exported, sequence, changed)
        for sequence, changed in candidates[:_MAX_ACTIONS]
    ]
    return RevertPlan(
        session_id=exported.session.id,
        start_sequence=start_sequence,
        end_sequence=end_sequence,
        actions=actions,
        truncated=truncated,
        text=_render_text(start_sequence, end_sequence, actions, truncated=truncated),
    )
