from pathlib import Path

from faultmesh.agents import ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.sandbox import LocalSubprocessSandbox
from faultmesh.schemas import ExperimentOutcome, VerificationManifest

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def test_worker_finds_shrunk_stable_boundary_violation() -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    function = next(item for item in index.functions if item.name == "bounded_increment")
    property_spec = ScoutAgent(
        InferenceClient(HeuristicBackend()), ContextBuilder()
    ).inspect(function).response.hypotheses[0].property_spec
    result = LocalSubprocessSandbox(timeout_seconds=20).run(
        EXAMPLE,
        VerificationManifest(
            hypothesis_id="hyp-integration",
            property_spec=property_spec,
            confirmation_runs=3,
        ),
    )
    assert result.outcome == ExperimentOutcome.PROPERTY_VIOLATION
    assert result.counterexample == {"maximum": 0, "value": 0}
    assert result.confirming_failures == result.confirmation_runs == 3
    assert result.failure_fingerprint

