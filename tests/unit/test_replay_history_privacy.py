from __future__ import annotations

from faultmesh.replay.privacy import redact_history_text, redact_history_value


def test_history_text_redacts_supported_secret_families_with_typed_markers() -> None:
    samples = {
        "api key": "sk-synthetic0123456789",
        "github token": "ghp_synthetic012345678901234567890123",
        "aws access key": "AKIA0123456789SYNTHX",
        "slack token": "xoxb-synthetic-0123456789",
        "jwt": "eyJsynthetic.eyJpayload.synthetic_signature",
        "bearer token": "Bearer synthetic-credential-value",
        "private key": (
            "-----BEGIN PRIVATE KEY-----\nsynthetic-material\n-----END PRIVATE KEY-----"
        ),
        "url password": "https://synthetic-user:synthetic-password@example.invalid/path",
        "password": "DATABASE_PASSWORD=synthetic-password",
        "secret": "SERVICE_SECRET='synth$tic/@:value'",
    }

    result = redact_history_text("\n".join(samples.values()), 64 * 1024)
    assert isinstance(result.value, str)
    for label, secret in samples.items():
        assert f"[redacted: {label}]" in result.value
        assert secret not in result.value
        assert result.redaction_counts[label] >= 1
    assert not result.truncated


def test_history_value_redacts_sensitive_keys_recursively_and_reports_types() -> None:
    result = redact_history_value(
        {
            "request": {
                "api_key": "synthetic-value",
                "password": ["synthetic", "structured"],
                "safe": "visible",
            },
            "response": {"access_token": {"nested": "synthetic"}},
        },
        64 * 1024,
    )

    assert result.value == {
        "request": {
            "api_key": "[redacted: api key]",
            "password": "[redacted: password]",
            "safe": "visible",
        },
        "response": {"access_token": "[redacted: token]"},
    }
    assert result.redaction_types == ("api key", "password", "token")


def test_history_redaction_avoids_common_code_and_hash_false_positives() -> None:
    safe = "\n".join(
        [
            "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "tokenize(source)",
            "password_hash = compute_hash(value)",
            '{"password_hash": "sha256-value"}',
            '{"token_count": 42}',
            "DEBUG=true",
            "VALUE=1",
            "Bearer",
        ]
    )

    result = redact_history_text(safe, 64 * 1024)
    assert result.value == safe
    assert result.redaction_counts == {}


def test_common_serialized_and_shell_secret_forms_are_redacted_completely() -> None:
    sentinels = [
        "FM_JSON_PASSWORD_SENTINEL!",
        "FM_JSON_API_SENTINEL!",
        "FM_ESCAPED_JSON_SENTINEL!",
        "FM_QUOTED_ENV_PREFIX$FM_QUOTED_ENV_SUFFIX/@:value",
        "FM_ASSIGNMENT_PREFIX$FM_ASSIGNMENT_SUFFIX/@:value",
    ]
    value = "\n".join(
        [
            f'{{"password": "{sentinels[0]}"}}',
            f'{{"api_key": "{sentinels[1]}"}}',
            f'{{\\"password\\":\\"{sentinels[2]}\\"}}',
            f'export DATABASE_PASSWORD="{sentinels[3]}" # synthetic comment',
            f"password={sentinels[4]}",
        ]
    )

    result = redact_history_text(value, 64 * 1024)

    assert isinstance(result.value, str)
    assert all(sentinel not in result.value for sentinel in sentinels)
    assert "FM_QUOTED_ENV_SUFFIX" not in result.value
    assert "FM_ASSIGNMENT_SUFFIX" not in result.value
    assert result.value.count("[redacted: password]") == 4
    assert result.value.count("[redacted: api key]") == 1
    assert result.redaction_types == ("api key", "password")
    assert "# synthetic comment" in result.value


def test_history_redaction_bounds_output_after_redacting() -> None:
    result = redact_history_text(
        "API_KEY=synthetic-secret-value\n" + ("visible " * 100),
        80,
    )

    assert isinstance(result.value, str)
    assert "synthetic-secret-value" not in result.value
    assert "[redacted: api key]" in result.value
    assert result.truncated
    assert len(result.value.encode("utf-8")) <= 80
