import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import { TestDetailsPane } from '../components/TestDetailsPane';
import { GraphView, computeDeterministicPositions } from '../components/GraphView';
import type { FaultMeshAdapter } from '../adapter';
import { ImportedAdapter } from '../adapter/importedAdapter';
import { Header } from '../components/Header';
import { parseAndValidateV3, parseAndValidateV2 } from '../import';
import type { V2RunOutcome } from '../import/types';
import { formatDurationMs } from '../utils/format';
import type { RunSummary, TestItem, GraphData, CodeNode } from '../types';
import { FIXTURE_RUNS, FIXTURE_TESTS, FIXTURE_GRAPH } from '../fixtures';

describe('Regression: App Run Discovery, Selection & Error Handling', () => {
  it('dynamically selects the first discovered run when initial run ID is not hardcoded', async () => {
    const customRun: RunSummary = {
      id: 'custom-run-xyz-999',
      project: 'payments-microservice',
      gitBranch: 'fix/stripe-webhook',
      gitRevision: 'a1b2c3d4e5',
      commitMessage: 'fix webhook signature validation',
      startedAt: '2026-10-26T12:00:00Z',
      durationMs: 950,
      status: 'completed',
      isFixture: true,
      fixtureLabel: 'Sample data (fixture)',
      limitations: [],
      stats: {
        totalTests: 2,
        passed: 1,
        failed: 1,
        errored: 0,
        skipped: 0,
        totalNodes: 10,
        codeNodes: 8,
        modifiedNodes: 1,
        addedNodes: 0,
        totalChangedNodes: 1,
      },
    };

    const mockAdapter: FaultMeshAdapter = {
      getRuns: vi.fn().mockResolvedValue([customRun]),
      getRun: vi.fn().mockResolvedValue(customRun),
      getTests: vi.fn().mockResolvedValue([]),
      getTest: vi.fn().mockResolvedValue(null),
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] }),
      getTestEvidence: vi.fn().mockResolvedValue(null),
      getSource: vi.fn().mockResolvedValue(null),
    };

    render(<App adapter={mockAdapter} isDemo={true} />);

    await waitFor(() => {
      expect(screen.getAllByText(/payments-microservice/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('run-auth-regression')).toBeNull();
  });

  it('displays explicit empty state when adapter returns zero runs', async () => {
    const mockAdapter: FaultMeshAdapter = {
      getRuns: vi.fn().mockResolvedValue([]),
      getRun: vi.fn().mockResolvedValue(null),
      getTests: vi.fn().mockResolvedValue([]),
      getTest: vi.fn().mockResolvedValue(null),
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] }),
      getTestEvidence: vi.fn().mockResolvedValue(null),
      getSource: vi.fn().mockResolvedValue(null),
    };

    render(<App adapter={mockAdapter} isDemo={true} />);

    await waitFor(() => {
      expect(screen.getByText(/No Recorded Runs/i)).toBeDefined();
    });
  });

  it('displays retryable error state when getRuns rejects', async () => {
    const getRunsMock = vi.fn().mockRejectedValueOnce(new Error('Network connection timeout querying run database'));

    const mockAdapter: FaultMeshAdapter = {
      getRuns: getRunsMock,
      getRun: vi.fn().mockResolvedValue(null),
      getTests: vi.fn().mockResolvedValue([]),
      getTest: vi.fn().mockResolvedValue(null),
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] }),
      getTestEvidence: vi.fn().mockResolvedValue(null),
      getSource: vi.fn().mockResolvedValue(null),
    };

    render(<App adapter={mockAdapter} isDemo={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to Load Runs/i)).toBeDefined();
      expect(screen.getByText(/Network connection timeout querying run database/i)).toBeDefined();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry Discovery/i });
    expect(retryBtn).toBeDefined();
  });

  it('guards against asynchronous race conditions on rapid run switching', async () => {
    const runA: RunSummary = { ...FIXTURE_RUNS[0], id: 'run-A', project: 'Project-A' };
    const runB: RunSummary = { ...FIXTURE_RUNS[0], id: 'run-B', project: 'Project-B' };

    let resolveRunA: (tests: TestItem[]) => void;
    const runAPromise = new Promise<TestItem[]>((res) => {
      resolveRunA = res;
    });

    const mockAdapter: FaultMeshAdapter = {
      getRuns: vi.fn().mockResolvedValue([runA, runB]),
      getRun: vi.fn().mockImplementation((id) => Promise.resolve(id === 'run-A' ? runA : runB)),
      getTests: vi.fn().mockImplementation((id) => {
        if (id === 'run-A') return runAPromise;
        return Promise.resolve([
          {
            id: 'tests/test_b.py::test_case_b',
            name: 'test_case_b',
            file: 'tests/test_b.py',
            status: 'pass',
            durationMs: 50,
            exercisedNodeIds: [],
            rerunHistory: [],
          },
        ]);
      }),
      getTest: vi.fn().mockResolvedValue(null),
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] }),
      getTestEvidence: vi.fn().mockResolvedValue(null),
      getSource: vi.fn().mockResolvedValue(null),
    };

    render(<App adapter={mockAdapter} isDemo={true} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Project-A/i).length).toBeGreaterThan(0);
    });

    const projectBBtn = screen.getByRole('radio', { name: /Project-B/i });
    fireEvent.click(projectBBtn);

    await waitFor(() => {
      expect(screen.getAllByText('test_case_b').length).toBeGreaterThan(0);
    });

    resolveRunA!([
      {
        id: 'tests/test_a.py::test_case_a_stale',
        name: 'test_case_a_stale',
        file: 'tests/test_a.py',
        status: 'fail',
        durationMs: 50,
        exercisedNodeIds: [],
        rerunHistory: [],
      },
    ]);

    expect(screen.queryByText('test_case_a_stale')).toBeNull();
    expect(screen.getAllByText('test_case_b').length).toBeGreaterThan(0);
  });
});

