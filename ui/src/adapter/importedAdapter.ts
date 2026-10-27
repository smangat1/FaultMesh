import type { FaultMeshAdapter } from './interface';
import type {
  RunSummary,
  TestItem,
  GraphData,
  TestEvidence,
  SourceViewData,
  CodeNode,
  FileCluster,
  GraphEdge,
  NodeKind,
  ChangeStatus,
  UnresolvedReference,
  ParseError,
} from '../types';
import type {
  V3StructureExport,
  V2RunEvidenceExport,
  V3CoverageOverlay,
} from '../import';
import { joinV2CoverageToV3 } from '../import';

/**
 * ImportedAdapter
 *
 * Implements FaultMeshAdapter backed by authentic, user-imported V3 static structure
 * JSON exports and optional V2 test run evidence exports.
 *
 * Adheres strictly to the V3/V2 data contract:
 * - Real static structure mapping without fabricated source text, runtime edges, or speculative descriptions.
 * - Leaves unsupplied fields (role, tier, description, complexity, sourceSnippet) empty.
 * - Provides grounded metadata (signature, parameter names, bases, decorators, docstring, hashes).
 */
export class ImportedAdapter implements FaultMeshAdapter {
  private v3: V3StructureExport;
  private v2Runs: Map<string, V2RunEvidenceExport> = new Map();
  private activeV2RunId: string | null = null;
  private coverageOverlay: V3CoverageOverlay | null = null;

  constructor(v3: V3StructureExport, v2Runs: V2RunEvidenceExport[] = []) {
    this.v3 = v3;
    for (const run of v2Runs) {
      this.v2Runs.set(run.run.id, run);
    }
    if (v2Runs.length > 0) {
      this.activeV2RunId = v2Runs[0].run.id;
      this.coverageOverlay = joinV2CoverageToV3(this.v3, v2Runs[0]);
    } else if (this.v3.coverage_overlay) {
      this.coverageOverlay = this.v3.coverage_overlay;
    }
  }

  public getV3(): V3StructureExport {
    return this.v3;
  }

  public getV2Runs(): V2RunEvidenceExport[] {
    return Array.from(this.v2Runs.values());
  }

  public getActiveV2Run(): V2RunEvidenceExport | null {
    if (!this.activeV2RunId) return null;
    return this.v2Runs.get(this.activeV2RunId) || null;
  }

  public setActiveV2Run(runId: string): void {
    if (this.v2Runs.has(runId)) {
      this.activeV2RunId = runId;
      const v2 = this.v2Runs.get(runId)!;
      this.coverageOverlay = joinV2CoverageToV3(this.v3, v2);
    }
  }

  public addV2Run(run: V2RunEvidenceExport): void {
    this.v2Runs.set(run.run.id, run);
    if (!this.activeV2RunId) {
      this.activeV2RunId = run.run.id;
      this.coverageOverlay = joinV2CoverageToV3(this.v3, run);
    }
  }

  public getV2Run(runId: string): V2RunEvidenceExport | null {
    return this.v2Runs.get(runId) || null;
  }

