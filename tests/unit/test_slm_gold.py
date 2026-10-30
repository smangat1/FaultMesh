from faultmesh.replay.claims import ClaimChecker, ClaimVerdictName
from faultmesh.replay.slm_gold import evaluate_checker_baseline, load_gold_cases


def test_gold_cases_load_and_schema_valid() -> None:
    cases = load_gold_cases()
    result = evaluate_checker_baseline(cases)

    assert len(cases) == 9
    assert result["expected_matches"] == len(cases)


def test_unknown_case_stays_unknown() -> None:
    case = next(item for item in load_gold_cases() if item.id == "derived-incomplete-yellow")

    verdict = ClaimChecker().check(case.packet, case.claim)

    assert verdict.verdict == ClaimVerdictName.UNKNOWN
    assert verdict.reason_code == "derived_file_state_unavailable"


def test_misleading_claim_is_red() -> None:
    case = next(item for item in load_gold_cases() if item.id == "misleading-file-hash-red")

    verdict = ClaimChecker().check(case.packet, case.claim)

    assert verdict.verdict == ClaimVerdictName.CONTRADICTED