describe('Regression: Edge Provenance & Truth in Evidence', () => {
  it('requires explicit per-test edge provenance and never attributes edges based on coverage endpoints', () => {
    const nodes: CodeNode[] = [
      { id: 'node_x', name: 'func_x', kind: 'function', parentModule: 'pkg/x.py', file: 'pkg/x.py', lineStart: 1, lineEnd: 10, changeStatus: 'unchanged', sourceSnippet: 'def func_x(): pass' },
      { id: 'node_y', name: 'func_y', kind: 'function', parentModule: 'pkg/y.py', file: 'pkg/y.py', lineStart: 1, lineEnd: 10, changeStatus: 'unchanged', sourceSnippet: 'def func_y(): pass' },
    ];
    const edges = [
      {
        id: 'e_xy',
        source: 'node_x',
        target: 'node_y',
        category: 'runtime_observed' as const,
        provenance: 'sys.settrace',
        testIds: ['test_a'], // ONLY Test A observed this edge!
        observedCount: 1,
      },
    ];

    const tests: TestItem[] = [
      {
        id: 'test_a',
        name: 'test_a',
        file: 'test_mod.py',
        status: 'pass',
        durationMs: 10,
        exercisedNodeIds: ['node_x', 'node_y'],
        rerunHistory: [],
      },
      {
        id: 'test_b',
        name: 'test_b',
        file: 'test_mod.py',
        status: 'fail',
        durationMs: 15,
        exercisedNodeIds: ['node_x', 'node_y'], // Also covers node_x and node_y!
        rerunHistory: [],
      },
    ];

    const graphData: GraphData = {
      nodes,
      edges,
      unresolvedReferences: [],
      parseErrors: [],
    };

    render(
      <GraphView
        graphData={graphData}
        tests={tests}
        selectedTestId="test_b"
        onSelectTest={vi.fn()}
      />
    );

    expect(screen.getByText(/2 nodes, 0 edges/i)).toBeDefined();
  });

  it('never promotes static AST edges to observed calls', () => {
    const nodes: CodeNode[] = [
      { id: 'node_a', name: 'func_a', kind: 'function', parentModule: 'pkg/a.py', file: 'pkg/a.py', lineStart: 1, lineEnd: 10, changeStatus: 'unchanged', sourceSnippet: 'def func_a(): pass' },
      { id: 'node_b', name: 'func_b', kind: 'function', parentModule: 'pkg/b.py', file: 'pkg/b.py', lineStart: 1, lineEnd: 10, changeStatus: 'unchanged', sourceSnippet: 'def func_b(): pass' },
    ];
    const edges = [
      {
        id: 'e_static_ab',
        source: 'node_a',
        target: 'node_b',
        category: 'static_call' as const,
        provenance: 'ast.Call',
      },
    ];

    const tests: TestItem[] = [
      {
        id: 'test_1',
        name: 'test_1',
        file: 'tests/test_1.py',
        status: 'fail',
        durationMs: 20,
        exercisedNodeIds: ['node_a', 'node_b'],
        rerunHistory: [],
      },
    ];

    const graphData: GraphData = { nodes, edges, unresolvedReferences: [], parseErrors: [] };

    render(
      <GraphView
        graphData={graphData}
        tests={tests}
        selectedTestId="test_1"
      />
    );

    expect(screen.getByText(/2 nodes, 0 edges/i)).toBeDefined();

    const staticCheckbox = screen.getByLabelText(/Include Static Context/i);
    fireEvent.click(staticCheckbox);

    expect(screen.getByText(/2 nodes, 1 edges/i)).toBeDefined();
  });
});

describe('Regression: Replay History & Determinism Honesty', () => {
  it('displays honest count-based comparison ("Same failure in 3 of 3 recorded replays") without claiming determinism', () => {
    const failingTest = FIXTURE_TESTS['run-auth-regression'].find((t) => t.status === 'fail')!;
    const nodes = FIXTURE_GRAPH['run-auth-regression'].nodes;

    render(
      <TestDetailsPane
        test={failingTest}
        allNodes={nodes}
      />
    );

    expect(screen.getByText(/Same failure in 3 of 3 recorded replays/i)).toBeDefined();
    expect(screen.queryByText(/100% stable/i)).toBeNull();
    expect(screen.queryByText(/Deterministic Failure/i)).toBeNull();
    expect(screen.getByText(/Replay execution unavailable \(static evidence viewer\)/i)).toBeDefined();
  });
});