  async getRuns(): Promise<RunSummary[]> {
    const gitSymbols = this.v3.git?.symbols || [];
    const modifiedSymbols = gitSymbols.filter((s) => s.status === 'modified').length;
    const addedSymbols = gitSymbols.filter((s) => s.status === 'added').length;

    // If no V2 runs imported, provide pure static structure summary
    if (this.v2Runs.size === 0) {
      const runId = this.v3.envelope.content_sha256.slice(0, 16);
      const summary: RunSummary = {
        id: runId,
        project: this.v3.envelope.project_name,
        gitRevision: this.v3.envelope.head_sha || 'uncommitted',
        gitBranch: this.v3.envelope.head_is_worktree ? 'worktree' : 'HEAD',
        commitMessage: this.v3.envelope.dirty ? 'Worktree (dirty modifications)' : 'Static structure scan',
        status: 'completed',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        isFixture: false,
        fixtureLabel: 'Real V3 Static Structure',
        isRealImport: true,
        envelopeHeadSha: this.v3.envelope.head_sha,
        envelopeBaseSha: this.v3.envelope.base_sha,
        isWorktree: this.v3.envelope.head_is_worktree,
        isDirty: this.v3.envelope.dirty,
        contentSha256: this.v3.envelope.content_sha256,
        unresolvedCount: this.v3.unresolved.length,
        parseErrorCount: this.v3.parse_errors.length,
        skipCount: this.v3.skips.length,
        externalModuleCount: this.v3.external_modules.length,
        v2RunCount: 0,
        stats: {
          totalTests: 0,
          passed: 0,
          failed: 0,
          errored: 0,
          skipped: 0,
          totalNodes: this.v3.files.length + this.v3.symbols.length,
          codeNodes: this.v3.symbols.length,
          modifiedNodes: modifiedSymbols,
          addedNodes: addedSymbols,
          totalChangedNodes: modifiedSymbols + addedSymbols,
        },
        limitations: this.v3.limitations || [],
      };
      return [summary];
    }

    // Generate a RunSummary for EACH imported V2 run
    const summaries: RunSummary[] = [];
    for (const v2 of this.v2Runs.values()) {
      let passed = 0;
      let failed = 0;
      let errored = 0;
      let skipped = 0;

      for (const t of v2.tests) {
        if (t.outcome === 'PASSED') passed++;
        else if (t.outcome === 'FAILED') failed++;
        else if (t.outcome === 'ERROR') errored++;
        else if (t.outcome === 'SKIPPED') skipped++;
      }

      const isReplay = Boolean(v2.run.replay);
      const label = isReplay ? 'Recorded Replay Run' : 'Recorded Pytest Run';
      const commitMsg = isReplay
        ? `Replay comparison (${v2.run.replay?.comparison || 'SAME_FAILURE'})`
        : (this.v3.envelope.dirty ? 'Worktree (dirty modifications)' : 'Recorded test evidence');

      summaries.push({
        id: v2.run.id,
        project: this.v3.envelope.project_name,
        gitRevision:
          v2.source_snapshot?.revision ||
          v2.run.target?.revision ||
          this.v3.envelope.head_sha ||
          'uncommitted',
        gitBranch: this.v3.envelope.head_is_worktree ? 'worktree' : 'HEAD',
        commitMessage: commitMsg,
        status: failed > 0 || errored > 0 ? 'failed' : 'completed',
        startedAt: v2.run.started_at || new Date().toISOString(),
        durationMs: v2.run.duration_ms || 0,
        isFixture: false,
        fixtureLabel: label,
        isRealImport: true,
        replayProvenance: v2.run.replay || undefined,
        envelopeHeadSha: this.v3.envelope.head_sha,
        envelopeBaseSha: this.v3.envelope.base_sha,
        isWorktree: this.v3.envelope.head_is_worktree,
        isDirty: this.v3.envelope.dirty,
        contentSha256: this.v3.envelope.content_sha256,
        unresolvedCount: this.v3.unresolved.length,
        parseErrorCount: this.v3.parse_errors.length,
        skipCount: this.v3.skips.length,
        externalModuleCount: this.v3.external_modules.length,
        v2RunCount: this.v2Runs.size,
        stats: {
          totalTests: v2.tests.length,
          passed,
          failed,
          errored,
          skipped,
          totalNodes: this.v3.files.length + this.v3.symbols.length,
          codeNodes: this.v3.symbols.length,
          modifiedNodes: modifiedSymbols,
          addedNodes: addedSymbols,
          totalChangedNodes: modifiedSymbols + addedSymbols,
        },
        limitations: this.v3.limitations || [],
      });
    }

    return summaries;
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const runs = await this.getRuns();
    return runs.find((r) => r.id === runId) || null;
  }

