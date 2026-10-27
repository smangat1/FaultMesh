import { ImportedAdapter } from '../adapter/importedAdapter';
import type { FaultMeshAdapter } from '../adapter/interface';
import type {
  V2RunEvidenceExport,
  V3FileNode,
  V3StructureExport,
  V3SymbolNode,
} from '../import';
import type { GraphData, RunSummary, SourceViewData, TestEvidence, TestItem } from '../types';
import type { LineRange, SpectateEvent, StaleRelationshipPath } from './types';

export type LiveSessionStatus = 'idle' | 'live' | 'stopped' | 'error';

export interface LiveFileChange {
  path: string;
  kind: 'created' | 'modified' | 'deleted' | 'renamed';
  sha256: string | null;
  ranges: LineRange[];
  parseError: string | null;
  affectedNodeIds: string[];
  updatedAt: string;
}

export interface LiveTextFact {
  path: string;
  sha256?: string;
  text: string | null;
  skippedReason: string | null;
  truncated?: boolean;
}

export interface LiveFileRecord {
  path: string;
  kind: 'created' | 'modified' | 'deleted' | 'renamed';
  updatedAt: string;
  timestamp: number;
  sha256: string | null;
  ranges: LineRange[];
  parseError: string | null;
  diff?: string | null;
  source?: string | null;
}

export interface LiveSpectateState {
  status: LiveSessionStatus;
  initialized: boolean;
  sessionId: string | null;
  projectName: string | null;
  sequence: number;
  files: V3FileNode[];
  symbols: V3SymbolNode[];
  edges: NonNullable<SpectateEvent['edges']>;
  unresolved: NonNullable<SpectateEvent['unresolved']>;
  externalModules: string[];
  skips: NonNullable<SpectateEvent['structure']>['skips'];
  stalePaths: StaleRelationshipPath[];
  partialReasons: string[];
  changedNodeIds: string[];
  change: LiveFileChange | null;
  source: LiveTextFact | null;
  diff: LiveTextFact | null;
  fileHistory: LiveFileRecord[];
  evidenceStalePaths: string[];
  stopReason: string | null;
}

export type LiveSpectateAction =
  | SpectateEvent
  | { event: 'local_stop'; reason: string };

export const EMPTY_LIVE_SPECTATE_STATE: LiveSpectateState = {
  status: 'idle',
  initialized: false,
  sessionId: null,
  projectName: null,
  sequence: 0,
  files: [],
  symbols: [],
  edges: [],
  unresolved: [],
  externalModules: [],
  skips: [],
  stalePaths: [],
  partialReasons: [],
  changedNodeIds: [],
  change: null,
  source: null,
  diff: null,
  fileHistory: [],
  evidenceStalePaths: [],
  stopReason: null,
};

const unique = (values: string[]): string[] => Array.from(new Set(values)).sort();

