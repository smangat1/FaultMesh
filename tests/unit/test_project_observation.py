from __future__ import annotations

import json
from pathlib import Path

import pytest

from faultmesh.project_runner.models import (
    ObservationStatus,
)
from faultmesh.project_runner.models import (
    TestCaseRecord as CaseRecord,
)
from faultmesh.project_runner.models import (
    TestOutcome as CaseOutcome,
)
from faultmesh.project_runner.observation import (
    ObservationError,
    apply_observations,
    build_source_snapshot,
    read_json_artifact,
)
from faultmesh.project_runner.runner import (
    ProjectRunnerError,
    _validate_observed_command,
    parse_test_cases,
)


def _case(run_id: str, node_id: str) -> CaseRecord:
    return CaseRecord(run_id=run_id, node_id=node_id, outcome=CaseOutcome.PASSED, phases=[])


def test_snapshot_and_mapping_keep_nested_decorated_and_async_symbols_distinct(
    tmp_path: Path,
) -> None:
    source = """def deco(fn):
    return fn

@deco
def outer(value):
    def nested(item):
        return item + 1
    return nested(value)

class Worker:
    @deco
    async def compute(self, value):
        return value * 2
"""
    (tmp_path / "pkg.py").write_text(source, encoding="utf-8")
    snapshot = build_source_snapshot(tmp_path, revision="a" * 40, content_sha256="b" * 64)
    by_name = {
        symbol.qualified_name: symbol
        for file in snapshot.files
        for symbol in file.symbols
    }
    assert 4 not in by_name["outer"].executable_lines
    assert 7 not in by_name["outer"].executable_lines
    assert 7 in by_name["outer.nested"].executable_lines
    assert 13 in by_name["Worker.compute"].executable_lines

    first = "tests/test_pkg.py::test_outer[hello world]"
    second = "tests/test_pkg.py::test_async"
    raw = {
        "schema_version": "1.0",
        "instrumentation_version": "coverage-contexts-1.0",
        "completed": True,
        "installed_packages": ["coverage==7.10.7"],
        "errors": [],
        "files": [
            {
                "path": "/workspace/pkg.py",
                "contexts": [
                    {"node_id": None, "phase": "collection", "lines": [1, 2, 4]},
                    {"node_id": first, "phase": "call", "lines": [7, 8]},
                    {"node_id": second, "phase": "call", "lines": [13]},
                ],
            }
        ],
    }
    records, status, collection, packages = apply_observations(
        raw,
        snapshot=snapshot,
        tests=[_case("run-a", first), _case("run-a", second)],
    )
    assert status == ObservationStatus.COMPLETE
    assert packages == ["coverage==7.10.7"]
    assert collection[0].lines == [1, 2, 4]
    first_observation = records[0].observation
    second_observation = records[1].observation
    assert first_observation is not None and second_observation is not None
    assert {symbol.qualified_name for symbol in first_observation.symbols} == {
        "outer",
        "outer.nested",
    }
    assert {symbol.qualified_name for symbol in second_observation.symbols} == {
        "Worker.compute"
    }


def test_unknown_context_makes_observation_incomplete(tmp_path: Path) -> None:
    (tmp_path / "pkg.py").write_text("def value():\n    return 1\n", encoding="utf-8")
    snapshot = build_source_snapshot(tmp_path, revision="a" * 40, content_sha256="b" * 64)
    raw = {
        "schema_version": "1.0",
        "instrumentation_version": "coverage-contexts-1.0",
        "completed": True,
        "installed_packages": [],
        "errors": [],
        "files": [
            {
                "path": "/workspace/pkg.py",
                "contexts": [
                    {"node_id": "unknown", "phase": "call", "lines": [2]},
                ],
            }
        ],
    }
    records, status, _, _ = apply_observations(
        raw, snapshot=snapshot, tests=[_case("run-a", "tests/test_pkg.py::test_value")]
    )
    assert status == ObservationStatus.INCOMPLETE
    assert records[0].observation is not None
    assert records[0].observation.status == ObservationStatus.INCOMPLETE
    assert records[0].observation.unknown_contexts == ["unknown"]


def test_artifact_reader_rejects_symlink_and_oversized_input(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    (run_dir / "linked.json").symlink_to(outside)
    with pytest.raises(ObservationError, match="symlink"):
        read_json_artifact(run_dir / "linked.json", run_dir, 100)
    large = run_dir / "large.json"
    large.write_text(json.dumps({"value": "x" * 100}), encoding="utf-8")
    with pytest.raises(ObservationError, match="exceeds"):
        read_json_artifact(large, run_dir, 20)


def test_phase_results_preserve_fixture_error_skip_and_xfail() -> None:
    raw = {
        "tests": [
            {
                "nodeid": "tests/test_x.py::test_setup",
                "outcome": "failed",
                "setup": {"duration": 0.1, "outcome": "failed", "longrepr": "boom"},
                "teardown": {"duration": 0.1, "outcome": "passed"},
            },
            {
                "nodeid": "tests/test_x.py::test_skip",
                "outcome": "skipped",
                "setup": {"duration": 0.1, "outcome": "skipped"},
            },
            {
                "nodeid": "tests/test_x.py::test_xfail[value with spaces]",
                "outcome": "xfailed",
                "setup": {"duration": 0.1, "outcome": "passed"},
                "call": {"duration": 0.1, "outcome": "skipped", "wasxfail": "reason"},
                "teardown": {"duration": 0.1, "outcome": "passed"},
            },
        ]
    }
    records = parse_test_cases(raw, "run-a", 1000)
    assert [record.outcome for record in records] == [
        CaseOutcome.ERROR,
        CaseOutcome.SKIPPED,
        CaseOutcome.XFAILED,
    ]
    assert records[0].failure_fingerprint is not None


@pytest.mark.parametrize("option", ["-n", "--numprocesses=2", "--cov=pkg", "-p"])
def test_observation_rejects_unsupported_parallel_or_plugin_options(option: str) -> None:
    with pytest.raises(ProjectRunnerError, match="does not support|owns"):
        _validate_observed_command(["python", "-m", "pytest", option])
