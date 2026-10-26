# FaultMesh Desktop UI: Evidence-Backed Debugging Workspace

FaultMesh is a local-first visual debugger for Python projects designed to support the core investigation workflow:
**Choose recorded run → Inspect failed test → See exercised code → Inspect relevant changed code & diff → Read recorded replay comparisons.**

This package contains the interactive desktop UI workspace, launched directly from your terminal as a standalone native desktop application without requiring a localhost dev server or browser.

---

## Running from Terminal (Desktop Mode — Zero Localhost)

FaultMesh operates as a sandboxed native desktop application (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`) loading local assets via the `file://` protocol.

### Quickstart (from workspace root):
```bash
./run-desktop.sh
```

### Alternatively (from the `ui/` directory):
```bash
cd ui
npm test          # Run automated Vitest component & adapter suite
npm run build     # Compile production desktop bundle
./bin/faultmesh-ui # Launch desktop runner
```

The runner scripts (`run-desktop.sh` and `ui/bin/faultmesh-ui`) automatically verify local dependencies from `package-lock.json` and rebuild the bundle whenever source files change.

---

## Workspace Architecture & Key Views

### 1. Results-First Investigation Workspace
- **Compact Run Context Header:** Displays project, branch, revision, recorded run selector, execution duration, and an explicit outcome status badge (distinguishing harness run completion from test failures).
- **Left Test Rail (280–320px):** Filterable by status (`All`, `Failing`, `Errors`, `Passed`, `Skipped`) and searchable by test name or path. Pre-selects the primary failing test upon run load.
- **Investigation View:**
  - **Promoted Failure Message & Python Traceback:** Expandable traceback disclosure with preserved line numbers and horizontal scrolling.
  - **Recorded Replay Comparison:** Honest count-based language (e.g. *"Same failure in 3 of 3 recorded replays"*) with trial history and failure fingerprints. No simulated or fake live replay buttons.
  - **Promoted Changed Code Inspector:** Immediate access to exercised modified/added code (such as `validate_token`), with tabbed unified Git diff and source snippets.
  - **Exercised Code Grouped by File:** Expandable file sections listing covered symbols with change badges.
  - **Honest Causality Notice:** Contextual reminder that observed execution coverage does not constitute defect cause proof without independent verification.

### 2. Evidence Map View
- **Bounded Scope:** Focuses specifically on the active test's exercised symbols and observed call edges, rather than rendering an unmanageable, noisy universe graph.
- **Explicit Per-Test Edge Provenance:** Runtime call edges are only attributed to a test if explicitly recorded in that test's execution trace. Unobserved connections are never guessed or hallucinated from overlapping coverage sets.
- **Opt-in Static Context:** Surroundings can optionally reveal 1-hop static AST calls and imports via a distinct dashed visualization.
- **Symbol Inspector Drawer:** Clicking any node in the map provides instant code inspection, unified diffs, line ranges, and inbound/outbound connected relationships.

### 3. Run Diagnostics
- On-demand view for inspecting run harness metadata, AST parse errors, unresolved references, and empty scan or collection failure details.

---

## Data Integrity & Adapter Contract

All frontend views interact through the typed `FaultMeshAdapter` interface (`src/types/index.ts`):

```ts
export interface FaultMeshAdapter {
  getRuns(): Promise<RunSummary[]>;
  getRun(runId: string): Promise<RunSummary | null>;
  getTests(runId: string): Promise<TestItem[]>;
  getTest(runId: string, testId: string): Promise<TestItem | null>;
  getGraph(runId: string): Promise<GraphData>;
  getTestEvidence(runId: string, testId: string): Promise<TestEvidence | null>;
  getSource(runId: string, nodeId: string): Promise<SourceViewData | null>;
}
```

- **`FixtureAdapter`** (`src/adapter/fixtureAdapter.ts`): Implemented and active. Provides deterministic, labeled test runs (`run-auth-regression`, `run-empty-scan`, `run-failed-harness`) for UI development, verification, and automated testing.
- **Clear Fixture Labeling:** Every fixture run displays an unmistakable `SAMPLE DATA` banner to prevent confusing prototype data with live production environments.

---

## Visual Verification & Authoritative Screenshots

Visual verification artifacts are maintained in `docs/screenshots/`:
- `01_investigation_view.png`: Failing test investigation with promoted failure message, recorded replay comparison, and unified diff.
- `02_evidence_map.png`: Bounded visual evidence map with per-test provenance, selected symbol drawer, and connected relationships.
- `03_run_diagnostics.png`: AST diagnostics, unresolved references, and environment error details.
- `04_empty_scan_state.png`: Diagnostic guidance for empty repository scan.
- `05_collection_error_state.png`: Honest error view when the test runner aborts during collection phase.
