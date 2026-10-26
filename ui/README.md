# FaultMesh Desktop UI: Visual Evidence Explorer

FaultMesh is a local-first, open-source visual debugger for Python projects across three levels: **Understand** (code structure, Git changes), **Observe** (run existing pytest suites, trace code paths, inspect failures, rerun for stability), and **Investigate** (optional local small-model analysis).

This package contains the interactive desktop visual explorer prototype, designed to run directly from the terminal as a standalone native desktop facet without requiring a localhost web server.

---

## Running from Terminal (Desktop Mode — Zero Localhost)

FaultMesh is built to operate as a native desktop application launched straight from your terminal. No localhost dev servers or browser tabs are required:

### Quickstart (from workspace root):
```bash
./run-desktop.sh
```

### Alternatively (from the `ui` directory):
```bash
cd ui
npm install
npm run desktop
```

Or invoke the direct CLI executable:
```bash
./ui/bin/faultmesh-ui
```

### Automated Testing & Production Builds:
```bash
cd ui

# Run automated Vitest component & adapter suite
npm test

# Build production desktop bundle
npm run build
```

---

## Obsidian Dataset Graph View

The graph visualization has been engineered to provide the aesthetic and feel of an **Obsidian dataset / knowledge graph**:

1. **Constellation Force Physics (`cose` physics engine):**
   - Replaces stiff rectangular flowchart boxes with organic spring physics (Coulomb repulsion, edge elasticity, and central gravity).
   - Nodes float freely as celestial orbs and particles in an obsidian cosmic canvas (`#080b11`) with subtle starfield depth.
   - An interactive **Physics HUD** allows real-time adjustment of node repulsion and gravity forces.
2. **Color Impacts Exclusively on Changes:**
   - **Modified Code (Glowing Amber `#f59e0b`):** e.g., `validate_token` with glowing gold halo and unified diff.
   - **Added Code (Glowing Cyan `#06b6d4`):** e.g., `sessions.py` with vibrant cyan halo.
   - **Failing Tests (Crimson Red `#ef4444`):** e.g., `test_login_expired_token` with crimson pulse.
   - **Passing Tests (Soft Emerald `#10b981`):** Subtly styled test nodes.
   - **Unchanged Code (Neutral Slate `#334155`):** All ordinary code symbols remain muted graphite dots fading into the background, eliminating visual noise.
3. **Animated Moving Dotted Lines (Live Traversal Pulses):**
   - When a test is highlighted or traversed, the active runtime trace edges feature an animated marching dash offset (`requestAnimationFrame` pulse) representing live electrical signals and data packets traversing through the neural mesh.
4. **Interactive Node Inspector Drawer:**
   - Clicking any node opens a slide-out drawer displaying Git unified diffs, syntax-highlighted source snippets, connected relationships (inbound/outbound calls with runtime observation counts), and a 1-hop neighbor isolation toggle.

---

## Fixture Data & Honest States

As per project hard rules, all data in this prototype comes from realistic, labeled fixtures (`FixtureAdapter`). The UI displays a prominent top banner: **"SAMPLE DATA (FIXTURE)"** whenever fixture data is active.

### Included Fixtures (`src/fixtures/index.ts`):
1. **`run-auth-regression` (Completed Run with Failures)**
   - Project: `auth-service` (`feat/jwt-sessions` @ `9f3c82d7a1`)
   - 1 Failing Test: `test_login_expired_token` with full traceback and 3x rerun stability proof (`[FP-AUTH-TOK-52]` 100% deterministic failure).
   - 3 Passing Tests: `test_login_valid_token`, `test_session_create`, `test_session_invalidation`.
   - 1 Harness Error: `test_rate_limit_backend` (`ConnectionRefusedError: Redis 6379`).
   - 1 Skipped Test: `test_oauth2_pkce_flow`.
   - Code Changes: Modified function `validate_token` (amber) with unified Git diff, and newly added `sessions.py` (teal).
   - Unresolved AST References: `audit_logger` in `tokens.py:59`, `legacy_ldap_sync` in `service.py:91`.
   - AST Parse Errors: `auth/experimental/simd_parser.py:14` (`SyntaxError` on match statement without 3.10 grammar).
2. **`run-empty-scan` (Empty Repository State)**
   - Honest empty scan guidance explaining discovery patterns and zero detected tests.
3. **`run-failed-harness` (Collection Phase Failure)**
   - Displays runner failure (`pytest.CollectionError: ModuleNotFoundError: No module named 'pytest_mock'`) with remediation steps.

---

## Adapter Architecture & Future Backend Wiring

All frontend views interact exclusively with a narrow TypeScript contract:

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

- **`FixtureAdapter`** (`src/adapter/fixtureAdapter.ts`): Implemented and active. Serves deterministic fixture data for testing and offline UI development.
- **`HttpAdapter`** (`src/adapter/httpAdapter.ts`): Documented stub. When Codex finalizes the SQLite schema and HTTP endpoints in the backend, `HttpAdapter` will be wired up to query the server without modifying the UI views.

---

## Integrity Principles

- **"Observed, not proven cause":** FaultMesh never claims an executed modified function is the defect root cause without independent proof. Real traces show observed execution, not proven causality.
- **Zero Localhost Ports:** Packaged as an Electron desktop bundle loading directly via the `file://` protocol.

---

## Verification Screenshots

All 5 core states have been visually verified and captured in `ui/screenshots/` and `docs/screenshots/`:
- `01_runs_screen.png`: Run overview, metadata, pass/fail ratios, honest causality notice, and static diagnostics.
- `02_failing_test_details.png`: Failing test details, failure message, python traceback, 3x rerun fingerprint proof, and inline git diff.
- `03_graph_test_selected.png`: Obsidian dataset constellation with circular glowing nodes, moving dotted line trace, and node inspector.
- `04_empty_state.png`: Diagnostic empty repository scan view.
- `05_error_state.png`: Harness collection failure error view.