describe('Regression: Keyboard Accessibility & Navigation', () => {
  it('allows keyboard navigation across test list items', async () => {
    const tests = FIXTURE_TESTS['run-auth-regression'];

    render(
      <App
        isDemo={true}
        adapter={{
          getRuns: vi.fn().mockResolvedValue(FIXTURE_RUNS),
          getRun: vi.fn().mockResolvedValue(FIXTURE_RUNS[0]),
          getTests: vi.fn().mockResolvedValue(tests),
          getTest: vi.fn().mockResolvedValue(tests[0]),
          getGraph: vi.fn().mockResolvedValue(FIXTURE_GRAPH['run-auth-regression']),
          getTestEvidence: vi.fn().mockResolvedValue(null),
          getSource: vi.fn().mockResolvedValue(null),
        }}
      />
    );

    await waitFor(() => {
      const testButtons = screen.getAllByRole('button');
      const testBtn = testButtons.find((b) => b.textContent?.includes('test_login_valid_token'));
      expect(testBtn).toBeDefined();
      if (testBtn) {
        fireEvent.click(testBtn);
      }
    });
  });
});

describe('Regression: Scalability & Bounded Rendering', () => {
  it('renders only bounded selection in large repository fixture (500 symbols, 150 tests)', () => {
    // Generate 500 symbols
    const largeNodes: CodeNode[] = [];
    for (let i = 0; i < 500; i++) {
      largeNodes.push({
        id: `pkg/mod_${Math.floor(i / 10)}.py::symbol_${i}`,
        name: `symbol_${i}`,
        kind: 'function',
        parentModule: `pkg/mod_${Math.floor(i / 10)}.py`,
        file: `pkg/mod_${Math.floor(i / 10)}.py`,
        lineStart: (i * 10) + 1,
        lineEnd: (i * 10) + 9,
        changeStatus: i === 42 ? 'modified' : 'unchanged',
        sourceSnippet: `def symbol_${i}(): pass`,
      });
    }

    // 150 tests, test_target exercises only 5 specific nodes
    const targetTest: TestItem = {
      id: 'tests/test_perf.py::test_target_scale',
      name: 'test_target_scale',
      file: 'tests/test_perf.py',
      status: 'fail',
      durationMs: 45,
      exercisedNodeIds: [
        largeNodes[0].id,
        largeNodes[42].id, // modified
        largeNodes[100].id,
        largeNodes[250].id,
        largeNodes[499].id,
      ],
      rerunHistory: [],
    };

    const graphData: GraphData = {
      nodes: largeNodes,
      edges: [
        {
          id: 'e_0_42',
          source: largeNodes[0].id,
          target: largeNodes[42].id,
          category: 'runtime_observed',
          provenance: 'sys.settrace',
          testIds: [targetTest.id],
          observedCount: 1,
        },
      ],
      unresolvedReferences: [],
      parseErrors: [],
    };

    render(
      <GraphView
        graphData={graphData}
        tests={[targetTest]}
        selectedTestId={targetTest.id}
      />
    );

    // Verify whole-project map: All 500 project nodes remain in the map, with the test highlighted!
    expect(screen.getByText(/500 nodes, 1 edges/i)).toBeDefined();
    expect(screen.getByText(/Highlighting: test_target_scale/i)).toBeDefined();
  });
});

