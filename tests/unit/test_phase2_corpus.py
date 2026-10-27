from __future__ import annotations

import hashlib
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).parents[2]
MANIFEST = ROOT / "benchmarks" / "phase-2-pilot.lock.toml"


def _locked() -> dict[str, object]:
    with MANIFEST.open("rb") as handle:
        return tomllib.load(handle)


def test_phase2_lock_freezes_required_population_and_budgets() -> None:
    locked = _locked()
    cases = locked["cases"]
    assert isinstance(cases, list)
    assert len(cases) == 12
    assert sum(case["split"] == "development" for case in cases) == 4
    assert sum(case["split"] == "heldout" for case in cases) == 8
    assert {case["input_family"] for case in cases} == {"int", "str", "list[int]"}
    budgets = locked["budgets"]
    assert budgets == {
        "arms": ["slm-only", "baseline-only", "combined", "heuristic-ablation"],
        "proposal_configurations": ["current-main", "a", "ab", "abc"],
        "seeds": [11, 23, 37, 53, 71],
        "max_properties": 4,
        "max_examples": 200,
        "confirmation_runs": 3,
        "max_model_calls": 2,
        "max_repairs": 2,
        "verifier_timeout_seconds": 30,
        "inference_timeout_seconds": 120,
        "end_to_end_wall_time_seconds": 300,
    }


def test_phase2_sources_match_lock_and_historical_provenance_is_complete() -> None:
    cases = _locked()["cases"]
    assert isinstance(cases, list)
    historical = 0
    for case in cases:
        for variant in ("buggy", "corrected"):
            source = ROOT / "benchmarks" / case[f"{variant}_path"]
            assert hashlib.sha256(source.read_bytes()).hexdigest() == case[
                f"{variant}_sha256"
            ]
        if case["provenance_kind"] == "historical":
            historical += 1
            for field in (
                "repository_url",
                "source_commit",
                "fix_commit",
                "license",
                "original_path",
                "adaptation",
            ):
                assert case[field]
    assert historical == 4


def test_private_canary_and_labels_are_absent_from_every_target_source() -> None:
    private = json.loads(
        (ROOT / "benchmarks/phase2_corpus/private/adjudication.json").read_text(
            encoding="utf-8"
        )
    )
    canary = private["context_isolation_canary"]
    forbidden = (canary, "expected_oracles", "adjudication", "defect label")
    for source in (ROOT / "benchmarks/phase2_corpus/sources").glob("*/*.py"):
        text = source.read_text(encoding="utf-8")
        assert all(secret not in text for secret in forbidden)
