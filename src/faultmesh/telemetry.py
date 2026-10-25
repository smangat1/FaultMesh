"""Small structured logging surface with conservative field redaction."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any, TextIO

LOGGER_NAME = "faultmesh"
SENSITIVE_FRAGMENTS = ("password", "secret", "token", "credential", "api_key")


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if any(fragment in key.lower() for fragment in SENSITIVE_FRAGMENTS)
            else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": getattr(record, "event", "log"),
            "message": record.getMessage(),
            "data": _redact(getattr(record, "data", {})),
        }
        return json.dumps(payload, sort_keys=True, default=str)


def configure_json_logging(*, stream: TextIO | None = None) -> None:
    logger = logging.getLogger(LOGGER_NAME)
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def log_event(event: str, message: str, **data: Any) -> None:
    logging.getLogger(LOGGER_NAME).info(
        message,
        extra={"event": event, "data": data},
    )