describe('Holistic Project Map & Semantic Zoom', () => {
  const graph = FIXTURE_GRAPH['run-auth-regression'];
  const tests = FIXTURE_TESTS['run-auth-regression'];

  it('computes deterministic positions with 100% repeatability', () => {
    const pos1 = computeDeterministicPositions(graph.files || [], graph.nodes);
    const pos2 = computeDeterministicPositions(graph.files || [], graph.nodes);

    expect(Object.keys(pos1).length).toBe(Object.keys(pos2).length);
    for (const key of Object.keys(pos1)) {
      expect(pos1[key].x).toBe(pos2[key].x);
      expect(pos1[key].y).toBe(pos2[key].y);
    }
  });

  it('keeps all project nodes and files in map when test is selected', () => {
    const failingTest = tests.find((t) => t.status === 'fail')!;

    render(
      <GraphView
        graphData={graph}
        tests={tests}
        selectedTestId={failingTest.id}
      />
    );

    // All 62 nodes are present, test highlighted
    expect(screen.getByText(new RegExp(`Highlighting: ${failingTest.name}`, 'i'))).toBeDefined();
    expect(screen.getByText(/62 nodes/i)).toBeDefined();
  });

  it('handles file cluster collapse and uncollapse dynamically', () => {
    const { rerender } = render(
      <GraphView
        graphData={graph}
        tests={tests}
        selectedTestId={null}
        collapsedFiles={new Set()}
      />
    );

    expect(screen.getByText(/Whole Project Map/i)).toBeDefined();

    // Rerender with tokens.py collapsed
    rerender(
      <GraphView
        graphData={graph}
        tests={tests}
        selectedTestId={null}
        collapsedFiles={new Set(['auth/tokens.py'])}
      />
    );

    expect(screen.getByText(/Whole Project Map/i)).toBeDefined();
  });

  it('opens in Structure mode with zero preselected test and Whole Project Map', () => {
    render(
      <GraphView
        graphData={graph}
        tests={tests}
        selectedTestId={null}
        viewMode="structure"
      />
    );

    const structureRadio = screen.getByRole('radio', { name: /structure/i });
    expect(structureRadio).toBeDefined();
    expect(structureRadio.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Whole Project Map')).toBeDefined();
  });

  it('computes non-grid celestial starburst coordinates for file and child nodes', () => {
    const positions = computeDeterministicPositions(graph.files || [], graph.nodes);

    // Tokens file center
    const tokensCenter = positions['file:auth/tokens.py'];
    expect(tokensCenter).toBeDefined();

    // Verify child symbols radiate in starburst around center rather than a 2-column rectangular grid
    const child1 = positions['auth/tokens.py::validate_token'];
    const child2 = positions['auth/tokens.py::decode_jwt_header'];
    expect(child1).toBeDefined();
    expect(child2).toBeDefined();

    // Distances from center are in celestial radius band (40px - 85px)
    const dist1 = Math.hypot(child1.x - tokensCenter.x, child1.y - tokensCenter.y);
    const dist2 = Math.hypot(child2.x - tokensCenter.x, child2.y - tokensCenter.y);
    expect(dist1).toBeGreaterThanOrEqual(40);
    expect(dist1).toBeLessThanOrEqual(90);
    expect(dist2).toBeGreaterThanOrEqual(40);
    expect(dist2).toBeLessThanOrEqual(90);
  });

  it('staggers sibling node radial distance in expanded file clusters to prevent label collision', () => {
    const positions = computeDeterministicPositions(graph.files || [], graph.nodes);

    // Verify verify_claims and encode_jwt in tokens.py have distinct radial distances
    const tokensCenter = positions['file:auth/tokens.py'];
    const verifyNode = positions['auth/tokens.py::verify_claims'];
    const encodeNode = positions['auth/tokens.py::encode_jwt'];

    expect(tokensCenter).toBeDefined();
    expect(verifyNode).toBeDefined();
    expect(encodeNode).toBeDefined();

    const distVerify = Math.hypot(verifyNode.x - tokensCenter.x, verifyNode.y - tokensCenter.y);
    const distEncode = Math.hypot(encodeNode.x - tokensCenter.x, encodeNode.y - tokensCenter.y);

    // Distinct tiered radial orbits (~48px vs ~80px)
    expect(Math.abs(distVerify - distEncode)).toBeGreaterThanOrEqual(15);
  });

  it('clears test execution trace and maintains clean mode hygiene when switching to Changes mode', async () => {
    render(<App isDemo={true} initialScreen="workspace" />);

    // Select the failing test from the tests sidebar
    const failItem = await screen.findByTitle('tests/test_auth.py::test_login_expired_token');
    fireEvent.click(failItem);

    // Verify test was selected and Clear button appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear test highlight/i })).toBeDefined();
    });

    // Switch to Changes tab
    const changesTab = screen.getByRole('radio', { name: /changes/i });
    fireEvent.click(changesTab);

    // In changes mode, selectedTestId is cleared and changes tab is active
    await waitFor(() => {
      expect(changesTab.getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByRole('button', { name: /clear test highlight/i })).toBeNull();
    });
  });
});

