"""Pytest plugin that records coverage contexts without changing target source."""

from __future__ import annotations

import base64
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Protocol

from coverage import Coverage

SCHEMA_VERSION = "1.0"
INSTRUMENTATION_VERSION = "coverage-contexts-1.0"

_coverage: Coverage | None = None
_errors: list[str] = []


class _PytestItem(Protocol):
    nodeid: str


def _context(node_id: str, phase: str) -> str:
    encoded = base64.urlsafe_b64encode(node_id.encode()).decode().rstrip("=")
    return f"faultmesh:{phase}:{encoded}"


def _decode(value: str) -> tuple[str | None, str]:
    if value == "collection":
        return None, "collection"
    prefix, phase, encoded = value.split(":", 2)
    if prefix != "faultmesh" or phase not in {"setup", "call", "teardown"}:
        raise ValueError(f"unknown coverage context: {value}")
    padding = "=" * (-len(encoded) % 4)
    return base64.urlsafe_b64decode(encoded + padding).decode(), phase


def pytest_configure() -> None:
    global _coverage
    try:
        _coverage = Coverage(data_file="/output/.coverage", source=["/workspace"])
        _coverage.start()
        _coverage.switch_context("collection")
    except Exception as exc:  # pragma: no cover - runs only in the prepared container
        _errors.append(f"coverage start failed: {type(exc).__name__}: {exc}")
        _coverage = None


def _switch(node_id: str, phase: str) -> None:
    if _coverage is None:
        return
    try:
        _coverage.switch_context(_context(node_id, phase))
    except Exception as exc:  # pragma: no cover - defensive container boundary
        _errors.append(f"context switch failed: {type(exc).__name__}: {exc}")


def pytest_runtest_setup(item: _PytestItem) -> None:
    _switch(str(item.nodeid), "setup")


def pytest_runtest_call(item: _PytestItem) -> None:
    _switch(str(item.nodeid), "call")


def pytest_runtest_teardown(item: _PytestItem) -> None:
    _switch(str(item.nodeid), "teardown")


def _packages() -> list[str]:
    values = {
        f"{distribution.metadata['Name'] or 'unknown'}=={distribution.version}"
        for distribution in importlib.metadata.distributions()
    }
    return sorted(values, key=str.casefold)


def pytest_sessionfinish() -> None:
    files: list[dict[str, object]] = []
    completed = False
    if _coverage is not None:
        try:
            _coverage.stop()
            _coverage.save()
            data = _coverage.get_data()
            for filename in sorted(data.measured_files()):
                grouped: dict[tuple[str | None, str], set[int]] = {}
                for line, contexts in data.contexts_by_lineno(filename).items():
                    for context in contexts:
                        try:
                            key = _decode(context)
                        except (ValueError, UnicodeError) as exc:
                            _errors.append(str(exc))
                            continue
                        grouped.setdefault(key, set()).add(line)
                files.append(
                    {
                        "path": filename,
                        "contexts": [
                            {"node_id": node_id, "phase": phase, "lines": sorted(lines)}
                            for (node_id, phase), lines in sorted(
                                grouped.items(), key=lambda item: (item[0][1], item[0][0] or "")
                            )
                        ],
                    }
                )
            completed = not _errors
        except Exception as exc:  # pragma: no cover - defensive container boundary
            _errors.append(f"coverage export failed: {type(exc).__name__}: {exc}")
    output = Path(os.environ.get("FAULTMESH_OBSERVE_OUT", "/output/observation.json"))
    output.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "instrumentation_version": INSTRUMENTATION_VERSION,
                "completed": completed,
                "files": files,
                "installed_packages": _packages(),
                "errors": _errors,
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )
