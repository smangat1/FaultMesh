#!/usr/bin/env python3
"""Run a disposable Codex capture-boundary probe.

The probe creates one synthetic Git repository, installs project-local synchronous
PreToolUse/PostToolUse hooks, and starts one new Codex CLI session. Raw hook and
CLI JSONL stay under the explicitly printed temporary directory; nothing is read
from historical Codex sessions.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Sequence


SCHEMA_VERSION = "faultmesh-capture-probe-1.0"
IGNORED_PARTS = {".codex", ".git", ".pytest_cache", "__pycache__"}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _snapshot(root: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.py")):
        relative = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in relative.parts) or path.is_symlink():
            continue
        try:
            stat_before = path.stat()
            data = path.read_bytes()
            stat_after = path.stat()
        except (FileNotFoundError, OSError) as exc:
            files.append({"path": relative.as_posix(), "read_error": type(exc).__name__})
            continue
        if (
            stat_before.st_dev,
            stat_before.st_ino,
            stat_before.st_size,
            stat_before.st_mtime_ns,
        ) != (
            stat_after.st_dev,
            stat_after.st_ino,
            stat_after.st_size,
            stat_after.st_mtime_ns,
        ):
            files.append({"path": relative.as_posix(), "read_error": "changed_during_read"})
            continue
        files.append(
            {
                "path": relative.as_posix(),
                "sha256": _sha256(data),
                "size": len(data),
                "mtime_ns": stat_after.st_mtime_ns,
                "content_base64": base64.b64encode(data).decode("ascii"),
            }
        )
    return files


def _append_jsonl(path: Path, value: dict[str, Any]) -> None:
    encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, encoded)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _hook(args: argparse.Namespace) -> int:
    event = json.load(sys.stdin)
    root = Path(args.root).resolve(strict=True)
    record = {
        "schema_version": SCHEMA_VERSION,
        "observed_at": datetime.now(UTC).isoformat(),
        "hook_event_name": event.get("hook_event_name"),
        "session_id": event.get("session_id"),
        "turn_id": event.get("turn_id"),
        "tool_use_id": event.get("tool_use_id"),
        "tool_name": event.get("tool_name"),
        "tool_input": event.get("tool_input"),
        "tool_response": event.get("tool_response"),
        "snapshot": _snapshot(root),
    }
    _append_jsonl(Path(args.events), record)
    return 0


def _hook_command(root: Path, events: Path) -> str:
    return " ".join(
        [
            shlex.quote(sys.executable),
            shlex.quote(str(Path(__file__).resolve())),
            "hook",
            "--root",
            shlex.quote(str(root)),
            "--events",
            shlex.quote(str(events)),
        ]
    )


def _hook_override(event: str, command: str) -> str:
    return (
        f"hooks.{event}=[{{ matcher = \"^(Bash|apply_patch)$\", hooks = [{{ type = "
        f'"command", command = {json.dumps(command)}, timeout = 30 }}] }}]'
    )


def _write_fixture(root: Path, events: Path) -> None:
    root.mkdir(parents=True)
    (root / "calculator.py").write_text(
        '"""Synthetic capture-boundary fixture."""\n\n'
        "\n"
        "def total(values: list[int]) -> int:\n"
        "    return sum(values)\n",
        encoding="utf-8",
    )
    (root / "test_calculator.py").write_text(
        "from calculator import total\n\n\n"
        "def test_total() -> None:\n"
        "    assert total([1, 2, 3]) == 6\n",
        encoding="utf-8",
    )
    hooks_dir = root / ".codex"
    hooks_dir.mkdir()
    hook_command = _hook_command(root, events)
    hooks = {
        "hooks": {
            event: [
                {
                    "matcher": "^(Bash|apply_patch)$",
                    "hooks": [
                        {
                            "type": "command",
                            "command": hook_command,
                            "timeout": 30,
                        }
                    ],
                }
            ]
            for event in ("PreToolUse", "PostToolUse")
        }
    }
    (hooks_dir / "hooks.json").write_text(
        json.dumps(hooks, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(
        ["git", "-C", str(root), "add", "calculator.py", "test_calculator.py"],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=FaultMesh Probe",
            "-c",
            "user.email=probe@example.invalid",
            "commit",
            "-qm",
            "initial synthetic fixture",
        ],
        check=True,
    )


def _prompt(python: str) -> str:
    executable = shlex.quote(python)
    return f"""Work only in this disposable synthetic repository. Perform these steps in order,