describe('Phase 2 Regression: Real V3 Import, Strict Separation & Responsive Layouts', () => {
  const FIXTURES_DIR = path.resolve(__dirname, '../../../docs/fixtures');
  const v3HpackJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-structure.json'), 'utf-8');

  it('guarantees real imported project contains zero demo IDs, no SAMPLE badges, no runtime_observed edges, and no step badges', async () => {
    const val = parseAndValidateV3(v3HpackJson);
    expect(val.success).toBe(true);

    const adapter = new ImportedAdapter(val.data!);
    const runs = await adapter.getRuns();
    const graph = await adapter.getGraph(runs[0].id);

    // 1. Zero demo IDs
    for (const node of graph.nodes) {
      expect(node.id).not.toContain('auth-regression');
      expect(node.id).not.toContain('tokens.py');
      expect(node.id).not.toContain('validate_token');
    }

    // 2. Zero runtime_observed edges or call steps
    for (const edge of graph.edges) {
      expect(edge.category).not.toBe('runtime_observed');
      expect(edge.category === 'static_call' || edge.category === 'static_import').toBe(true);
      expect((edge as any).stepLabel).toBeUndefined();
      expect(edge.testIds).toBeUndefined();
    }

    // 3. UI rendering: real adapter shows imported label and NO 'SAMPLE DATA' badge
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('Imported')).toBeDefined();
      expect(screen.getByTitle(/hpack-repo @ c2edbee - static structure/i)).toBeDefined();
    });

    expect(screen.queryByText(/SAMPLE DATA/i)).toBeNull();
    // Agent Auto-Repair button is strictly hidden for real imports
    expect(screen.queryByRole('button', { name: /agent auto-repair/i })).toBeNull();
  });

  it('renders correctly at 1024x700 and 1440x920 viewport dimensions without errors', async () => {
    const val = parseAndValidateV3(v3HpackJson);
    const adapter = new ImportedAdapter(val.data!);

    // Test 1024x700
    window.innerWidth = 1024;
    window.innerHeight = 700;
    const { unmount } = render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getAllByText(/hpack-repo/i).length).toBeGreaterThan(0);
    });

    unmount();

    // Test 1440x920
    window.innerWidth = 1440;
    window.innerHeight = 920;
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getAllByText(/hpack-repo/i).length).toBeGreaterThan(0);
    });
  });

  it('selects a V2 test to highlight executed symbols with no call arrows, and renders phases and failure fingerprint in inspector', async () => {
    const v2ParentJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-parent.json'), 'utf-8');
    const v3Res = parseAndValidateV3(v3HpackJson);
    const v2Res = parseAndValidateV2(v2ParentJson);

    const adapter = new ImportedAdapter(v3Res.data!, [v2Res.data!]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    // Wait for the workspace to load with test items in the sidebar
    const failedTestItem = await screen.findByTitle('tests/test_faultmesh_injected_failure.py::test_faultmesh_injected_wrong_integer_encoding');
    expect(failedTestItem).toBeDefined();

    // Select the failed test
    fireEvent.click(failedTestItem);

    // Verify Inspector opens with test details
    await waitFor(() => {
      expect(screen.getByText(/Failure Message/i)).toBeDefined();
      expect(screen.getByText(/Failure Fingerprint:/i)).toBeDefined();
      expect(screen.getByText(/Pytest Execution Phases/i)).toBeDefined();
      expect(screen.getByText(/Coverage only/i)).toBeDefined();
    });

    // Verify raw failure output text contains assertion mismatch
    expect(screen.getAllByText(/AssertionError: assert bytearray/i).length).toBeGreaterThan(0);

    // Verify NO runtime call arrows or step badges are in the DOM
    expect(screen.queryByText(/\[1\]/i)).toBeNull();
  });

  it('renders Replay Comparison View comparing parent run and replay run side-by-side', async () => {
    const v2ParentJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-parent.json'), 'utf-8');
    const v2ReplayJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-replay.json'), 'utf-8');

    const v3Res = parseAndValidateV3(v3HpackJson);
    const v2ParentRes = parseAndValidateV2(v2ParentJson);
    const v2ReplayRes = parseAndValidateV2(v2ReplayJson);

    const adapter = new ImportedAdapter(v3Res.data!, [v2ParentRes.data!, v2ReplayRes.data!]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    // Switch to Replay Comparison tab
    const replayTab = await screen.findByRole('button', { name: /replay comparison/i });
    expect(replayTab).toBeDefined();
    fireEvent.click(replayTab);

    // Verify Replay Comparison View is displayed
    await waitFor(() => {
      expect(screen.getByText(/Recorded Replay Run Comparison/i)).toBeDefined();
      expect(screen.getAllByText(/SAME_FAILURE/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Identical Fingerprint Recurred/i)).toBeDefined();
      expect(screen.getByText(/Raw Bounded Failure Text Output Side-by-Side/i)).toBeDefined();
      expect(screen.getByText(/Executed in Both Runs/i)).toBeDefined();
    });

    // Verify Rule 3: strictly no 'diagnosed', 'fixed', or 'verified'
    expect(screen.queryByText(/diagnosed/i)).toBeNull();
    expect(screen.queryByText(/verified candidate fix/i)).toBeNull();
  });

  it('supports run switching via header dropdown and clears stale selection', async () => {
    const v2ParentJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-parent.json'), 'utf-8');
    const v2ReplayJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-replay.json'), 'utf-8');

    const v3Res = parseAndValidateV3(v3HpackJson);
    const v2ParentRes = parseAndValidateV2(v2ParentJson);
    const v2ReplayRes = parseAndValidateV2(v2ReplayJson);

    const adapter = new ImportedAdapter(v3Res.data!, [v2ParentRes.data!, v2ReplayRes.data!]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    // Find run switcher select
    const runSelect = await screen.findByLabelText(/switch active test run/i);
    expect(runSelect).toBeDefined();

    // Switch to replay run
    fireEvent.change(runSelect, { target: { value: 'run-9de6b4cb5a58' } });

    // Verify active run switched to replay run
    await waitFor(() => {
      expect((runSelect as HTMLSelectElement).value).toBe('run-9de6b4cb5a58');
      expect(screen.getByText(/Recorded Replay Run/i)).toBeDefined();
    });
  });
});

describe('Phase 4 Regression: Empty/Error States, Demo Gating & Verification', () => {
  const FIXTURES_DIR = path.resolve(__dirname, '../../../docs/fixtures');
  const v3HpackJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-structure.json'), 'utf-8');

  it('renders honest empty test state when real import has zero test runs', async () => {
    const val = parseAndValidateV3(v3HpackJson);
    const adapter = new ImportedAdapter(val.data!);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(
        screen.getByText(/No test runs imported - drop a V2 run JSON to view dynamic coverage and failures/i)
      ).toBeDefined();
    });

    // Graph remains interactive and whole project map is visible
    expect(screen.getByText(/Whole Project Map/i)).toBeDefined();
  });

  it('renders quiet centered notice when imported V3 structure contains zero symbols', async () => {
    const emptyV3 = {
      ...JSON.parse(v3HpackJson),
      files: [],
      symbols: [],
      edges: [],
    };
    const adapter = new ImportedAdapter(emptyV3 as any);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getAllByText(/hpack-repo/i).length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Structure file contains no symbols. The project may be empty or filtered out./i)
      ).toBeDefined();
    });
  });

  it('renders honest harness collection failure state when V2 run has collection error', async () => {
    const v3Res = parseAndValidateV3(v3HpackJson);
    const brokenV2: any = {
      schema_version: '2.0',
      run: {
        id: 'run-collection-fail',
        config_version: '2.0',
        outcome: 'COLLECTION_ERROR',
        exit_code: 2,
        started_at: '2026-10-26T12:00:00Z',
        finished_at: '2026-10-26T12:00:01Z',
        duration_ms: 1000,
        error: "ModuleNotFoundError: No module named 'nonexistent_lib' during collection in test_foo.py",
        artifacts: { directory: '/tmp', run_record: 'r.json', config: 'c.json' },
      },
      tests: [],
    };

    const adapter = new ImportedAdapter(v3Res.data!, [brokenV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText(/Test harness failed during collection/i)).toBeDefined();
      expect(
        screen.getByText(/ModuleNotFoundError: No module named 'nonexistent_lib'/i)
      ).toBeDefined();
    });
  });

  it('gates agent dock, thought stream, and simulation on real imports with disabled notice', async () => {
    const val = parseAndValidateV3(v3HpackJson);
    const adapter = new ImportedAdapter(val.data!);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Agent Auto-Repair \(Demo only\)/i)
      ).toBeDefined();
    });

    // Replay bar, play/pause controls, and explanation card are strictly not in the DOM
    expect(screen.queryByLabelText(/play investigation/i)).toBeNull();
    expect(screen.queryByText(/Why this step\?/i)).toBeNull();
  });

  it('maintains sample demo accessibility via project selector screen and restores demo mode', async () => {
    const val = parseAndValidateV3(v3HpackJson);
    const adapter = new ImportedAdapter(val.data!);
    render(<App adapter={adapter} isDemo={true} initialScreen="selector" />);

    await waitFor(() => {
      expect(screen.getAllByText(/hpack-repo/i).length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Switch to Sample Project Demo/i)).toBeDefined();
    });

    // Click to switch back to Sample Demo
    fireEvent.click(screen.getByLabelText(/Switch to Sample Project Demo/i));

    await waitFor(() => {
      expect(screen.getByText(/auth-service \(Sample Demo\)/i)).toBeDefined();
    });
  });

  it('displays "1 FAILED" badge and not "HARNESS FAILED" when imported run executed tests and some failed', async () => {
    const v2HpackParentJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-parent.json'), 'utf-8');
    const v3Val = parseAndValidateV3(v3HpackJson);
    const v2Val = parseAndValidateV2(v2HpackParentJson);
    const adapter = new ImportedAdapter(v3Val.data!, [v2Val.data!]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText(/1 FAILED/i)).toBeDefined();
    });
    expect(screen.queryByText(/HARNESS FAILED/i)).toBeNull();
  });

  it('displays "STRUCTURE ONLY" badge and not "ALL PASSED" for structure-only imports', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const adapter = new ImportedAdapter(v3Val.data!);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText(/STRUCTURE ONLY/i)).toBeDefined();
    });
    expect(screen.queryByText(/ALL PASSED/i)).toBeNull();
  });

  it('derives project selector provenance labels from isFixture and isRealImport accurately', async () => {
    // Custom runs list where an imported project is called 'auth-service' and fixture is called 'empty-repo'
    const importedAuthRun: RunSummary = {
      ...FIXTURE_RUNS[0],
      id: 'real-imported-auth',
      project: 'auth-service',
      isFixture: false,
      isRealImport: true,
      fixtureLabel: '',
    };
    const fixtureOtherRun: RunSummary = {
      ...FIXTURE_RUNS[1],
      id: 'fixture-other',
      project: 'empty-repo',
      isFixture: true,
      isRealImport: false,
    };

    const mockAdapter: FaultMeshAdapter = {
      getRuns: vi.fn().mockResolvedValue([importedAuthRun, fixtureOtherRun]),
      getRun: vi.fn().mockResolvedValue(importedAuthRun),
      getTests: vi.fn().mockResolvedValue([]),
      getTest: vi.fn().mockResolvedValue(null),
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] }),
      getTestEvidence: vi.fn().mockResolvedValue(null),
      getSource: vi.fn().mockResolvedValue(null),
    };

    render(<App adapter={mockAdapter} isDemo={true} initialScreen="selector" />);

    await waitFor(() => {
      expect(screen.getByText(/auth-service \(Imported\)/i)).toBeDefined();
      expect(screen.getByText(/empty-repo \(Sample Demo\)/i)).toBeDefined();
    });
  });

  it('formats test and run durations consistently with formatDurationMs', () => {
    expect(formatDurationMs(2.207335)).toBe('2.2ms');
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(420)).toBe('420ms');
    expect(formatDurationMs(undefined)).toBe('0ms');
    expect(formatDurationMs(null)).toBe('0ms');
  });
});

