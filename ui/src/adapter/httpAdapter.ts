import type { FaultMeshAdapter } from './interface';
import type {
  RunSummary,
  TestItem,
  GraphData,
  TestEvidence,
  SourceViewData,
} from '../types';

/**
 * HttpAdapter (Stub)
 *
 * This adapter is intentionally unimplemented.
 * The backend HTTP/Evidence store contract is actively under development
 * by Codex in the parallel backend worktree.
 *
 * DO NOT invent mock REST or GraphQL endpoints here. Real integration will be
 * connected once the Python server and SQLite schema stabilize.
 *
 * For now, all UI development and visualization testing uses FixtureAdapter.
 */
export class HttpAdapter implements FaultMeshAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api/v1') {
    this.baseUrl = baseUrl;
  }

  async getRuns(): Promise<RunSummary[]> {
    throw new Error(
      `HttpAdapter.getRuns() not implemented. Target: ${this.baseUrl}/runs. ` +
        'Backend service contract is pending Milestone 2 completion.'
    );
  }

  async getRun(_runId: string): Promise<RunSummary | null> {
    throw new Error(
      `HttpAdapter.getRun() not implemented. Backend service contract is pending.`
    );
  }

  async getTests(_runId: string): Promise<TestItem[]> {
    throw new Error(
      `HttpAdapter.getTests() not implemented. Backend service contract is pending.`
    );
  }

  async getTest(_runId: string, _testId: string): Promise<TestItem | null> {
    throw new Error(
      `HttpAdapter.getTest() not implemented. Backend service contract is pending.`
    );
  }

  async getGraph(_runId: string): Promise<GraphData> {
    throw new Error(
      `HttpAdapter.getGraph() not implemented. Backend service contract is pending.`
    );
  }

  async getTestEvidence(
    _runId: string,
    _testId: string
  ): Promise<TestEvidence | null> {
    throw new Error(
      `HttpAdapter.getTestEvidence() not implemented. Backend service contract is pending.`
    );
  }

  async getSource(
    _runId: string,
    _nodeId: string
  ): Promise<SourceViewData | null> {
    throw new Error(
      `HttpAdapter.getSource() not implemented. Backend service contract is pending.`
    );
  }
}