using a separate tool call for each numbered step. Do not inspect any parent directory or Codex
history. (1) Use the apply_patch tool, not a shell editor, to change calculator.py so total returns
sum(values) + 1. (2) Run `{executable} -m pytest -q` and retain the failing result. (3) Use one Bash
tool call with a Python one-liner using `{executable}` to replace `return sum(values) + 1` with
`return sum(values)` in calculator.py; do not use apply_patch for this edit. (4) Use Bash to create
created.py containing `VALUE = "created"`. (5) Use Bash to rename created.py to renamed.py. (6) Use
Bash to delete renamed.py. (7) In one Bash tool call, use `{executable}` to write rapid.py three
successive times with the exact contents `STAGE = 1\\n`, then `STAGE = 2\\n`, then `STAGE = 3\\n`,
with no sleep.
(8) Run `{executable} -m pytest -q` and retain the passing result. Do not combine steps. Stop after
reporting which steps completed."""


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def _summarize(root: Path, events_path: Path, trace_path: Path, version: str) -> dict[str, Any]:
    events = _load_jsonl(events_path)
    grouped: dict[str, set[str]] = {}
    tools: dict[str, str] = {}
    for event in events:
        tool_use_id = event.get("tool_use_id")
        if isinstance(tool_use_id, str):
            grouped.setdefault(tool_use_id, set()).add(str(event.get("hook_event_name")))
            tools[tool_use_id] = str(event.get("tool_name"))
    complete = [
        tool_id
        for tool_id, names in grouped.items()
        if names == {"PreToolUse", "PostToolUse"}
    ]
    trace = _load_jsonl(trace_path)
    final_files = {item["path"]: item for item in _snapshot(root)}
    calculator = base64.b64decode(final_files["calculator.py"]["content_base64"])
    rapid = base64.b64decode(final_files["rapid.py"]["content_base64"])
    return {
        "schema_version": SCHEMA_VERSION,
        "codex_version": version,
        "hook_records": len(events),
        "complete_tool_boundaries": len(complete),
        "complete_tool_names": [tools[tool_id] for tool_id in complete],
        "cli_jsonl_records": len(trace),
        "apply_patch_boundary_observed": any(tools[item] == "apply_patch" for item in complete),
        "bash_boundary_observed": any(tools[item] == "Bash" for item in complete),
        "final_calculator_restored": b"return sum(values)\n" in calculator,
        "rapid_final_stage_observed": rapid == b"STAGE = 3\n",
        "created_then_deleted_absent": (
            "created.py" not in final_files and "renamed.py" not in final_files
        ),
        "final_snapshot": [
            {"path": item["path"], "sha256": item.get("sha256"), "size": item.get("size")}
            for item in final_files.values()
        ],
    }


def _probe(args: argparse.Namespace) -> int:
    codex = Path(args.codex or shutil.which("codex") or "")
    if not codex.is_file():
        raise SystemExit("Codex executable was not found; pass --codex")
    output = Path(args.output).resolve() if args.output else Path(
        tempfile.mkdtemp(prefix="faultmesh-capture-boundary-")
    )
    if args.output:
        output.mkdir(parents=True, exist_ok=False)
    fixture = output / "fixture"
    evidence = output / "evidence"
    evidence.mkdir()
    events = evidence / "hooks.jsonl"
    trace = evidence / "codex-exec.jsonl"
    stderr_path = evidence / "codex-exec.stderr"
    _write_fixture(fixture, events)
    _append_jsonl(
        events,
        {
            "schema_version": SCHEMA_VERSION,
            "observed_at": datetime.now(UTC).isoformat(),
            "hook_event_name": "InitialSnapshot",
            "session_id": None,
            "turn_id": None,
            "tool_use_id": None,
            "tool_name": None,
            "tool_input": None,
            "tool_response": None,
            "snapshot": _snapshot(fixture),
        },
    )
    version_result = subprocess.run(
        [str(codex), "--version"], capture_output=True, text=True, check=True
    )
    pytest_check: Sequence[str] = [sys.executable, "-m", "pytest", "--version"]
    if subprocess.run(pytest_check, capture_output=True, check=False).returncode != 0:
        raise SystemExit(f"{sys.executable} does not provide pytest")
    command = [
        str(codex),
        "exec",
        "--json",
        "--ignore-user-config",
        "--dangerously-bypass-approvals-and-sandbox",
        "--dangerously-bypass-hook-trust",
        "-c",
        _hook_override("PreToolUse", _hook_command(fixture, events)),
        "-c",
        _hook_override("PostToolUse", _hook_command(fixture, events)),
        "-C",
        str(fixture),
        _prompt(sys.executable),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired as exc:
        trace.write_text(exc.stdout or "", encoding="utf-8")
        stderr_path.write_text(exc.stderr or "", encoding="utf-8")
        print(f"probe timed out; raw evidence retained at {output}", file=sys.stderr)
        return 2
    trace.write_text(completed.stdout, encoding="utf-8")
    stderr_path.write_text(completed.stderr, encoding="utf-8")
    summary = _summarize(fixture, events, trace, version_result.stdout.strip())
    summary["codex_exit_code"] = completed.returncode
    summary_path = evidence / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "summary": summary}, indent=2, sort_keys=True))
    required = (
        completed.returncode == 0
        and summary["apply_patch_boundary_observed"]
        and summary["bash_boundary_observed"]
        and summary["final_calculator_restored"]
        and summary["rapid_final_stage_observed"]
        and summary["created_then_deleted_absent"]
    )
    return 0 if required else 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    hook = subparsers.add_parser("hook")
    hook.add_argument("--root", required=True)
    hook.add_argument("--events", required=True)
    hook.set_defaults(handler=_hook)
    probe = subparsers.add_parser("probe")
    probe.add_argument("--codex")
    probe.add_argument("--output")
    probe.add_argument("--timeout", type=int, default=900)
    probe.set_defaults(handler=_probe)
    return parser


def main() -> int:
    args = _parser().parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
