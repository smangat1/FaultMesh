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
