"""Validation helpers for per-test evidence."""

from __future__ import annotations

import hashlib
import re

from faultmesh.project_runner.models import TestPhase

_ADDRESS = re.compile(r"0x[0-9a-fA-F]+")
_DURATION = re.compile(r"\b\d+(?:\.\d+)?(?:ms|s)\b")


def bound_text(value: str | None, limit: int) -> tuple[str | None, bool]:
    if value is None:
        return None, False
    encoded = value.encode("utf-8")
    if len(encoded) <= limit:
        return value, False
    return encoded[:limit].decode("utf-8", errors="ignore"), True


def normalize_failure(value: str) -> str:
    lines = value.replace("\r\n", "\n").replace("\\", "/").splitlines()
    normalized = []
    for line in lines:
        clean = line.rstrip().replace("/workspace/", "<repo>/")
        clean = _ADDRESS.sub("<address>", clean)
        clean = _DURATION.sub("<duration>", clean)
        normalized.append(clean)
    return "\n".join(normalized).strip()


def failure_fingerprint(node_id: str, phase: TestPhase, failure_text: str) -> str:
    payload = f"{node_id}\0{phase.value}\0{normalize_failure(failure_text)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