export function reduceLiveSpectate(
  state: LiveSpectateState,
  action: LiveSpectateAction,
): LiveSpectateState {
  if (action.event === 'local_stop') {
    return { ...state, status: 'stopped', stopReason: action.reason };
  }
  if (action.event === 'session_started') {
    return {
      ...EMPTY_LIVE_SPECTATE_STATE,
      status: 'live',
      sessionId: action.session_id,
      projectName: action.root_display_name ?? 'project',
      sequence: action.sequence,
    };
  }
  if (state.sessionId !== action.session_id) return state;

  if (action.event === 'initial_snapshot' && action.structure) {
    return {
      ...state,
      initialized: true,
      sequence: action.sequence,
      files: [...action.structure.files].sort((a, b) => a.path.localeCompare(b.path)),
      symbols: [...action.structure.symbols].sort((a, b) =>
        a.path === b.path ? a.start_line - b.start_line || a.id.localeCompare(b.id) : a.path.localeCompare(b.path),
      ),
      skips: action.structure.skips,
    };
  }
  if (action.event === 'file_changed' && action.path && action.kind) {
    const renamedFrom = action.kind === 'renamed' ? action.from_path : null;
    const newRecord: LiveFileRecord = {
      path: action.path,
      kind: action.kind,
      updatedAt: action.emitted_at,
      timestamp: Date.now(),
      sha256: action.new_sha256 ?? null,
      ranges: action.changed_line_ranges ?? [],
      parseError: action.parse_error ?? null,
    };
    const prevHistory = state.fileHistory.filter(
      (item) => item.path !== action.path && (renamedFrom ? item.path !== renamedFrom : true)
    );
    return {
      ...state,
      sequence: action.sequence,
      files: renamedFrom ? state.files.filter((file) => file.path !== renamedFrom) : state.files,
      symbols: renamedFrom ? state.symbols.filter((symbol) => symbol.path !== renamedFrom) : state.symbols,
      changedNodeIds: unique([
        ...(action.affected_file_ids ?? []),
        ...(action.affected_symbol_ids ?? []),
      ]),
      change: {
        path: action.path,
        kind: action.kind,
        sha256: action.new_sha256 ?? null,
        ranges: action.changed_line_ranges ?? [],
        parseError: action.parse_error ?? null,
        affectedNodeIds: unique([
          ...(action.affected_file_ids ?? []),
          ...(action.affected_symbol_ids ?? []),
        ]),
        updatedAt: action.emitted_at,
      },
      fileHistory: [newRecord, ...prevHistory],
      source: null,
      diff: null,
    };
  }
  if (action.event === 'source' && action.path) {
    const updatedHistory = state.fileHistory.map((item) =>
      item.path === action.path ? { ...item, source: action.text ?? null } : item
    );
    return {
      ...state,
      sequence: action.sequence,
      fileHistory: updatedHistory,
      source: action.path === state.change?.path ? {
        path: action.path,
        sha256: action.sha256,
        text: action.text ?? null,
        skippedReason: action.skipped_reason ?? null,
      } : state.source,
    };
  }
  if (action.event === 'diff' && action.path) {
    const updatedHistory = state.fileHistory.map((item) =>
      item.path === action.path ? { ...item, diff: action.text ?? null } : item
    );
    return {
      ...state,
      sequence: action.sequence,
      fileHistory: updatedHistory,
      diff: action.path === state.change?.path ? {
        path: action.path,
        text: action.text ?? null,
        skippedReason: action.skipped_reason ?? null,
        truncated: action.truncated,
      } : state.diff,
    };
  }
  if (action.event === 'structure_update' && action.path) {
    const nextFiles = state.files.filter((file) => file.path !== action.path);
    if (action.file) nextFiles.push(action.file);
    const nextSymbols = [
      ...state.symbols.filter((symbol) => symbol.path !== action.path),
      ...(action.symbols ?? []),
    ];
    const changedNodeIds = unique(action.changed_node_ids ?? state.changedNodeIds);
    const updatedHistory = state.fileHistory.map((item) =>
      item.path === action.path
        ? { ...item, parseError: action.parse_error ?? null }
        : item
    );
    return {
      ...state,
      sequence: action.sequence,
      files: nextFiles.sort((a, b) => a.path.localeCompare(b.path)),
      symbols: nextSymbols.sort((a, b) =>
        a.path === b.path ? a.start_line - b.start_line || a.id.localeCompare(b.id) : a.path.localeCompare(b.path),
      ),
      changedNodeIds,
      fileHistory: updatedHistory,
      change: state.change && state.change.path === action.path
        ? {
            ...state.change,
            parseError: action.parse_error ?? null,
            affectedNodeIds: changedNodeIds,
          }
        : state.change,
    };
  }
  if (action.event === 'relationship_update') {
    return {
      ...state,
      sequence: action.sequence,
      edges: action.edges ?? [],
      unresolved: action.unresolved ?? [],
      externalModules: action.external_modules ?? [],
      stalePaths: action.stale_paths ?? [],
      partialReasons: action.partial_reasons ?? [],
    };
  }
  if (action.event === 'evidence_stale' && action.path) {
    return {
      ...state,
      sequence: action.sequence,
      evidenceStalePaths: unique([...state.evidenceStalePaths, action.path]),
    };
  }
  if (action.event === 'root_missing') {
    return {
      ...state,
      status: 'error',
      sequence: action.sequence,
      stopReason: `root_${action.reason ?? 'missing'}`,
    };
  }
  if (action.event === 'session_ended') {
    return {
      ...state,
      status: 'stopped',
      sequence: action.sequence,
      stopReason: action.reason ?? 'session ended',
    };
  }
  return { ...state, sequence: action.sequence };
}

