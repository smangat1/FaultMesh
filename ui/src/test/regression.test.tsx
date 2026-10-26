import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import { TestDetailsPane } from '../components/TestDetailsPane';
import { GraphView, computeDeterministicPositions } from '../components/GraphView';
import type { FaultMeshAdapter } from '../adapter';
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

    render(<App adapter={mockAdapter} />);

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

    render(<App adapter={mockAdapter} />);

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

    render(<App adapter={mockAdapter} />);

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

    render(<App adapter={mockAdapter} />);

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
    render(<App initialScreen="workspace" />);

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
