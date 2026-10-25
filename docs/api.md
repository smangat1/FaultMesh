# Python API

FaultMesh's Milestone 1 public API is intentionally small:

```python
from pathlib import Path

from faultmesh import AnalysisOptions, analyze_repository, reproduce_incident

summary = analyze_repository(
    Path("./repository"),
    AnalysisOptions(model="llama-server"),
)
for incident in summary.incidents:
    print(incident.id, incident.verification_status)

result = reproduce_incident(Path("./repository"), "inc-...your id...")
```

`AnalysisOptions.allow_local_execution` defaults to `False`. That means untrusted code is delegated
to Docker. Set it only for a repository you trust; the local subprocess runner is not a security
boundary.

The Pydantic objects exported at package level are versioned with `schema_version = "1.0"`. Additive
fields may be introduced in compatible releases; field removal or semantic changes require a schema
version change. `AnalysisSummary.inference` reports the actual backend, model, hardware string,
latency, token counts when supplied by the backend, and repair count.

Failures to initialize inference, validate configuration, or initialize the required sandbox raise
an exception. No finding is returned as verified unless its `Incident.verification_status` is
`VERIFIED` and its associated experiment reports a stable explicit violation.