  async getTests(runId?: string): Promise<TestItem[]> {
    let targetV2 = this.getActiveV2Run();
    if (runId && this.v2Runs.has(runId)) {
      targetV2 = this.v2Runs.get(runId)!;
    }
    if (!targetV2) return [];

    const overlay =
      this.coverageOverlay && this.activeV2RunId === targetV2.run.id
        ? this.coverageOverlay
        : joinV2CoverageToV3(this.v3, targetV2);
    const testItems: TestItem[] = [];

    for (const testCase of targetV2.tests) {
      // Find all structure symbol IDs exercised by this test in the overlay
      const matchingEntries = overlay
        ? overlay.entries.filter((e) => e.test_id === testCase.node_id)
        : [];
      const exercisedNodeIds = matchingEntries.map((e) => e.structure_symbol_id);
      const isStale = matchingEntries.some((e) => e.stale);
      const staleSymbols = matchingEntries.filter((e) => e.stale).map((e) => e.qualified_name);

      const unmatchedForTest = overlay
        ? overlay.unmatched.filter((u) => u.test_id === testCase.node_id)
        : [];

      // Map status
      let status: 'pass' | 'fail' | 'error' | 'skipped' = 'pass';
      if (testCase.outcome === 'FAILED') status = 'fail';
      else if (testCase.outcome === 'ERROR') status = 'error';
      else if (testCase.outcome === 'SKIPPED') status = 'skipped';

      const phases = (testCase.phases || []).map((p: any) => ({
        phase: p.phase,
        outcome: p.outcome,
        durationMs: p.duration_ms,
        failureText: p.failure_text,
      }));

      testItems.push({
        id: testCase.node_id,
        name: testCase.node_id.split('::').slice(1).join('::') || testCase.node_id,
        file: testCase.node_id.split('::')[0] || '',
        status,
        durationMs: testCase.duration_ms || 0,
        failureMessage: testCase.failure_text || undefined,
        traceback: testCase.failure_text || undefined,
        failureFingerprint: testCase.failure_fingerprint,
        failureText: testCase.failure_text,
        phases,
        rerunHistory: [],
        exercisedNodeIds,
        // Crucial real data rule: NO runtime call arrows or step badges!
        observedEdgeIds: [],
        callTracingAvailable: false,
        staleCoverage: isStale,
        unmatchedCount: unmatchedForTest.length,
        staleSymbols,
      });
    }

    return testItems;
  }

  async getTest(runId: string, testId: string): Promise<TestItem | null> {
    const tests = await this.getTests(runId);
    return tests.find((t) => t.id === testId) || null;
  }