function parseErrorLine(message: string): number | null {
  const match = / at line (\d+)$/.exec(message);
  return match ? Number(match[1]) : null;
}

export function liveStateToV3(state: LiveSpectateState): V3StructureExport {
  const edgeCounts: Record<string, number> = {};
  for (const edge of state.edges) {
    const key = `${edge.kind}:${edge.confidence}`;
    edgeCounts[key] = (edgeCounts[key] ?? 0) + 1;
  }
  const parseErrors = state.files
    .filter((file) => Boolean(file.parse_error))
    .map((file) => ({
      path: file.path,
      line: parseErrorLine(file.parse_error ?? ''),
      message: file.parse_error ?? 'parse error',
    }));
  const limitations = [
    'Live static structure only; tests are not rerun.',
    ...state.partialReasons.map((reason) => `Relationship view partial: ${reason}.`),
    ...state.stalePaths.map((item) =>
      `Structure from last good parse is stale for ${item.path} (${item.last_good_sha256} != ${item.current_sha256}).`,
    ),
    ...state.evidenceStalePaths.map((path) => `Imported evidence is stale for ${path}.`),
  ];
  return {
    schema_version: '3.0',
    envelope: {
      project_name: state.projectName ?? 'project',
      base_sha: null,
      head_sha: null,
      head_is_worktree: true,
      dirty: true,
      content_sha256: `live:${state.sessionId ?? 'pending'}`,
    },
    files: state.files,
    symbols: state.symbols,
    edges: state.edges,
    unresolved: state.unresolved,
    external_modules: state.externalModules,
    git: {
      available: false,
      error: 'Live watch does not request Git comparison facts.',
      files: [],
      symbols: [],
    },
    skips: state.skips,
    parse_errors: parseErrors,
    limitations,
    counts: {
      files: state.files.length,
      current_files: state.files.length,
      ghost_files: 0,
      symbols: state.symbols.length,
      current_symbols: state.symbols.length,
      ghost_symbols: 0,
      edges_by_kind_and_confidence: edgeCounts,
      unresolved: state.unresolved.length,
      external_modules: state.externalModules.length,
      skipped: state.skips.reduce((total, item) => total + item.count, 0),
      parse_errors: parseErrors.length,
    },
    possible_impact: [],
    coverage_overlay: null,
  };
}

function applyLiveFacts(graph: GraphData, state: LiveSpectateState): GraphData {
  const changed = new Set(state.changedNodeIds);
  const stale = new Set(state.stalePaths.map((item) => item.path));
  const fileHashes = new Map(state.files.map((file) => [file.path, file.content_sha256]));
  const sourceMatches = Boolean(
    state.source?.text !== null
      && state.source?.sha256
      && state.source.sha256 === fileHashes.get(state.source.path),
  );
  const sourceLines = sourceMatches ? state.source?.text?.split(/\r?\n/) ?? [] : [];
  return {
    ...graph,
    files: graph.files?.map((file) => ({
      ...file,
      changeStatus: changed.has(`file:${file.file}`)
        ? state.change?.kind === 'created' ? 'added' : 'modified'
        : file.changeStatus,
      structureStale: stale.has(file.file),
    })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      changeStatus: changed.has(node.id)
        ? state.change?.kind === 'created' ? 'added' : 'modified'
        : node.changeStatus,
      structureStale: stale.has(node.file),
      sourceSnippet:
        sourceMatches && state.source?.path === node.file
          ? sourceLines.slice(node.lineStart - 1, node.lineEnd).join('\n')
          : undefined,
      gitDiff: state.diff?.path === node.file ? state.diff.text ?? undefined : undefined,
    })),
  };
}

