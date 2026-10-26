import type { FaultMeshAdapter } from './interface';
import type {
  RunSummary,
  TestItem,
  GraphData,
  TestEvidence,
  SourceViewData,
} from '../types';
import { FIXTURE_RUNS, FIXTURE_TESTS, FIXTURE_GRAPH } from '../fixtures';

/**
 * FixtureAdapter
 *
 * Implements FaultMeshAdapter backed by realistic, deterministic fixture data.
 * Used for visual prototype exploration and frontend test suites.
 */
export class FixtureAdapter implements FaultMeshAdapter {
  private readonly delayMs: number;

  constructor(delayMs: number = 20) {
    this.delayMs = delayMs;
  }

  private async simulateLatency<T>(data: T): Promise<T> {
    if (this.delayMs <= 0) return data;
    return new Promise((resolve) => setTimeout(() => resolve(data), this.delayMs));
  }

  async getRuns(): Promise<RunSummary[]> {
    return this.simulateLatency([...FIXTURE_RUNS]);
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const run = FIXTURE_RUNS.find((r) => r.id === runId);
    return this.simulateLatency(run ? { ...run } : null);
  }

  async getTests(runId: string): Promise<TestItem[]> {
    const tests = FIXTURE_TESTS[runId] || [];
    return this.simulateLatency([...tests]);
  }

  async getTest(runId: string, testId: string): Promise<TestItem | null> {
    const tests = FIXTURE_TESTS[runId] || [];
    const test = tests.find((t) => t.id === testId);
    return this.simulateLatency(test ? { ...test } : null);
  }

  async getGraph(runId: string): Promise<GraphData> {
    const graph = FIXTURE_GRAPH[runId] || {
      nodes: [],
      edges: [],
      unresolvedReferences: [],
      parseErrors: [],
    };
    return this.simulateLatency({
      nodes: [...graph.nodes],
      edges: [...graph.edges],
      unresolvedReferences: [...graph.unresolvedReferences],
      parseErrors: [...graph.parseErrors],
    });
  }

  async getTestEvidence(
    runId: string,
    testId: string
  ): Promise<TestEvidence | null> {
    const tests = FIXTURE_TESTS[runId] || [];
    const test = tests.find((t) => t.id === testId);
    if (!test) return this.simulateLatency(null);

    const graph = FIXTURE_GRAPH[runId] || { nodes: [], edges: [] };
    const coveredNodes = graph.nodes.filter((node) =>
      test.exercisedNodeIds.includes(node.id)
    );

    // Require explicit per-test edge provenance for observed calls.
    // A test covering node A and node B does NOT imply a call A -> B.
    // Edge must be explicitly attributed via testIds.
    const executedEdges = graph.edges.filter(
      (edge) =>
        edge.category === 'runtime_observed' &&
        Boolean(edge.testIds && edge.testIds.includes(testId))
    );

    const callTracingAvailable = executedEdges.length > 0;

    const modifiedCovered = coveredNodes.filter(
      (n) => n.changeStatus === 'modified' || n.changeStatus === 'added'
    );

    let observationNote: string;
    if (callTracingAvailable) {
      observationNote =
        modifiedCovered.length > 0
          ? `Observed, not proven cause: ${modifiedCovered
              .map((n) => `${n.name} (${n.changeStatus})`)
              .join(', ')} was executed during ${
              test.name
            }. Observed execution correlation does not establish defect cause.`
          : `Observed execution path: ${coveredNodes.length} code nodes traversed during ${test.name}.`;
    } else {
      observationNote =
        coveredNodes.length > 0
          ? `Coverage association: ${coveredNodes.length} code nodes recorded as covered by ${test.name}. Call tracing is unavailable for this test.`
          : `No coverage recorded for ${test.name}.`;
    }

    return this.simulateLatency({
      test: { ...test },
      coveredNodes,
      executedEdges,
      unresolvedReferences: test.unresolvedReferences || [],
      observationNote,
      callTracingAvailable,
    });
  }

  async getSource(
    runId: string,
    nodeId: string
  ): Promise<SourceViewData | null> {
    const graph = FIXTURE_GRAPH[runId];
    if (!graph) return this.simulateLatency(null);

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return this.simulateLatency(null);

    return this.simulateLatency({
      nodeId: node.id,
      file: node.file,
      name: node.name,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      snippet: node.sourceSnippet,
      gitDiff: node.gitDiff,
      changeStatus: node.changeStatus,
    });
  }
}
