"""Perform editor-like changes against a throwaway FaultMesh example copy."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path


def announce(action: str, path: Path) -> None:
    print(json.dumps({"action": action, "path": path.as_posix()}), flush=True)


def pause(seconds: float) -> None:
    time.sleep(seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--delay", type=float, default=0.55)
    arguments = parser.parse_args()
    target = arguments.root / "src" / "buggy_python_project" / "bounds.py"
    added = "\n\ndef live_demo_added(value: int) -> int:\n    return value * 2\n"

    text = target.read_text(encoding="utf-8")
    target.write_text(text.replace("if value <= maximum:", "if value < maximum:"), encoding="utf-8")
    announce("in_place_write", target)
    pause(arguments.delay)

    text = target.read_text(encoding="utf-8").replace(
        "# Seeded bug: equality must not be incremented.", "# Atomic-save demonstration."
    )
    temporary = target.with_name(".bounds.py.faultmesh-tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, target)
    announce("atomic_temp_rename", target)
    pause(arguments.delay)

    target.write_text(target.read_text(encoding="utf-8") + added, encoding="utf-8")
    announce("add_function", target)
    pause(arguments.delay)

    target.write_text(target.read_text(encoding="utf-8").replace(added, ""), encoding="utf-8")
    announce("delete_function", target)
    pause(arguments.delay)

    target.write_text(
        target.read_text(encoding="utf-8").replace(
            "def bounded_increment(value: int, maximum: int) -> int:",
            "def bounded_increment(value: int, maximum: int -> int:",
        ),
        encoding="utf-8",
    )
    announce("introduce_syntax_error", target)
    pause(arguments.delay)

    target.write_text(
        target.read_text(encoding="utf-8").replace(
            "def bounded_increment(value: int, maximum: int -> int:",
            "def bounded_increment(value: int, maximum: int) -> int:",
        ),
        encoding="utf-8",
    )
    announce("fix_syntax_error", target)
    pause(arguments.delay)

    target.unlink()
    announce("delete_file", target)
    pause(arguments.delay)

    created = target.with_name("live_created.py")
    created.write_text("def created_live() -> str:\n    return 'stable'\n", encoding="utf-8")
    announce("create_file", created)
    pause(arguments.delay)


if __name__ == "__main__":
    main()
