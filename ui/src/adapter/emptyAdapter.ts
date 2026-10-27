import type { FaultMeshAdapter } from './interface';
import type { GraphData, RunSummary, SourceViewData, TestEvidence, TestItem } from '../types';

export class EmptyAdapter implements FaultMeshAdapter {
  async getRuns(): Promise<RunSummary[]> {
    return [];
  }

  async getRun(_runId: string): Promise<RunSummary | null> {
    return null;
  }

  async getTests(_runId: string): Promise<TestItem[]> {
    return [];
  }

  async getTest(_runId: string, _testId: string): Promise<TestItem | null> {
    return null;
  }

  async getGraph(_runId: string): Promise<GraphData> {
    return {
      nodes: [],
      edges: [],
      unresolvedReferences: [],
      parseErrors: [],
      files: [],
    };
  }

  async getTestEvidence(_runId: string, _testId: string): Promise<TestEvidence | null> {
    return null;
  }

  async getSource(_runId: string, _nodeId: string): Promise<SourceViewData | null> {
    return null;
  }
}
