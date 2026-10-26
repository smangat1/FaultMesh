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
npm test          # Run 36/36 automated Vitest component & adapter tests
npm run build     # Compile clean TypeScript check & Vite production desktop bundle
./bin/faultmesh-ui # Launch desktop runner
```

The runner scripts (`run-desktop.sh` and `ui/bin/faultmesh-ui`) automatically verify local dependencies from `package-lock.json` and rebuild the bundle whenever source files change.

---

## Core Architecture: Holistic Project Map & Evidence Layers

### 1. Whole-Project Map as Primary Product Canvas
- **Constellation Architecture:** The entire repository is visualized as an interconnected constellation.
- **Two-Layer Data Separation:**
  1. *Static Structure Layer (Project-wide):* Discovered files, functions, classes, and structural AST relationships (imports and calls), explicitly labeled `Static structure (sample)` pending the real V3 static analyzer.
  2. *Test Execution Layer (Per-Test):* Recorded runtime coverage and observed dynamic call edges with explicit test provenance.
- **Test Selection as a Highlight Layer (Not Subgraph Replacement):** Selecting a test does **never** delete or fragment the map. Instead, all repository nodes remain in place; unexercised nodes dim to 22% opacity, while the failing test and its exercised symbols illuminate with cyan halos and solid cyan runtime call strands.
- **View Modes:**
  - `Structure`: Focuses on architectural layout, modules, and static relationships in clean neutral tones.
  - `Changes`: Highlights modified symbols (amber `#d29922`) and added symbols (cyan `#38bdf8`), dimming unchanged code.
  - `Tests`: Emphasizes test execution coverage, highlighting the selected test's exercised symbols and observed call edges.
  - `Investigation`: Focuses on failure investigation, highlighting the failing test path and opening the inspector drawer.
- **Semantic Zooming & Collision-Managed Labels:**
  - *Far Zoom (Repository Overview):* Clean constellation of circular nodes, no text soup.
  - *Mid Zoom:* Priority labels shown for selected, pinned, failing, changed, and hovered nodes.
  - *Close Zoom:* Full symbol labels displayed with strict label width bounds preventing text collisions.
- **Deterministic 0ms Layout:** Repeatable, preset coordinates across 8 files and 62 symbols eliminate layout jitter across sessions.

### 2. Zotero-like Left Sidebar
- **Unified Search:** Top search input filtering tests, files, and symbols with ArrowUp/ArrowDown/Enter keyboard navigation.
- **Tests Rail:** Compact list with status indicators (`fail`, `error`, `pass`), duration metrics, and one-click test highlight toggling.
- **Pinned Shortlist:** Session working set of investigated symbols (e.g., `validate_token`, `verify_signature`) with kind badges and quick unpin actions. Pinned symbols are elevated to priority visibility in the map.
- **File Explorer:** File cluster hierarchy with symbol counts, change indicators, and expand/collapse chevrons.

### 3. Contextual Slide-Out Inspector Drawer
- Hidden when nothing is selected, reserving 100% of the canvas for map exploration.
- Slides out from the right (~380–400px) when any symbol, test, or file is clicked.
- **Symbol View:**
  - Title, kind badge, file and line range (`auth/tokens.py:43-59`), change status badge, and Pin toggle button.
  - *What It Does:* Grounded plain-English role explanation (labeled `Sample description`).
  - *Code View:* Tabbed source code viewer and unified Git diff.
  - *Relationships:* Explicitly separates runtime observed calls from static structure links.
  - *Observed Coverage:* Tests exercising this symbol with duration and pass/fail status.
- **Test View:**
  - Status pill, duration, promoted failure message, and collapsible 8-line traceback with exact frame locations.
  - *Recorded Replay Comparison:* Honest trial history (e.g., 3 of 3 failed with fingerprint `FP-AUTH-TOK-52`).
  - *Exercised Symbols:* List of covered functions/classes with modification badges.

---

## Data Model & Adapter Contract

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

- **`FixtureAdapter`** (`src/adapter/fixtureAdapter.ts`): Expanded realistic fixture (`run-auth-regression`) containing 8 files, 62 symbols (1 modified, 16 added), and 6 tests.
- **Clear Fixture Labeling:** Every fixture run displays an unmistakable `SAMPLE DATA` banner to prevent confusing prototype data with live production environments.

---

## Visual Verification & Authoritative Screenshots

Visual verification artifacts are maintained in `docs/screenshots/` (captured at both 1440x920 and 1024x700):
- `01_opening_zoomed_out_1440x920.png`: Whole-project map opening state with 8 file clusters, 62 symbols, and zero text soup.
- `02_cluster_zoomed_in_1440x920.png`: Zoomed-in cluster view demonstrating clean subgrid spacing and zero label collisions.
- `03_failing_test_highlight_1440x920.png`: Failing test highlight layer maintaining the entire project in view with solid cyan observed call edges.
- `04_function_inspector_1440x920.png`: Selected modified symbol (`validate_token`) with role description, unified diff, and relationship provenance.
- `05_pinned_shortlist_1440x920.png`: Active pinned shortlist working set with elevated map priorities.
- `06_search_jump_1440x920.png`: Search jump dropdown matching symbols and tests with keyboard navigation.
- `07_large_sample_default_zoom_1440x920.png`: Repository-wide constellation view with balanced density.
