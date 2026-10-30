"""Synthetic gold-set loading and deterministic/local-model evaluation."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from faultmesh.inference.backends import LlamaCppServerBackend
from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimNarrator,
    ClaimVerdict,
    ClaimVerdictName,
    EvidencePacket,
    TypedClaim,
    packet_hash,
)
from faultmesh.replay.llama_server import LlamaServer
from faultmesh.replay.model_manager import load_model_settings, model_status
from faultmesh.replay.narration import MODEL_PRESETS

DEFAULT_GOLD_PATH = Path(__file__).resolve().parents[3] / "benchmarks/replay/slm_gold/cases.json"


@dataclass(frozen=True)
class GoldCase:
    id: str
    packet: EvidencePacket
    claim: TypedClaim
    expected_verdict: ClaimVerdictName


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{label} must be a JSON object")
    return cast(dict[str, Any], value)


def _build_packet(raw: object, case_id: str) -> EvidencePacket:
    data = _require_mapping(raw, f"{case_id}.packet").copy()
    session_id = f"gold:{case_id}"
    sequence = 1
    sources = []
    for source_raw in cast(list[object], data.get("sources", [])):
        source = _require_mapping(source_raw, f"{case_id}.packet.sources[]").copy()
        source.setdefault("session_id", session_id)
        source.setdefault("sequence", sequence)
        sources.append(source)
    data.update(
        {
            "session_id": session_id,
            "checkpoint_id": f"checkpoint:{case_id}",
            "sequence": sequence,
            "sources": sources,
            "evidence_hash": "0" * 64,
        }
    )
    draft = EvidencePacket.model_validate(data)
    return draft.model_copy(update={"evidence_hash": packet_hash(draft)})


def load_gold_cases(path: Path = DEFAULT_GOLD_PATH) -> list[GoldCase]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("gold set must be a non-empty JSON array")
    cases: list[GoldCase] = []
    seen: set[str] = set()
    for index, item_raw in enumerate(raw):
        item = _require_mapping(item_raw, f"cases[{index}]")
        case_id = item.get("id")
        if not isinstance(case_id, str) or not case_id or case_id in seen:
            raise ValueError("gold case ids must be non-empty and unique")
        expected_raw = item.get("expected_verdict")
        if not isinstance(expected_raw, str):
            raise ValueError(f"{case_id}.expected_verdict must be a string")
        seen.add(case_id)
        cases.append(
            GoldCase(
                case_id,
                _build_packet(item.get("packet"), case_id),
                TypedClaim.model_validate(item.get("claim")),
                ClaimVerdictName(expected_raw),
            )
        )
    return cases


def _stats(
    cases: list[GoldCase],
    verdicts: Iterable[ClaimVerdict],
    *,
    fallback_count: int,
    expected_matches: int,
    unknowns_stayed_unknown: int,
    mode: str,
) -> dict[str, int | float | str]:
    verdict_list = list(verdicts)
    counts = Counter(verdict.verdict for verdict in verdict_list)
    return {
        "mode": mode,
        "cases": len(cases),
        "claims_checked": len(verdict_list),
        "green": counts[ClaimVerdictName.SUPPORTED],
        "yellow": counts[ClaimVerdictName.UNKNOWN],
        "red": counts[ClaimVerdictName.CONTRADICTED],
        "rejected_or_downgraded": (
            counts[ClaimVerdictName.UNKNOWN] + counts[ClaimVerdictName.CONTRADICTED]
        ),
        "unknowns_stayed_unknown": unknowns_stayed_unknown,
        "expected_matches": expected_matches,
        "fallback_rate": fallback_count / len(cases),
    }


def evaluate_checker_baseline(cases: list[GoldCase]) -> dict[str, int | float | str]:
    checker = ClaimChecker()
    verdicts = [checker.check(case.packet, case.claim) for case in cases]
    matches = sum(
        verdict.verdict == case.expected_verdict
        for case, verdict in zip(cases, verdicts, strict=True)
    )
    unknowns_stayed = sum(
        case.expected_verdict == ClaimVerdictName.UNKNOWN
        and verdict.verdict == ClaimVerdictName.UNKNOWN
        for case, verdict in zip(cases, verdicts, strict=True)
    )
    return _stats(
        cases,
        verdicts,
        fallback_count=len(cases),
        expected_matches=matches,
        unknowns_stayed_unknown=unknowns_stayed,
        mode="checker_only_no_model",
    )


def evaluate_with_configured_model(cases: list[GoldCase]) -> dict[str, int | float | str]:
    settings = load_model_settings()
    status = model_status(settings)
    if not status.ready or settings.selected_model_path is None:
        raise RuntimeError(status.message)
    preset = MODEL_PRESETS[settings.preset]
    baseline_checker = ClaimChecker()
    expected_matches = sum(
        baseline_checker.check(case.packet, case.claim).verdict == case.expected_verdict
        for case in cases
    )
    unknowns_stayed = sum(
        case.expected_verdict == ClaimVerdictName.UNKNOWN
        and baseline_checker.check(case.packet, case.claim).verdict == ClaimVerdictName.UNKNOWN
        for case in cases
    )
    with LlamaServer(
        settings.llama_server_executable,
        Path(settings.selected_model_path),
        context_size=preset.context_size,
        startup_timeout=preset.timeout_seconds,
    ) as server:
        server_status = server.start()
        if not server_status.ready or server_status.endpoint is None:
            raise RuntimeError(server_status.message)
        backend = LlamaCppServerBackend(
            server_status.endpoint,
            model=Path(settings.selected_model_path).name,
            timeout_seconds=preset.timeout_seconds,
            max_output_tokens=preset.max_output_tokens,
        )
        runs = [
            ClaimNarrator(backend, model_config_id=f"gold:{settings.preset}").run(case.packet)
            for case in cases
        ]
    return _stats(
        cases,
        [verdict for run in runs for verdict in run.verdicts],
        fallback_count=sum(run.fallback_used for run in runs),
        expected_matches=expected_matches,
        unknowns_stayed_unknown=unknowns_stayed,
        mode=f"local_model_{settings.preset}",
    )
