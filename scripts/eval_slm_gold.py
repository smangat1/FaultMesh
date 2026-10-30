#!/usr/bin/env python3
"""Evaluate synthetic SLM claim proposals with the deterministic replay checker."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from faultmesh.replay.slm_gold import (
    DEFAULT_GOLD_PATH,
    evaluate_checker_baseline,
    evaluate_with_configured_model,
    load_gold_cases,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_GOLD_PATH)
    parser.add_argument("--model", action="store_true", help="Run the configured local model.")
    args = parser.parse_args()
    cases = load_gold_cases(args.cases)
    try:
        result = (
            evaluate_with_configured_model(cases)
            if args.model
            else evaluate_checker_baseline(cases)
        )
    except RuntimeError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
