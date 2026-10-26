import { describe, it, expect } from 'vitest';
import { FixtureAdapter } from '../adapter/fixtureAdapter';
import { HttpAdapter } from '../adapter/httpAdapter';

describe('FixtureAdapter', () => {
  const adapter = new FixtureAdapter(0);

  it('loads all fixture runs', async () => {
    const runs = await adapter.getRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.id)).toEqual([
      'run-auth-regression',
      'run-empty-scan',
      'run-failed-harness',
    ]);
  });

  it('marks all runs as fixture data', async () => {
    const runs = await adapter.getRuns();
    for (const run of runs) {
      expect(run.isFixture).toBe(true);
      expect(run.fixtureLabel).toContain('Sample data (fixture)');
    }
  });

  it('loads test items for run-auth-regression', async () => {
    const tests = await adapter.getTests('run-auth-regression');
    expect(tests.length).toBeGreaterThan(0);

    const failing = tests.find((t) => t.status === 'fail');
    expect(failing).toBeDefined();
    expect(failing?.id).toBe('tests/test_auth.py::test_login_expired_token');
    expect(failing?.rerunHistory).toHaveLength(3);
    expect(failing?.rerunHistory[0].sameFailureRecurred).toBe(true);

    const errored = tests.find((t) => t.status === 'error');
    expect(errored).toBeDefined();

    const skipped = tests.find((t) => t.status === 'skipped');
    expect(skipped).toBeDefined();
  });

  it('returns empty array for empty scan fixture', async () => {
    const tests = await adapter.getTests('run-empty-scan');
    expect(tests).toEqual([]);
    const graph = await adapter.getGraph('run-empty-scan');
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('retrieves test evidence with observation note', async () => {
    const evidence = await adapter.getTestEvidence(
      'run-auth-regression',
      'tests/test_auth.py::test_login_expired_token'
    );
    expect(evidence).not.toBeNull();
    expect(evidence?.coveredNodes.length).toBeGreaterThan(0);
    expect(evidence?.observationNote).toContain('Observed, not proven cause');
    expect(evidence?.callTracingAvailable).toBe(true);
  });

  it('requires explicit per-test edge provenance and never guesses traces from coverage', async () => {
    const evidence = await adapter.getTestEvidence(
      'run-auth-regression',
      'tests/test_auth.py::test_login_expired_token'
    );
    expect(evidence).not.toBeNull();

    // Every executed edge must have explicit attribution for this test
    for (const edge of evidence!.executedEdges) {
      expect(edge.testIds).toContain('tests/test_auth.py::test_login_expired_token');
      expect(edge.category).toBe('runtime_observed');
    }

    // Static edges must never be included in executedEdges
    const staticEdges = evidence!.executedEdges.filter(
      (e) => e.category === 'static_call' || e.category === 'static_import'
    );
    expect(staticEdges).toHaveLength(0);

    // Other tests' edges must not leak into this test
    const sessionEdge = evidence!.executedEdges.find(
      (e) => e.id === 'e_test_sess_create'
    );
    expect(sessionEdge).toBeUndefined();
  });

  it('verifies fixture count consistency and snippet alignment', async () => {
    const run = await adapter.getRun('run-auth-regression');
    const graph = await adapter.getGraph('run-auth-regression');
    const tests = await adapter.getTests('run-auth-regression');
    expect(run).not.toBeNull();

    // Total nodes in graph must match stats
    expect(graph.nodes.length).toBe(run!.stats.totalNodes);
    expect(run!.stats.totalNodes).toBe(15);
    expect(run!.stats.modifiedNodes).toBe(1);
    expect(run!.stats.addedNodes).toBe(4);
    expect(run!.stats.totalChangedNodes).toBe(5);

    // parse_public_key must be in failing test's exercisedNodeIds
    const failingTest = tests.find(
      (t) => t.id === 'tests/test_auth.py::test_login_expired_token'
    );
    expect(failingTest?.exercisedNodeIds).toContain(
      'auth/crypto.py::parse_public_key'
    );

    // Snippet line numbers: line 52 must be InvalidClaimError to align with traceback
    const validateToken = graph.nodes.find(
      (n) => n.id === 'auth/tokens.py::validate_token'
    );
    expect(validateToken).toBeDefined();
    expect(validateToken?.lineStart).toBe(43);
    const snippetLines = validateToken!.sourceSnippet.split('\n');
    // Line 52 is line offset 52 - 43 = 9
    expect(snippetLines[9]).toContain('raise InvalidClaimError');
    expect(failingTest?.traceback).toContain('tokens.py", line 52');
  });

  it('retrieves source code and git diff for a modified node', async () => {
    const source = await adapter.getSource(
      'run-auth-regression',
      'auth/tokens.py::validate_token'
    );
    expect(source).not.toBeNull();
    expect(source?.changeStatus).toBe('modified');
    expect(source?.gitDiff).toContain('--- a/auth/tokens.py');
  });
});

describe('HttpAdapter Stub', () => {
  const httpAdapter = new HttpAdapter();

  it('throws an informative error rather than silent failure or fake mock', async () => {
    await expect(httpAdapter.getRuns()).rejects.toThrow(/not implemented/i);
  });
});
