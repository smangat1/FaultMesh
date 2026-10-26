/**
 * FaultMesh UI Types
 *
 * FaultMesh is a local-first, open-source visual debugger for Python projects.
 * These types define the contract needed for visualizing run summaries,
 * pytest execution results, AST code nodes, and runtime/static evidence graphs.
 */

export type RunStatus = 'completed' | 'failed' | 'empty' | 'running';

export type TestStatus = 'pass' | 'fail' | 'error' | 'skipped';

export type ChangeStatus = 'added' | 'modified' | 'removed' | 'unchanged';

export type NodeKind = 'module' | 'function' | 'class' | 'method';

export type EdgeCategory = 'runtime_observed' | 'static_call' | 'static_import';

export type ReplayComparisonResult =
  | 'identical_failure'
  | 'different_failure'
  | 'passed_on_replay'
  | 'inconclusive';

export interface RerunRecord {
  rerunIndex: number;
  status: TestStatus;
  durationMs: number;
  timestamp: string;
  failureFingerprint?: string;
  sameFailureRecurred?: boolean;
  comparisonResult?: ReplayComparisonResult;
  message?: string;
}

export interface TestItem {
  id: string; // e.g. "tests/test_auth.py::test_login_expired_token"
  name: string;
  file: string;
  status: TestStatus;
  durationMs: number;
  failureMessage?: string;
  traceback?: string;
  rerunHistory: RerunRecord[];
  exercisedNodeIds: string[]; // Coverage (executed symbols)
  observedEdgeIds?: string[]; // Explicit observed runtime call edges
  unresolvedReferences?: string[];
  callTracingAvailable?: boolean;
}

export interface CodeNode {
  id: string; // e.g. "auth/tokens.py::validate_token"
  file: string;
  name: string;
  kind: NodeKind;
  lineStart: number;
  lineEnd: number;
  changeStatus: ChangeStatus;
  sourceSnippet: string;
  gitDiff?: string;
  parentModule: string;
  description?: string; // Grounded plain-English role explanation (sample)
  isUnresolved?: boolean;
  complexity?: number;
}

export interface FileCluster {
  file: string; // e.g. "auth/tokens.py"
  name: string; // e.g. "tokens.py"
  symbolCount: number;
  changeStatus: ChangeStatus;
  lineCount: number;
  role?: string; // Architectural role (e.g. "Token Authority", "Core Coordinator")
  tier?: string; // Architectural tier (e.g. "Security Subsystem", "Service Core")
  description?: string; // Plain-English grounded summary of what this file does
}

export interface PinnedSymbol {
  id: string;
  name: string;
  file: string;
  kind: NodeKind;
  changeStatus: ChangeStatus;
  description?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  category: EdgeCategory;
  provenance: string; // e.g., "pytest-trace: test_login_expired_token:L42" or "ast: import"
  observedCount?: number;
  testIds?: string[];
}

export interface UnresolvedReference {
  symbol: string;
  referencedFrom: string;
  line: number;
  reason: string;
}

export interface ParseError {
  file: string;
  line: number;
  message: string;
}

export interface GraphData {
  nodes: CodeNode[];
  edges: GraphEdge[];
  unresolvedReferences: UnresolvedReference[];
  parseErrors: ParseError[];
  files?: FileCluster[];
}

export interface RunSummary {
  id: string;
  project: string;
  gitRevision: string;
  gitBranch: string;
  commitMessage: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  isFixture: boolean;
  fixtureLabel: string;
  errorMessage?: string;
  stats: {
    totalTests: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
    totalNodes: number;
    codeNodes?: number;
    modifiedNodes: number;
    addedNodes?: number;
    totalChangedNodes?: number;
    coveragePct?: number;
  };
  limitations: string[];
  notes?: string[];
}

export interface TestEvidence {
  test: TestItem;
  coveredNodes: CodeNode[];
  executedEdges: GraphEdge[];
  unresolvedReferences: string[];
  observationNote: string;
  callTracingAvailable: boolean;
}

export interface SourceViewData {
  nodeId: string;
  file: string;
  name: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  gitDiff?: string;
  changeStatus: ChangeStatus;
}
