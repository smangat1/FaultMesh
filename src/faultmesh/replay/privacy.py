"""Best-effort redaction applied before replay text reaches durable storage."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

REDACTION_MARKER = "[FAULTMESH_REDACTED]"
TRUNCATION_MARKER = "[FAULTMESH_TRUNCATED]"

_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|token|password|secret)(\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
)


@dataclass(frozen=True)
class HistoryRedaction:
    value: object
    redaction_counts: dict[str, int]
    truncated: bool

    @property
    def redaction_types(self) -> tuple[str, ...]:
        return tuple(sorted(self.redaction_counts))


_PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.S,
)
_GITHUB_TOKEN = re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")
_AWS_ACCESS_KEY = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
_SLACK_TOKEN = re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")
_OPENAI_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b")
_BEARER = re.compile(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/-]{8,}=*")
_URL_PASSWORD = re.compile(
    r"(?i)(?P<scheme>[a-z][a-z0-9+.-]*://)(?P<user>[^:/@\s]+):"
    r"(?P<password>[^/@\s]+)@"
)
_JSON_SECRET = re.compile(
    r'(?P<prefix>"(?P<key>[^"\r\n]+)"\s*:\s*)'
    r'"(?P<value>(?:\\.|[^"\\])*)"'
)
_ESCAPED_JSON_SECRET = re.compile(
    r'(?P<prefix>\\"(?P<key>[^"\\\r\n]+)\\"\s*:\s*\\")'
    r'(?P<value>(?:\\\\.|[^"\\])*)\\"'
)
_ASSIGNMENT_SECRET = re.compile(
    r"(?i)(?P<prefix>\b(?P<key>[A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*)"
    r"(?P<value>\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s#;]+)"
)

_TYPED_PATTERNS = (
    ("private key", _PRIVATE_KEY),
    ("github token", _GITHUB_TOKEN),
    ("aws access key", _AWS_ACCESS_KEY),
    ("slack token", _SLACK_TOKEN),
    ("api key", _OPENAI_KEY),
    ("jwt", _JWT),
)


def _marker(label: str) -> str:
    return f"[redacted: {label}]"


def _sensitive_key_label(key: str) -> str | None:
    normalized = key.lower().replace("-", "_")
    if normalized in {"password", "passwd"} or normalized.endswith(("_password", "_passwd")):
        return "password"
    if normalized == "private_key" or normalized.endswith("_private_key"):
        return "private key"
    if normalized in {"api_key", "access_key"} or normalized.endswith(("_api_key", "_access_key")):
        return "api key"
    if normalized == "token" or normalized.endswith("_token"):
        return "token"
    if normalized == "secret" or normalized.endswith("_secret"):
        return "secret"
    return None


def _increment(counts: dict[str, int], label: str, amount: int = 1) -> None:
    counts[label] = counts.get(label, 0) + amount


def _truncate_history_text(value: str, max_bytes: int) -> tuple[str, bool]:
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value, False
    marker = f"\n{TRUNCATION_MARKER}\n".encode()
    kept = encoded[: max(0, max_bytes - len(marker))]
    while kept:
        try:
            prefix = kept.decode("utf-8")
            break
        except UnicodeDecodeError:
            kept = kept[:-1]
    else:
        prefix = ""
    return prefix + marker.decode(), True


def redact_history_text(value: str, max_bytes: int) -> HistoryRedaction:
    """Redact typed secret patterns before history text is indexed or persisted."""
    redacted = value
    counts: dict[str, int] = {}

    def json_replacement(match: re.Match[str]) -> str:
        label = _sensitive_key_label(match.group("key"))
        if label is None:
            return match.group(0)
        _increment(counts, label)
        return f'{match.group("prefix")}"{_marker(label)}"'

    redacted = _JSON_SECRET.sub(json_replacement, redacted)

    def escaped_json_replacement(match: re.Match[str]) -> str:
        label = _sensitive_key_label(match.group("key"))
        if label is None:
            return match.group(0)
        _increment(counts, label)
        return f'{match.group("prefix")}{_marker(label)}\\"'

    redacted = _ESCAPED_JSON_SECRET.sub(escaped_json_replacement, redacted)

    def assignment_replacement(match: re.Match[str]) -> str:
        label = _sensitive_key_label(match.group("key"))
        if label is None:
            return match.group(0)
        _increment(counts, label)
        raw_value = match.group("value")
        if len(raw_value) >= 2 and raw_value[0] in {'"', "'"} and raw_value[-1] == raw_value[0]:
            return f"{match.group('prefix')}{raw_value[0]}{_marker(label)}{raw_value[0]}"
        suffix = ""
        while raw_value and raw_value[-1] in ",)]}":
            suffix = raw_value[-1] + suffix
            raw_value = raw_value[:-1]
        return f"{match.group('prefix')}{_marker(label)}{suffix}"

    redacted = _ASSIGNMENT_SECRET.sub(assignment_replacement, redacted)
    for label, pattern in _TYPED_PATTERNS:
        redacted, count = pattern.subn(_marker(label), redacted)
        if count:
            _increment(counts, label, count)

    def bearer_replacement(match: re.Match[str]) -> str:
        _increment(counts, "bearer token")
        return f"Bearer {_marker('bearer token')}"

    redacted = _BEARER.sub(bearer_replacement, redacted)

    def url_replacement(match: re.Match[str]) -> str:
        _increment(counts, "url password")
        return f"{match.group('scheme')}{match.group('user')}:{_marker('url password')}@"

    redacted = _URL_PASSWORD.sub(url_replacement, redacted)
    bounded, truncated = _truncate_history_text(redacted, max_bytes)
    return HistoryRedaction(value=bounded, redaction_counts=counts, truncated=truncated)


def _redact_history_value(value: object, max_bytes: int) -> HistoryRedaction:
    if isinstance(value, str):
        return redact_history_text(value, max_bytes)
    if isinstance(value, list):
        output: list[object] = []
        list_counts: dict[str, int] = {}
        truncated = False
        for item in value:
            result = _redact_history_value(item, max_bytes)
            output.append(result.value)
            for label, count in result.redaction_counts.items():
                _increment(list_counts, label, count)
            truncated = truncated or result.truncated
        return HistoryRedaction(output, list_counts, truncated)
    if isinstance(value, dict):
        output_dict: dict[str, object] = {}
        dict_counts: dict[str, int] = {}
        truncated = False
        for raw_key, item in value.items():
            key = str(raw_key)
            sensitive_label = _sensitive_key_label(key)
            if sensitive_label is not None and item not in (None, "", [], {}):
                output_dict[key] = _marker(sensitive_label)
                _increment(dict_counts, sensitive_label)
                continue
            result = _redact_history_value(item, max_bytes)
            output_dict[key] = result.value
            for item_label, count in result.redaction_counts.items():
                _increment(dict_counts, item_label, count)
            truncated = truncated or result.truncated
        serialized = json.dumps(output_dict, sort_keys=True, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > max_bytes:
            bounded, bounded_truncated = _truncate_history_text(serialized, max_bytes)
            return HistoryRedaction(
                {"bounded_json": bounded}, dict_counts, truncated or bounded_truncated
            )
        return HistoryRedaction(output_dict, dict_counts, truncated)
    return HistoryRedaction(value, {}, False)


def redact_history_value(value: object, max_bytes: int) -> HistoryRedaction:
    """Recursively redact history evidence, including values under sensitive keys."""
    return _redact_history_value(value, max_bytes)


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
