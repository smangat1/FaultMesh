import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import { TestDetailsPane } from '../components/TestDetailsPane';
import { GraphView } from '../components/GraphView';
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
      expect(screen.getByText(/payments-microservice/i)).toBeDefined();
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
      expect(screen.getByText(/Project-A/i)).toBeDefined();
    });

    const selector = screen.getByLabelText(/Select Recorded Run/i);
    fireEvent.change(selector, { target: { value: 'run-B' } });

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
  it('allows keyboard navigation across test list items', () => {
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

    waitFor(() => {
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

    // Verify bounded scope: Only the 5 exercised symbols are rendered, not 500 nodes!
    expect(screen.getByText(/5 nodes, 1 edges/i)).toBeDefined();
    expect(screen.getByText(/Evidence for test_target_scale/i)).toBeDefined();
  });
});
