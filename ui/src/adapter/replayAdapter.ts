import type { FaultMeshAdapter } from './interface';
import type {
  RunSummary,
  TestItem,
  GraphData,
  TestEvidence,
  SourceViewData,
  CodeNode,
  FileCluster,
  ChangeStatus,
} from '../types';
import type {
  AnyReplayExport,
  ReplayOrigin,
  ReplaySession,
  TimelineEntry,
  ReplayChapter,
  ChapterRunRecord,
  StepNarration,
  StructuredTestEvidence,
  AttributionStatus,
  Completeness,
  ChangeType,
} from '../replay/types';
import { isReplayExportV2 } from '../replay/types';
import { decodeBase64ToUtf8 } from '../replay/utils';

export class ReplayAdapter implements FaultMeshAdapter {
  private readonly exported: AnyReplayExport;
  private readonly origin: ReplayOrigin;
  private currentSequence: number;
  private useBaselineChapters: boolean = false;

  constructor(exported: AnyReplayExport, origin: ReplayOrigin = 'real_recording') {
    this.exported = exported;
    this.origin = origin;
    // Default current sequence to the first timeline entry if available
    this.currentSequence = exported.timeline.length > 0 ? exported.timeline[0].sequence : 1;
  }

  public getExport(): AnyReplayExport {
    return this.exported;
  }

  public getOrigin(): ReplayOrigin {
    return this.origin;
  }

  public getSession(): ReplaySession {
    return this.exported.session;
  }

  public getLimitations(): string[] {
    return this.exported.limitations || [];
  }

  public getCurrentSequence(): number {
    return this.currentSequence;
  }

  public setCurrentSequence(sequence: number): void {
    const entry = this.exported.timeline.find((t) => t.sequence === sequence);
    if (entry) {
      this.currentSequence = sequence;
    }
  }

  public getTimeline(): TimelineEntry[] {
    return this.exported.timeline;
  }

  public getTimelineEntry(sequence: number): TimelineEntry | null {
    return this.exported.timeline.find((t) => t.sequence === sequence) || null;
  }

  public setUseBaselineChapters(useBaseline: boolean): void {
    this.useBaselineChapters = useBaseline;
  }

  public isUsingBaselineChapters(): boolean {
    return this.useBaselineChapters;
  }

  public isModelNarrationAvailable(): boolean {
    if (!isReplayExportV2(this.exported)) return false;
    return this.exported.chapters.length > 0 || this.exported.narration.length > 0;
  }

  public getChapters(): ReplayChapter[] {
    if (!isReplayExportV2(this.exported)) {
      // V1 export has NO chapters; missing stays missing, not demo defaults
      return [];
    }
    if (this.useBaselineChapters) {
      return this.exported.baseline_chapters || [];
    }
    return this.exported.chapters || [];
  }

  public getBaselineChapters(): ReplayChapter[] {
    if (!isReplayExportV2(this.exported)) return [];
    return this.exported.baseline_chapters || [];
  }

  public getChapterRun(): ChapterRunRecord | null {
    if (!isReplayExportV2(this.exported)) return null;
    return this.exported.chapter_run || null;
  }

  public getNarration(sequence?: number): StepNarration | null {
    if (!isReplayExportV2(this.exported)) return null;
    const targetSeq = sequence ?? this.currentSequence;
    return this.exported.narration.find((n) => n.sequence === targetSeq) || null;
  }

  public getStoredContent(sha256: string | null | undefined): string | null {
    if (!sha256) return null;
    const b64 = this.exported.content_base64_by_sha256[sha256];
    if (typeof b64 !== 'string') return null;
    return decodeBase64ToUtf8(b64);
  }

  public getHistoricalFileAtCheckpoint(
    sequence: number,
    filePath: string
  ): { content: string | null; sha256: string | null; change?: ChangeType } {
    const entry = this.getTimelineEntry(sequence);
    if (!entry) return { content: null, sha256: null };

    // Check changed files first
    const changed = entry.changed_files.find((cf) => cf.path === filePath);
    if (changed) {
      const sha = changed.after_sha256;
      return {
        content: sha ? this.getStoredContent(sha) : null,
        sha256: sha,
        change: changed.change,
      };
    }

    // Fall back to after_manifest_id or before_manifest_id
    const manifestId = entry.after_manifest_id || entry.before_manifest_id;
    if (manifestId) {
      const manifest = this.exported.manifests.find((m) => m.id === manifestId);
      if (manifest) {
        const file = manifest.files.find((f) => f.path === filePath);
        if (file) {
          return {
            content: this.getStoredContent(file.content_sha256),
            sha256: file.content_sha256,
            change: 'unchanged',
          };
        }
      }
    }

    return { content: null, sha256: null };
  }

