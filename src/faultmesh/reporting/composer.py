"""Deterministic, evidence-backed report rendering."""

from __future__ import annotations

import json

from faultmesh.schemas import HypothesisRecord, Incident


class ReportComposer:
    def markdown(self, incident: Incident, hypothesis: HypothesisRecord) -> str:
        references = "\n".join(
            f"- `{reference.path}:{reference.start_line}-{reference.end_line}`"
            for reference in incident.affected_references
        )
        assumptions = "\n".join(f"- {item}" for item in incident.unresolved_assumptions)
        limitations = "\n".join(f"- {item}" for item in incident.limitations)
        artifacts = ""
        if incident.artifacts:
            artifacts = (
                f"- Regression test: `{incident.artifacts.regression_test}`\n"
                f"- Replay manifest: `{incident.artifacts.replay_manifest}`\n"
                f"- Incident JSON: `{incident.artifacts.incident_json}`"
            )
        return f"""# {incident.title}

**Verification status:** `{incident.verification_status.value}`  
**Incident:** `{incident.id}`  
**Hypothesis:** `{incident.hypothesis_id}`  
**Model confidence (not verification):** {incident.confidence:.2f}

## Summary

FaultMesh observed a stable violation of an explicit property for
`{incident.affected_function}`. The failure reproduced in
{incident.confirming_failures}/{incident.confirmation_runs} confirmation runs
({incident.reproduction_rate:.1%}).

## Affected source

{references}

## Expected behavior and evidence

{incident.expected_behavior}

Oracle: {hypothesis.property_spec.oracle_explanation}

Contract citation: {hypothesis.property_spec.contract_citation or '(legacy schema 1.0 property)'}

## Observed behavior

{incident.observed_behavior}

Counterexample:

```json
{json.dumps(incident.counterexample, indent=2, sort_keys=True)}
```

Failure fingerprint: `{incident.failure_fingerprint}`

## Reproduction

Required environment:

```json
{json.dumps(incident.required_environment, indent=2, sort_keys=True)}
```

Seed: `{incident.seed}`

```console
{incident.exact_command}
```

## Investigation

Suspected cause (not independently verified): {incident.suspected_cause}

Captured failure output:

```text
{incident.stack_trace[-6000:] or '(no stack trace emitted)'}
```

### Unresolved assumptions

{assumptions or '- None recorded.'}

### Limitations

{limitations}

## Artifacts

{artifacts}
"""

