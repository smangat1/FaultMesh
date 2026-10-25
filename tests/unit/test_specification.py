from pathlib import Path

import pytest

from faultmesh.agents import ScoutAgent
from faultmesh.analysis import ContextBuilder, ProjectAnalyzer
from faultmesh.inference import HeuristicBackend, InferenceClient
from faultmesh.verification import SpecificationError, SpecificationValidator

EXAMPLE = Path(__file__).parents[2] / "examples" / "buggy_python_project"


def test_validator_rejects_stale_source_hash() -> None:
    index = ProjectAnalyzer().analyze(EXAMPLE)
    function = next(item for item in index.functions if item.name == "bounded_increment")
    proposed = ScoutAgent(InferenceClient(HeuristicBackend()), ContextBuilder()).inspect(
        function
    ).response.hypotheses[0]
    proposed.property_spec.target.content_hash = "stale"
    with pytest.raises(SpecificationError, match="hash"):
        SpecificationValidator().validate(proposed.property_spec, index)

