from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from faultmesh.schemas import (
    ArgumentSpec,
    ExperimentOutcome,
    IntegerStrategy,
    PropertySpec,
    ResultBoundOracle,
    SourceReference,
    VerificationManifest,
)
from faultmesh.verification.worker import execute


def _manifest(
    repository: Path,
    source: str,
    *,
    content_hash: str | None = None,
    counterexample: dict[str, object] | None = None,
) -> VerificationManifest:
    target = repository / "target.py"
    target.write_text(source, encoding="utf-8")
    digest = content_hash or hashlib.sha256(source.encode("utf-8")).hexdigest()
    reference = SourceReference(
        path="target.py",
        start_line=1,
        end_line=len(source.splitlines()),
        content_hash=digest,
    )
    return VerificationManifest(
        hypothesis_id="hyp-worker-unit",
        property_spec=PropertySpec(
            target=reference,
            qualified_name="bounded",
            arguments=[
                ArgumentSpec(
                    name=name,
                    strategy=IntegerStrategy(minimum=0, maximum=10),
                )
                for name in ("value", "maximum")
            ],
            constraints=[],
            oracle=ResultBoundOracle(kind="result_le_arg", argument="maximum"),
            oracle_explanation="Result must not exceed maximum.",
            evidence=[reference],
        ),
        mode="replay",
        counterexample=(
            {"value": 0, "maximum": 0} if counterexample is None else counterexample
        ),
    )


def test_worker_rejects_changed_source_before_import(tmp_path: Path) -> None:
    marker = tmp_path / "imported"
    source = (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('executed')\n"
        "def bounded(value: int, maximum: int) -> int:\n"
        "    return value\n"
    )
    manifest = _manifest(tmp_path, source, content_hash="stale")

    result = execute(tmp_path, manifest)

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "content hash changed" in result.observed
    assert not marker.exists()


@pytest.mark.parametrize(
    "counterexample",
    [
        {},
        {"value": 0, "maximum": 0, "extra": 0},
        {"value": True, "maximum": 0},
        {"value": 11, "maximum": 0},
    ],
)
def test_worker_rejects_replay_inputs_outside_declared_domain(
    tmp_path: Path, counterexample: dict[str, object]
) -> None:
    manifest = _manifest(
        tmp_path,
        "def bounded(value: int, maximum: int) -> int:\n    return value\n",
        counterexample=counterexample,
    )

    result = execute(tmp_path, manifest)

    assert result.outcome == ExperimentOutcome.HARNESS_ERROR
    assert "declared property input domain" in result.observed


def test_worker_registers_module_for_standard_decorators(tmp_path: Path) -> None:
    source = (
        "from dataclasses import dataclass\n"
        "@dataclass\n"
        "class Limit:\n"
        "    value: int\n"
        "def bounded(value: int, maximum: int) -> int:\n"
        "    return min(value, Limit(maximum).value)\n"
    )
    manifest = _manifest(
        tmp_path,
        source,
        counterexample={"value": 1, "maximum": 1},
    )

    result = execute(tmp_path, manifest)

    assert result.outcome == ExperimentOutcome.NO_VIOLATION