  async getGraph(_runId: string): Promise<GraphData> {
    // 1. Map files to FileClusters
    const gitFiles = new Map<string, string>();
    if (this.v3.git?.files) {
      for (const gf of this.v3.git.files) {
        gitFiles.set(gf.path, gf.status);
      }
    }

    const files: FileCluster[] = this.v3.files.map((f) => {
      const gitStatusStr = gitFiles.get(f.path) || (f.removed ? 'deleted' : 'unchanged');
      let changeStatus: ChangeStatus = 'unchanged';
      if (gitStatusStr === 'added') changeStatus = 'added';
      else if (gitStatusStr === 'modified') changeStatus = 'modified';
      else if (gitStatusStr === 'deleted' || f.removed) changeStatus = 'removed';

      return {
        file: f.path,
        name: f.path.split('/').pop() || f.path,
        symbolCount: this.v3.symbols.filter((s) => s.path === f.path).length,
        changeStatus,
        lineCount: f.line_count,
        isGhost: Boolean(f.removed && f.revision_side === 'base'),
        revisionSide: f.revision_side,
        contentHash: f.content_sha256,
        isTest: f.is_test,
        parseError: f.parse_error,
        gitStatus: gitStatusStr,
        // role, tier, description left undefined
      };
    });

    // 2. Map symbols to CodeNodes
    const gitSymbols = new Map<string, string>();
    if (this.v3.git?.symbols) {
      for (const gs of this.v3.git.symbols) {
        gitSymbols.set(gs.symbol_id, gs.status);
      }
    }

    const nodes: CodeNode[] = this.v3.symbols.map((s) => {
      const gitStatusStr = gitSymbols.get(s.id) || (s.removed ? 'removed' : 'unchanged');
      let changeStatus: ChangeStatus = 'unchanged';
      if (gitStatusStr === 'added') changeStatus = 'added';
      else if (gitStatusStr === 'modified') changeStatus = 'modified';
      else if (gitStatusStr === 'removed' || s.removed) changeStatus = 'removed';

      let kind: NodeKind = 'function';
      if (s.kind === 'class') kind = 'class';
      else if (s.kind === 'method' || s.kind === 'async_method') kind = 'method';

      return {
        id: s.id,
        file: s.path,
        name: s.qualified_name,
        kind,
        lineStart: s.start_line,
        lineEnd: s.end_line,
        changeStatus,
        parentModule: s.parent_id,
        signature: s.signature,
        parameterNames: s.parameter_names,
        decorators: s.decorators,
        bases: s.bases,
        docstringFirstLine: s.docstring?.text || null,
        contentHash: s.content_sha256,
        isGhost: Boolean(s.removed && s.revision_side === 'base'),
        revisionSide: s.revision_side,
        parentId: s.parent_id,
        qualifiedName: s.qualified_name,
        // sourceSnippet, description, complexity left undefined
      };
    });

    // 3. Map edges
    const edges: GraphEdge[] = this.v3.edges.map((e) => {
      let category: 'static_call' | 'static_import' = 'static_call';
      if (e.kind === 'imports') category = 'static_import';

      const provenance =
        e.confidence === 'ambiguous'
          ? `static (ambiguous, ${e.resolution_reason}): ${e.callsite_path}:${e.callsite_line}`
          : `static (${e.resolution_reason}): ${e.callsite_path}:${e.callsite_line}`;

      return {
        id: e.id,
        source: e.source_id,
        target: e.target_id || '',
        category,
        provenance,
        confidence: e.confidence,
        kind: e.kind,
        callsiteLine: e.callsite_line,
        callsitePath: e.callsite_path,
        resolutionReason: e.resolution_reason,
        isGhost: Boolean(e.removed && e.revision_side === 'base'),
        revisionSide: e.revision_side,
        externalModule: e.external_module,
      };
    });

    // 4. Map unresolved references
    const unresolvedReferences: UnresolvedReference[] = this.v3.unresolved.map((u) => ({
      symbol: u.text,
      referencedFrom: u.path,
      line: u.line,
      reason: u.reason,
    }));

    // 5. Map parse errors
    const parseErrors: ParseError[] = this.v3.parse_errors.map((p) => ({
      file: p.path,
      line: p.line || 1,
      message: p.message,
    }));

    return {
      nodes,
      edges,
      unresolvedReferences,
      parseErrors,
      files,
    };
  }

  async getTestEvidence(runId: string, testId: string): Promise<TestEvidence | null> {
    const test = await this.getTest(runId, testId);
    if (!test) return null;

    const graph = await this.getGraph(runId);
    const coveredNodes = graph.nodes.filter((n) => test.exercisedNodeIds.includes(n.id));

    return {
      test,
      coveredNodes,
      // Crucial rule: Test coverage never creates call edges or call order
      executedEdges: [],
      unresolvedReferences: [],
      observationNote: test.staleCoverage
        ? 'Stale coverage overlay: source file hash or commit revision has changed since test run.'
        : `Observed coverage executed ${coveredNodes.length} symbols during pytest run. Static edges remain possibilities, not confirmed calls.`,
      callTracingAvailable: false,
    };
  }

  async getSource(runId: string, nodeId: string): Promise<SourceViewData | null> {
    const graph = await this.getGraph(runId);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    return {
      nodeId: node.id,
      file: node.file,
      name: node.name,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      snippet: undefined, // Contract: neither format contains source text.
      signature: node.signature,
      parameterNames: node.parameterNames,
      decorators: node.decorators,
      bases: node.bases,
      docstringFirstLine: node.docstringFirstLine,
      contentHash: node.contentHash,
      changeStatus: node.changeStatus,
      hasSourceText: false,
      isGhost: node.isGhost,
      revisionSide: node.revisionSide,
    };
  }
}
