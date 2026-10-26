# FaultMesh UI Prototype: Visual Evidence Explorer

FaultMesh is a local-first, open-source visual debugger for Python projects across three levels: **Understand** (code structure, Git changes), **Observe** (run existing pytest suites, trace code paths, inspect failures, rerun for stability), and **Investigate** (optional local small-model analysis).

This package contains the interactive frontend visual explorer prototype.

---

## Quickstart

### Prerequisites
- Node.js `>= 18` (developed and tested on Node `v22.17.1`)
- npm `>= 10`

### Installation & Development
```bash
cd ui
npm install

# Start Vite dev server on http://localhost:5173
npm run dev

# Run automated Vitest component & adapter suite
npm test

# Build production bundle
npm run build

# Preview production build
npm run preview
```

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

## Visual Semantics & Integrity Principles

- **Modified Code (Amber):** Code modified between base revision and HEAD.
- **Added Code (Teal):** Newly added functions/classes.
- **Unchanged Code (Slate):** Neutral baseline code.
- **Failing Tests (Red) / Passing Tests (Green):** Pytest execution status.
- **Runtime Observed Edges (Solid Light Blue):** Actual call traces observed during test execution. Selecting a test highlights its path in glowing red.
- **Static Edges (Dashed Muted Slate):** AST call and import relationships.
- **"Observed, not proven cause":** FaultMesh never claims an executed modified function is the defect root cause without independent proof.

---

## Known Limits

- Read-only prototype; does not invoke local Python interpreters or run shell commands.
- AI features are disabled.
- Graph layout uses deterministic Cytoscape Dagre to prevent chaotic layout shifts.