export class LiveSpectateAdapter implements FaultMeshAdapter {
  private state: LiveSpectateState;
  private readonly v2Runs: V2RunEvidenceExport[];
  private delegate: ImportedAdapter;
  private activeRunId: string | null = null;

  constructor(state: LiveSpectateState, v2Runs: V2RunEvidenceExport[] = []) {
    this.state = state;
    this.v2Runs = [...v2Runs];
    this.delegate = new ImportedAdapter(liveStateToV3(state), this.v2Runs);
  }

  getSessionId(): string | null {
    return this.state.sessionId;
  }

  getState(): LiveSpectateState {
    return this.state;
  }

  getV2Runs(): V2RunEvidenceExport[] {
    return [...this.v2Runs];
  }

  update(state: LiveSpectateState): void {
    this.state = state;
    this.delegate = new ImportedAdapter(liveStateToV3(state), this.v2Runs);
    if (this.activeRunId) this.delegate.setActiveV2Run(this.activeRunId);
  }

  setActiveV2Run(runId: string): void {
    this.activeRunId = runId;
    this.delegate.setActiveV2Run(runId);
  }

  addV2Run(run: V2RunEvidenceExport): void {
    this.v2Runs.push(run);
    this.update(this.state);
  }

  async getRuns(): Promise<RunSummary[]> {
    const runs = await this.delegate.getRuns();
    return runs.map((run) => ({
      ...run,
      project: this.state.projectName ?? run.project,
      gitRevision: 'current',
      gitBranch: 'watched',
      commitMessage:
        this.state.status === 'live'
          ? 'Live structure (no tests rerun)'
          : `Stopped · last known (${this.state.stopReason ?? 'session ended'})`,
      status: this.v2Runs.length > 0
        ? run.status
        : this.state.status === 'live' ? 'running' : 'empty',
      fixtureLabel:
        this.state.status === 'live'
          ? `Live: ${this.state.projectName ?? 'project'}`
          : `Stopped · last known: ${this.state.projectName ?? 'project'}`,
      isFixture: false,
      isRealImport: true,
      isLive: true,
      liveStatus: this.state.status,
      contentSha256: `live:${this.state.sessionId ?? 'pending'}`,
      limitations: liveStateToV3(this.state).limitations,
    }));
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    return (await this.getRuns()).find((run) => run.id === runId) ?? null;
  }

  getTests(runId: string): Promise<TestItem[]> {
    return this.delegate.getTests(runId);
  }

  getTest(runId: string, testId: string): Promise<TestItem | null> {
    return this.delegate.getTest(runId, testId);
  }

  async getGraph(runId: string): Promise<GraphData> {
    return applyLiveFacts(await this.delegate.getGraph(runId), this.state);
  }

  getTestEvidence(runId: string, testId: string): Promise<TestEvidence | null> {
    return this.delegate.getTestEvidence(runId, testId);
  }

  async getSource(runId: string, nodeId: string): Promise<SourceViewData | null> {
    const graph = await this.getGraph(runId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    return {
      nodeId: node.id,
      file: node.file,
      name: node.name,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      snippet: node.sourceSnippet,
      gitDiff: node.gitDiff,
      changeStatus: node.changeStatus,
      signature: node.signature,
      parameterNames: node.parameterNames,
      decorators: node.decorators,
      bases: node.bases,
      docstringFirstLine: node.docstringFirstLine,
      contentHash: node.contentHash,
      hasSourceText: Boolean(node.sourceSnippet),
      isGhost: node.isGhost,
      revisionSide: node.revisionSide,
    };
  }
}
