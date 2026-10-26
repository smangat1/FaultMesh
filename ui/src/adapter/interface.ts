import type {
  RunSummary,
  TestItem,
  GraphData,
  TestEvidence,
  SourceViewData,
} from '../types';

/**
 * Narrow data access adapter for FaultMesh UI.
 *
 * All data access in the UI goes through this contract.
 * Currently backed by FixtureAdapter; HttpAdapter is stubbed out
 * pending Codex backend implementation.
 */
export interface FaultMeshAdapter {
  /**
   * Return all known runs (historical and current).
   */
  getRuns(): Promise<RunSummary[]>;

  /**
   * Return metadata and summary for a single run by ID.
   */
  getRun(runId: string): Promise<RunSummary | null>;

  /**
   * Return list of tests executed in a given run.
   */
  getTests(runId: string): Promise<TestItem[]>;

  /**
   * Return a single test item with rerun history and traceback.
   */
  getTest(runId: string, testId: string): Promise<TestItem | null>;

  /**
   * Return full AST code nodes and static/observed edges for a run.
   */
  getGraph(runId: string): Promise<GraphData>;

  /**
   * Return test-specific execution evidence (nodes & edges actually traversed).
   */
  getTestEvidence(runId: string, testId: string): Promise<TestEvidence | null>;

  /**
   * Return code source snippet and git diff for a specific node.
   */
  getSource(runId: string, nodeId: string): Promise<SourceViewData | null>;
}