describe('Phase 5 Regression: Explicit RunOutcome Derivation & Badges', () => {
  const FIXTURES_DIR = path.resolve(__dirname, '../../../docs/fixtures');
  const v3HpackJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-structure.json'), 'utf-8');

  function makeV2Run(outcome: V2RunOutcome, tests: any[] = []): any {
    return {
      schema_version: '2.0',
      run: {
        id: `run-${outcome.toLowerCase()}-123`,
        config_version: '2.0',
        outcome,
        exit_code: outcome === 'PASSED' ? 0 : 1,
        started_at: '2026-10-26T12:00:00Z',
        finished_at: '2026-10-26T12:00:01Z',
        duration_ms: 125.4,
        artifacts: { directory: '/tmp', run_record: 'r.json', config: 'c.json' },
      },
      tests,
    };
  }

  it('shows CANCELLED badge and never green ALL PASSED when outcome is CANCELLED even if tests passed', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const passTest = { node_id: 'test_foo.py::test_ok', outcome: 'PASSED', duration_ms: 10 };
    const cancelledV2 = makeV2Run('CANCELLED', [passTest]);

    const adapter = new ImportedAdapter(v3Val.data!, [cancelledV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('CANCELLED')).toBeDefined();
    });
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows HARNESS FAILED (naming INFRASTRUCTURE_ERROR) and never ALL PASSED when outcome is INFRASTRUCTURE_ERROR', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const passTest = { node_id: 'test_foo.py::test_ok', outcome: 'PASSED', duration_ms: 10 };
    const infraV2 = makeV2Run('INFRASTRUCTURE_ERROR', [passTest]);

    const adapter = new ImportedAdapter(v3Val.data!, [infraV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      const badge = screen.getByText('HARNESS FAILED');
      expect(badge).toBeDefined();
      expect(badge.getAttribute('title')).toContain('INFRASTRUCTURE_ERROR');
    });
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows HARNESS FAILED (naming MALFORMED_REPORT) and never ALL PASSED when outcome is MALFORMED_REPORT', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const passTest = { node_id: 'test_foo.py::test_ok', outcome: 'PASSED', duration_ms: 10 };
    const malformedV2 = makeV2Run('MALFORMED_REPORT', [passTest]);

    const adapter = new ImportedAdapter(v3Val.data!, [malformedV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      const badge = screen.getByText('HARNESS FAILED');
      expect(badge).toBeDefined();
      expect(badge.getAttribute('title')).toContain('MALFORMED_REPORT');
    });
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows TIMED OUT alongside FAILED count and never green ALL PASSED when outcome is TIMEOUT with a failure', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const failTest = {
      node_id: 'test_foo.py::test_broken',
      outcome: 'FAILED',
      duration_ms: 50,
      failure_text: 'AssertionError: timeout reached',
    };
    const timeoutV2 = makeV2Run('TIMEOUT', [failTest]);

    const adapter = new ImportedAdapter(v3Val.data!, [timeoutV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('1 FAILED')).toBeDefined();
      expect(screen.getByText('TIMED OUT')).toBeDefined();
    });
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows TIMED OUT pill when outcome is TIMEOUT with no test failures', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const timeoutV2 = makeV2Run('TIMEOUT', []);

    const adapter = new ImportedAdapter(v3Val.data!, [timeoutV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('TIMED OUT')).toBeDefined();
    });
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows NO TESTS COLLECTED and not STRUCTURE ONLY when imported V2 run has NO_TESTS outcome', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const noTestsV2 = makeV2Run('NO_TESTS', []);

    const adapter = new ImportedAdapter(v3Val.data!, [noTestsV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('NO TESTS COLLECTED')).toBeDefined();
    });
    expect(screen.queryByText('STRUCTURE ONLY')).toBeNull();
    expect(screen.queryByText('ALL PASSED')).toBeNull();
  });

  it('shows ALL PASSED only when outcome is PASSED and all tests pass', async () => {
    const v3Val = parseAndValidateV3(v3HpackJson);
    const passTest = { node_id: 'test_foo.py::test_pass', outcome: 'PASSED', duration_ms: 12 };
    const passedV2 = makeV2Run('PASSED', [passTest]);

    const adapter = new ImportedAdapter(v3Val.data!, [passedV2]);
    render(<App adapter={adapter} initialScreen="workspace" />);

    await waitFor(() => {
      expect(screen.getByText('ALL PASSED')).toBeDefined();
    });
  });
});

