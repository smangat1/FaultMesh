import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { FixtureAdapter } from '../adapter/fixtureAdapter';
import { HttpAdapter } from '../adapter/httpAdapter';
import { ImportedAdapter } from '../adapter/importedAdapter';
import { parseAndValidateV3 } from '../import';

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
    expect(run!.stats.totalNodes).toBe(62);
    expect(run!.stats.modifiedNodes).toBe(1);
    expect(run!.stats.addedNodes).toBe(16);
    expect(run!.stats.totalChangedNodes).toBe(17);

    // Verify 8 file clusters
    expect(graph.files).toBeDefined();
    expect(graph.files?.length).toBe(8);
    const tokensFile = graph.files?.find((f) => f.file === 'auth/tokens.py');
    expect(tokensFile).toBeDefined();
    expect(tokensFile?.symbolCount).toBe(10);

    // Verify grounded descriptions on code nodes
    const nodeWithDesc = graph.nodes.find((n) => n.id === 'auth/tokens.py::validate_token');
    expect(nodeWithDesc?.description).toBeDefined();
    expect(nodeWithDesc?.description).toContain('Validates JWT signature');

    // Verify two-layer separation: static edges have NO testIds
    const staticEdges = graph.edges.filter((e) => e.category === 'static_call' || e.category === 'static_import');
    expect(staticEdges.length).toBeGreaterThan(0);
    for (const edge of staticEdges) {
      expect(edge.testIds).toBeUndefined();
    }

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
    expect(validateToken!.sourceSnippet).toBeDefined();
    const snippetLines = validateToken!.sourceSnippet!.split('\n');
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

describe('Phase 2: ImportedAdapter (V3 Static Structure Graph)', () => {
  const FIXTURES_DIR = path.resolve(__dirname, '../../../docs/fixtures');
  const v3HpackJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-structure.json'), 'utf-8');
  const v3ExampleJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-structure-example.json'), 'utf-8');

  it('loads real hpack V3 structure without backend or synthesis', async () => {
    const v3Res = parseAndValidateV3(v3HpackJson);
    expect(v3Res.success).toBe(true);

    const adapter = new ImportedAdapter(v3Res.data!);
    const runs = await adapter.getRuns();
    expect(runs).toHaveLength(1);
    const run = runs[0];

    expect(run.isRealImport).toBe(true);
    expect(run.isFixture).toBe(false);
    expect(run.project).toBe('hpack-repo');
    expect(run.gitRevision).toBe('c2edbee3b5508e0b1689877fe6f173eafb097aef');
    expect(run.unresolvedCount).toBe(461);
    expect(run.parseErrorCount).toBe(0);

    const graph = await adapter.getGraph(run.id);
    expect(graph.files!.length).toBe(19);
    expect(graph.nodes.length).toBe(171);
    expect(graph.edges.length).toBeGreaterThan(0);

    // Verify quiet honest nodes: no speculative description or complexity
    for (const node of graph.nodes) {
      expect(node.description).toBeUndefined();
      expect(node.complexity).toBeUndefined();
      expect(node.sourceSnippet).toBeUndefined();
      // But grounded metadata is present
      expect(node.signature).toBeDefined();
      expect(node.lineStart).toBeGreaterThanOrEqual(1);
      expect(node.lineEnd).toBeGreaterThanOrEqual(node.lineStart);
    }

    // Verify docstring is string or null
    for (const node of graph.nodes) {
      expect(node.docstringFirstLine === null || typeof node.docstringFirstLine === 'string').toBe(true);
    }

    // Verify edges have confidence and static provenance
    for (const edge of graph.edges) {
      expect(edge.confidence).toMatch(/^(resolved|ambiguous|unresolved)$/);
      expect(edge.provenance).toMatch(/^static /);
    }

    // Verify getSource honesty: returns metadata, but NO fake source code
    const sampleNode = graph.nodes[0];
    const source = await adapter.getSource(run.id, sampleNode.id);
    expect(source).not.toBeNull();
    expect(source?.hasSourceText).toBe(false);
    expect(source?.snippet).toBeUndefined();
    expect(source?.lineStart).toBe(sampleNode.lineStart);
    expect(source?.lineEnd).toBe(sampleNode.lineEnd);
    expect(source?.signature).toBe(sampleNode.signature);
  });

  it('correctly maps git change status and ghost nodes from V3 structure', async () => {
    const v3Res = parseAndValidateV3(v3ExampleJson);
    expect(v3Res.success).toBe(true);
    const doc = JSON.parse(JSON.stringify(v3Res.data!));

    // Inject git symbol statuses and a ghost symbol
    doc.git.symbols = [
      { symbol_id: doc.symbols[0].id, status: 'modified' },
      { symbol_id: doc.symbols[1].id, status: 'added' },
    ];
    doc.symbols.push({
      id: 'symbol:src/buggy_python_project/bounds.py:old_helper',
      path: 'src/buggy_python_project/bounds.py',
      qualified_name: 'old_helper',
      kind: 'function',
      parent_id: 'file:src/buggy_python_project/bounds.py',
      start_line: 10,
      end_line: 15,
      signature: 'def old_helper(): ...',
      parameter_names: [],
      decorators: [],
      bases: [],
      docstring: null,
      content_sha256: 'deadbeef',
      removed: true,
      revision_side: 'base',
    });

    const adapter = new ImportedAdapter(doc);
    const runs = await adapter.getRuns();
    const graph = await adapter.getGraph(runs[0].id);

    const modifiedNode = graph.nodes.find((n) => n.changeStatus === 'modified');
    expect(modifiedNode).toBeDefined();
    expect(modifiedNode?.id).toBe(doc.symbols[0].id);
    expect(modifiedNode?.docstringFirstLine).toBe('Return ``value + 1`` but never exceed ``maximum``.');

    const addedNode = graph.nodes.find((n) => n.changeStatus === 'added');
    expect(addedNode).toBeDefined();
    expect(addedNode?.id).toBe(doc.symbols[1].id);

    const removedGhostNode = graph.nodes.find((n) => n.isGhost && n.changeStatus === 'removed');
    expect(removedGhostNode).toBeDefined();
    expect(removedGhostNode?.revisionSide).toBe('base');
  });
});