  public getHistoricalDiff(sequence: number, filePath: string): string | null {
    const entry = this.getTimelineEntry(sequence);
    if (!entry) return null;
    const changed = entry.changed_files.find((cf) => cf.path === filePath);
    return changed?.unified_diff || null;
  }

  public getTestsForSequence(sequence?: number): StructuredTestEvidence[] {
    const targetSeq = sequence ?? this.currentSequence;
    const entry = this.getTimelineEntry(targetSeq);
    if (entry && entry.test_evidence && entry.test_evidence.length > 0) {
      return entry.test_evidence;
    }
    return [];
  }

  public detectCaptureGranularity(): AttributionStatus {
    const attributions = this.exported.timeline.map((t) => t.attribution_status);
    if (attributions.includes('tool_boundary')) return 'tool_boundary';
    if (attributions.includes('observed_checkpoint')) return 'observed_checkpoint';
    return 'unknown';
  }

  public getCompletenessSummary(): { completeness: Completeness; gaps: string[] } {
    const gaps: string[] = [];
    let worst: Completeness = 'complete';

    for (const t of this.exported.timeline) {
      if (t.completeness === 'unsupported') worst = 'unsupported';
      else if (t.completeness === 'missing' && worst !== 'unsupported') worst = 'missing';
      else if (t.completeness === 'partial' && worst === 'complete') worst = 'partial';

      if (t.gap_reason) {
        gaps.push(`Sequence ${t.sequence}: ${t.gap_reason}`);
      }
    }

    return { completeness: worst, gaps };
  }

  // --- FaultMeshAdapter contract implementation ---

  public async getRuns(): Promise<RunSummary[]> {
    const session = this.exported.session;
    const tests = this.exported.tests;

    let passedCount = 0;
    let failedCount = 0;
    let errorsCount = 0;
    let skippedCount = 0;

    for (const t of tests) {
      if (t.counts) {
        passedCount += t.counts.passed || 0;
        failedCount += t.counts.failed || 0;
        errorsCount += t.counts.errors || 0;
        skippedCount += t.counts.skipped || 0;
      } else {
        if (t.state === 'pass') passedCount++;
        else if (t.state === 'fail') failedCount++;
        else if (t.state === 'error') errorsCount++;
        else if (t.state === 'skipped') skippedCount++;
      }
    }

    const totalTests = passedCount + failedCount + errorsCount + skippedCount;
    const lastTimestamp =
      session.stopped_at ||
      (this.exported.timeline.length > 0
        ? this.exported.timeline[this.exported.timeline.length - 1].captured_at
        : null) ||
      this.exported.exported_at;
    const durationMs =
      session.created_at && lastTimestamp
        ? Math.max(0, new Date(lastTimestamp).getTime() - new Date(session.created_at).getTime())
        : 0;

    const runSummary: RunSummary = {
      id: session.id,
      project: `session:${session.id.slice(0, 12)}`,
      gitBranch: 'recorded',
      gitRevision: session.project_root_sha256.slice(0, 7),
      commitMessage: 'recorded agent replay',
      startedAt: session.created_at,
      completedAt: session.stopped_at || undefined,
      durationMs,
      status: session.status === 'active' ? 'running' : 'completed',
      isFixture: this.origin === 'synthetic_fixture',
      fixtureLabel: this.origin === 'synthetic_fixture' ? 'Synthetic Fixture' : '',
      limitations: this.getLimitations(),
      stats: {
        totalTests,
        passed: passedCount,
        failed: failedCount,
        errored: errorsCount,
        skipped: skippedCount,
        totalNodes: 0,
        modifiedNodes: 0,
      },
      isRealImport: true,
      isLive: false, // HISTORICAL / STOPPED IS NEVER LIVE
      isReplay: true,
      replayOrigin: this.origin,
      codexVersion: session.codex_version || 'Not recorded',
      granularity: this.detectCaptureGranularity(),
      replaySessionStatus: session.status,
    };

    return [runSummary];
  }

  public async getRun(runId: string): Promise<RunSummary | null> {
    const runs = await this.getRuns();
    return runs.find((r) => r.id === runId) || null;
  }