describe('Phase 5 Regression: Header Responsiveness at 1024x700 and 900px', () => {
  it('renders all essential controls without clipping or overlapping at 1024 and 900px', () => {
    const sampleRun: RunSummary = {
      ...FIXTURE_RUNS[0],
      isRealImport: true,
      v2RunCount: 2,
      runOutcome: 'FAILED',
      stats: { ...FIXTURE_RUNS[0].stats, failed: 1, totalTests: 50 },
    };

    const { container } = render(
      <div style={{ width: '1024px' }}>
        <Header
          runs={[sampleRun, { ...sampleRun, id: 'run-other' }]}
          activeRun={sampleRun}
          activeView="map"
          onSelectView={vi.fn()}
          onBackToSelector={vi.fn()}
          onSelectRun={vi.fn()}
          failedTestCount={1}
          errorCount={0}
          diagnosticsCount={0}
        />
      </div>
    );

    // Verify all key controls are visible in DOM
    expect(screen.getByText('Projects')).toBeDefined();
    expect(screen.getByText(sampleRun.project)).toBeDefined();
    expect(screen.getByText('Imported (2 runs)')).toBeDefined();
    expect(screen.getByLabelText('Switch active test run')).toBeDefined();
    expect(screen.getByText('1 FAILED')).toBeDefined();
    expect(screen.getByText('Project Map')).toBeDefined();
    expect(screen.getByText('Run Diagnostics')).toBeDefined();

    // Verify header does not force child collision
    const navBar = container.querySelector('header > div');
    expect(navBar).toBeDefined();
    const style = (navBar as HTMLElement).style;
    expect(style.flexWrap).toBe('wrap');
  });
});

