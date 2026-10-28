"""Best-effort redaction applied before replay text reaches durable storage."""

from __future__ import annotations

import json
import re

REDACTION_MARKER = "[FAULTMESH_REDACTED]"
TRUNCATION_MARKER = "[FAULTMESH_TRUNCATED]"

_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|token|password|secret)(\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
)


def redact_text(value: str, max_bytes: int) -> tuple[str, bool, bool]:
    redacted = value
    changed = False
    for pattern in _PATTERNS:
        if pattern.groups >= 3:
            redacted, count = pattern.subn(rf"\1\2{REDACTION_MARKER}", redacted)
        else:
            redacted, count = pattern.subn(REDACTION_MARKER, redacted)
        changed = changed or count > 0
    encoded = redacted.encode("utf-8")
    if len(encoded) <= max_bytes:
        return redacted, changed, False
    marker = f"\n{TRUNCATION_MARKER}\n".encode()
    kept = encoded[: max(0, max_bytes - len(marker))]
    while True:
        try:
            prefix = kept.decode("utf-8")
            break
        except UnicodeDecodeError:
            kept = kept[:-1]
    return prefix + marker.decode(), changed, True


def redact_value(value: object, max_bytes: int) -> tuple[object, bool, bool]:
    if isinstance(value, str):
        return redact_text(value, max_bytes)
    if isinstance(value, list):
        output: list[object] = []
        redacted = False
        truncated = False
        for item in value:
            clean, item_redacted, item_truncated = redact_value(item, max_bytes)
            output.append(clean)
            redacted = redacted or item_redacted
            truncated = truncated or item_truncated
        return output, redacted, truncated
    if isinstance(value, dict):
        output_dict: dict[str, object] = {}
        redacted = False
        truncated = False
        for key, item in value.items():
            clean, item_redacted, item_truncated = redact_value(item, max_bytes)
            output_dict[str(key)] = clean
            redacted = redacted or item_redacted
            truncated = truncated or item_truncated
        serialized = json.dumps(output_dict, sort_keys=True, separators=(",", ":"))
        if len(serialized.encode()) > max_bytes:
            text, text_redacted, _text_truncated = redact_text(serialized, max_bytes)
            return {"bounded_json": text}, redacted or text_redacted, True
        return output_dict, redacted, truncated
    return value, False, False