  public async getTests(_runId: string): Promise<TestItem[]> {
    const items: TestItem[] = [];

    // Derive test items honestly from structured test evidence
    for (const evidence of this.exported.tests) {
      if (evidence.tests && evidence.tests.length > 0) {
        for (const ind of evidence.tests) {
          items.push({
            id: ind.node_id,
            name: ind.node_id.split('::').pop() || ind.node_id,
            file: ind.node_id.split('::')[0] || evidence.suite_scope,
            status: ind.state === 'pass' ? 'pass' : ind.state === 'fail' ? 'fail' : ind.state === 'error' ? 'error' : 'skipped',
            durationMs: ind.duration_ms || 0,
            failureMessage: ind.error_text || (ind.state === 'fail' ? 'Recorded test failure' : undefined),
            rerunHistory: [],
            exercisedNodeIds: [],
          });
        }
      } else {
        // Evidence record for a suite without individual nodes
        items.push({
          id: evidence.id,
          name: evidence.suite_scope || evidence.id,
          file: evidence.suite_scope || 'tests',
          status: evidence.state === 'pass' ? 'pass' : evidence.state === 'fail' ? 'fail' : evidence.state === 'error' ? 'error' : 'skipped',
          durationMs: 0,
          failureMessage: evidence.state === 'fail' ? 'Recorded test failure' : undefined,
          rerunHistory: [],
          exercisedNodeIds: [],
        });
      }
    }

    return items;
  }

  public async getTest(runId: string, testId: string): Promise<TestItem | null> {
    const tests = await this.getTests(runId);
    return tests.find((t) => t.id === testId) || null;
  }

  public async getGraph(_runId: string): Promise<GraphData> {
    // Generate graph representation from current checkpoint manifests / changed files
    const entry = this.getTimelineEntry(this.currentSequence) || this.exported.timeline[0];
    const nodes: CodeNode[] = [];
    const files: FileCluster[] = [];

    if (!entry) {
      return { nodes: [], edges: [], unresolvedReferences: [], parseErrors: [], files: [] };
    }

    // Build files from manifest
    const manifestId = entry.after_manifest_id || entry.before_manifest_id;
    const manifest = this.exported.manifests.find((m) => m.id === manifestId);

    if (manifest) {
      for (const cf of manifest.files) {
        const parts = cf.path.split('/');
        const name = parts[parts.length - 1];
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        const changed = entry.changed_files.find((c) => c.path === cf.path);

        files.push({
          file: cf.path,
          name,
          folder,
          symbolCount: 0,
          changeStatus: changed ? (changed.change as any) : 'unchanged',
          lineCount: 0,
          contentHash: cf.content_sha256,
          parseError: cf.parse_error,
        });

        // Add file node
        nodes.push({
          id: cf.path,
          file: cf.path,
          name,
          kind: 'module',
          lineStart: 1,
          lineEnd: 1,
          changeStatus: changed ? (changed.change as any) : 'unchanged',
          parentModule: folder,
          contentHash: cf.content_sha256,
        });
      }
    }

    // Add changed symbols
    for (const sym of entry.changed_symbols) {
      nodes.push({
        id: `${sym.path}::${sym.qualified_name}`,
        file: sym.path,
        name: sym.qualified_name,
        kind: sym.kind as any,
        lineStart: 1,
        lineEnd: 1,
        changeStatus: sym.change as any,
        parentModule: sym.path,
        structureStale: !sym.verified,
      });
    }

    return {
      nodes,
      edges: [],
      unresolvedReferences: [],
      parseErrors: [],
      files,
    };
  }

  public async getTestEvidence(runId: string, testId: string): Promise<TestEvidence | null> {
    const tests = await this.getTests(runId);
    const test = tests.find((t) => t.id === testId);
    if (!test) return null;

    return {
      test,
      coveredNodes: [],
      executedEdges: [],
      unresolvedReferences: [],
      observationNote: 'Recorded test evidence from export',
      callTracingAvailable: false,
    };
  }

  public async getSource(_runId: string, nodeId: string): Promise<SourceViewData | null> {
    const entry = this.getTimelineEntry(this.currentSequence) || this.exported.timeline[0];
    if (!entry) return null;

    const path = nodeId.includes('::') ? nodeId.split('::')[0] : nodeId;
    const name = nodeId.includes('::') ? nodeId.split('::')[1] : path.split('/').pop() || path;
    const historical = this.getHistoricalFileAtCheckpoint(entry.sequence, path);
    const diff = this.getHistoricalDiff(entry.sequence, path);

    const changeStatus: ChangeStatus =
      historical.change === 'deleted'
        ? 'removed'
        : historical.change === 'added'
        ? 'added'
        : historical.change === 'modified'
        ? 'modified'
        : 'unchanged';

    return {
      nodeId,
      file: path,
      name,
      lineStart: 1,
      lineEnd: 1,
      snippet: historical.content || undefined,
      gitDiff: diff || undefined,
      changeStatus,
    };
  }
}