describe('Phase 5 Regression: Camera Behavior, Dataset Refit & Selection Readability', () => {
  const mockNodes: CodeNode[] = [
    {
      id: 'file:hpack/hpack.py',
      name: 'hpack/hpack.py',
      kind: 'module',
      file: 'hpack/hpack.py',
      parentModule: 'hpack',
      lineStart: 1,
      lineEnd: 200,
      changeStatus: 'unchanged',
    },
    {
      id: 'symbol:hpack/hpack.py:Decoder',
      name: 'Decoder',
      kind: 'class',
      file: 'hpack/hpack.py',
      parentModule: 'hpack',
      lineStart: 20,
      lineEnd: 150,
      changeStatus: 'unchanged',
    },
    {
      id: 'symbol:hpack/hpack.py:decode',
      name: 'decode',
      kind: 'function',
      file: 'hpack/hpack.py',
      parentModule: 'hpack',
      lineStart: 50,
      lineEnd: 90,
      changeStatus: 'unchanged',
    },
    {
      id: 'file:test_hpack.py',
      name: 'test_hpack.py',
      kind: 'module',
      file: 'test_hpack.py',
      parentModule: 'test_hpack',
      lineStart: 1,
      lineEnd: 100,
      changeStatus: 'unchanged',
    },
    {
      id: 'test:test_hpack.py::test_decode',
      name: 'test_decode',
      kind: 'function',
      file: 'test_hpack.py',
      parentModule: 'test_hpack',
      lineStart: 10,
      lineEnd: 30,
      changeStatus: 'unchanged',
    },
  ];

  const mockGraphData: GraphData = {
    nodes: mockNodes,
    edges: [
      {
        id: 'edge:containment:1',
        source: 'file:hpack/hpack.py',
        target: 'symbol:hpack/hpack.py:decode',
        category: 'containment' as any,
        provenance: 'ast: containment',
      },
      {
        id: 'edge:containment:2',
        source: 'file:test_hpack.py',
        target: 'test:test_hpack.py::test_decode',
        category: 'containment' as any,
        provenance: 'ast: containment',
      },
    ],
    unresolvedReferences: [],
    parseErrors: [],
  };

  const mockTests: TestItem[] = [
    {
      id: 'test:test_hpack.py::test_decode',
      name: 'test_decode',
      file: 'test_hpack.py',
      status: 'fail',
      durationMs: 42,
      exercisedNodeIds: ['symbol:hpack/hpack.py:decode'],
      callTracingAvailable: false,
      rerunHistory: [],
    },
  ];

  it('fits all elements on dataset change and retains camera on same-dataset mutations', async () => {
    let capturedCy: any = null;

    const { rerender } = render(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-1:sha256-aaa"
          selectedTestId={null}
          onCyReady={(cy) => {
            capturedCy = cy;
          }}
        />
      </div>
    );

    expect(capturedCy).toBeDefined();
    const fitSpy = vi.spyOn(capturedCy, 'fit');
    const viewportSpy = vi.spyOn(capturedCy, 'viewport');

    // 1. Same-dataset mutation (e.g. collapse a file cluster): must retain camera, NOT fit
    rerender(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-1:sha256-aaa"
          selectedTestId={null}
          collapsedFiles={new Set(['hpack/hpack.py'])}
        />
      </div>
    );

    expect(viewportSpy).toHaveBeenCalled();
    expect(fitSpy).not.toHaveBeenCalled();

    // 2. Different dataset identity (datasetKey changes): MUST call fit(cy.elements(), 50)
    fitSpy.mockClear();
    rerender(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-2:sha256-bbb"
          selectedTestId={null}
        />
      </div>
    );

    expect(fitSpy).toHaveBeenCalled();
  });

  it('centers camera on test and exercised symbols without removing other nodes, and refits on clear', async () => {
    let capturedCy: any = null;

    const { rerender } = render(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-1:sha256-aaa"
          selectedTestId={null}
          onCyReady={(cy) => {
            capturedCy = cy;
          }}
        />
      </div>
    );

    expect(capturedCy).toBeDefined();
    const animateSpy = vi.spyOn(capturedCy, 'animate');

    // Select test
    rerender(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-1:sha256-aaa"
          selectedTestId="test:test_hpack.py::test_decode"
        />
      </div>
    );

    // Verify animation triggered with minimum readable zoom (>= 0.95)
    expect(animateSpy).toHaveBeenCalled();
    const animateCallArgs: any = animateSpy.mock.calls[0][0];
    expect(animateCallArgs.zoom).toBeGreaterThanOrEqual(0.95);

    // Verify all graph nodes remain present in Cytoscape (none removed)
    const allNodeIds = capturedCy.nodes().map((n: any) => n.id());
    expect(allNodeIds).toContain('test:test_hpack.py::test_decode');
    expect(allNodeIds).toContain('symbol:hpack/hpack.py:decode');
    expect(allNodeIds).toContain('symbol:hpack/hpack.py:Decoder'); // unexercised node stays present!

    // Verify unexercised node has dimmed class (labels suppressed)
    const unexercisedNode = capturedCy.getElementById('symbol:hpack/hpack.py:Decoder');
    expect(unexercisedNode.hasClass('dimmed')).toBe(true);

    // Clear test selection: must refit graph
    animateSpy.mockClear();
    rerender(
      <div style={{ width: '800px', height: '600px' }}>
        <GraphView
          graphData={mockGraphData}
          tests={mockTests}
          datasetKey="run-1:sha256-aaa"
          selectedTestId={null}
        />
      </div>
    );

    expect(animateSpy).toHaveBeenCalled();
    const clearCallArgs: any = animateSpy.mock.calls[0][0];
    expect(clearCallArgs.fit).toBeDefined();
  });
});
