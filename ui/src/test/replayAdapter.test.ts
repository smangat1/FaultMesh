import { describe, it, expect } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import type { ReplayExportV1, ReplayExportV2 } from '../replay/types';

function createMockV1(): ReplayExportV1 {
  const sha = 'e'.repeat(64);
  const codeB64 = Buffer.from('def calculate():\n    return 100\n', 'utf-8').toString('base64');

  return {
    schema_version: 'replay-export-1.0',
    exported_at: '2026-10-28T15:00:00Z',
    session: {
      schema_version: 'replay-session-1.0',
      id: 'session-no-model-001',
      created_at: '2026-10-28T14:50:00Z',
      stopped_at: '2026-10-28T15:00:00Z',
      status: 'stopped',
      project_root_sha256: 'f'.repeat(64),
      codex_version: 'codex-cli 0.165.0-alpha.1.2',
      raw_logging: false,
      limits: {
        max_file_bytes: 524288,
        max_snapshot_bytes: 33554432,
        max_files: 2000,
        max_store_bytes: 536870912,
        max_text_field_bytes: 65536,
      },
    },
    records: [
      {
        schema_version: 'replay-record-1.0',
        id: 'rec-1',
        session_id: 'session-no-model-001',
        sequence: 1,
        source_identity: 'id-1',
        source_offset: 0,
        source_sequence: 1,
        record_type: 'initial',
        captured_at: '2026-10-28T14:50:00Z',
        source_timestamp: null,
        provenance: 'initial_snapshot',
        completeness: 'complete',
        attribution_status: 'not_applicable',
        turn_id: null,
        tool_use_id: null,
        tool_name: null,
        checkpoint_id: 'cp-1',
        manifest_id: 'm-1',
        before_manifest_id: null,
        after_manifest_id: 'm-1',
        partial: false,
        truncated: false,
        redaction_applied: false,
        tool_input: null,
        tool_response: null,
        gap_reason: null,
        test_refs: [],
      },
    ],
    manifests: [
      {
        schema_version: 'snapshot-manifest-1.0',
        id: 'm-1',
        files: [
          {
            path: 'calc.py',
            content_sha256: sha,
            size: 32,
            mtime_ns: 1000,
            parse_ok: true,
            parse_error: null,
          },
        ],
        skipped: [],
        partial: false,
      },
    ],
    content_base64_by_sha256: {
      [sha]: codeB64,
    },
    tests: [],
    timeline: [
      {
        sequence: 1,
        record_id: 'rec-1',
        record_type: 'initial',
        captured_at: '2026-10-28T14:50:00Z',
        completeness: 'complete',
        attribution_status: 'tool_boundary',
        tool_name: null,
        tool_use_id: null,
        before_manifest_id: null,
        after_manifest_id: 'm-1',
        changed_files: [],
        changed_symbols: [],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
    ],
    limitations: ['No model used.'],
  };
}

function createMockV2(): ReplayExportV2 {
  const v1 = createMockV1();
  return {
    ...v1,
    schema_version: 'replay-export-2.0',
    baseline_chapters: [
      {
        id: 'base-ch-1',
        start_sequence: 1,
        end_sequence: 1,
        title: 'Initial baseline snapshot',
        evidence_refs: ['rec-1'],
        source: 'deterministic_baseline',
        title_status: 'baseline',
      },
    ],
    chapters: [
      {
        id: 'model-ch-1',
        start_sequence: 1,
        end_sequence: 1,
        title: 'Setup calculation module',
        evidence_refs: ['rec-1'],
        source: 'model',
        title_status: 'model_interpretation',
      },
    ],
    chapter_run: {
      schema_version: 'replay-chapter-run-1.0',
      chapters: [],
      raw_model_output: null,
      parsed_model_output: null,
      error: null,
      fallback_used: false,
      backend: 'local-gguf',
      model: 'qwen2.5-coder-7b',
      latency_ms: 100,
    },
    narration: [
      {
        sequence: 1,
        packet: {
          schema_version: 'replay-evidence-packet-1.0',
          session_id: 'session-no-model-001',
          checkpoint_id: 'cp-1',
          sequence: 1,
          before_manifest_id: null,
          after_manifest_id: 'm-1',
          record_complete: true,
          selection_truncated: false,
          redaction_present: false,
          files: [],
          functions: [],
          sources: [],
          evidence_hash: 'd'.repeat(64),
        },
        claims: {
          schema_version: 'replay-claims-run-1.0',
          final_claims: [],
          final_source: 'first',
          verdicts: [],
          fallback_used: false,
          repair_attempts: 0,
          backend: null,
          model: null,
          latency_ms: 0,
        },
      },
    ],
  };
}

describe('ReplayAdapter (Phase C1)', () => {
  it('correctly adapts a no-model V1 export with zero fake data', async () => {
    const v1 = createMockV1();
    const adapter = new ReplayAdapter(v1, 'real_recording');

    // Run summary inspection
    const runs = await adapter.getRuns();
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.isReplay).toBe(true);
    expect(run.isLive).toBe(false); // Historical is NEVER live
    expect(run.isRealImport).toBe(true);
    expect(run.replayOrigin).toBe('real_recording');
    expect(run.codexVersion).toBe('codex-cli 0.165.0-alpha.1.2');
    expect(run.granularity).toBe('tool_boundary');

    // Missing chapters stay missing (empty list), not demo defaults
    expect(adapter.getChapters()).toHaveLength(0);
    expect(adapter.getBaselineChapters()).toHaveLength(0);
    expect(adapter.getNarration(1)).toBeNull();
    expect(adapter.isModelNarrationAvailable()).toBe(false);

    // Tests stay missing (not passed)
    const tests = await adapter.getTests(run.id);
    expect(tests).toHaveLength(0);

    // Stored content decode
    const content = adapter.getStoredContent('e'.repeat(64));
    expect(content).toBe('def calculate():\n    return 100\n');
  });

  it('correctly adapts an enriched V2 export with chapters and narration', async () => {
    const v2 = createMockV2();
    const adapter = new ReplayAdapter(v2, 'synthetic_fixture');

    expect(adapter.getOrigin()).toBe('synthetic_fixture');
    expect(adapter.isModelNarrationAvailable()).toBe(true);

    const modelChapters = adapter.getChapters();
    expect(modelChapters).toHaveLength(1);
    expect(modelChapters[0].title_status).toBe('model_interpretation');
    expect(modelChapters[0].title).toBe('Setup calculation module');

    // Switch to baseline chapters
    adapter.setUseBaselineChapters(true);
    const baselineChapters = adapter.getChapters();
    expect(baselineChapters).toHaveLength(1);
    expect(baselineChapters[0].title_status).toBe('baseline');
    expect(baselineChapters[0].title).toBe('Initial baseline snapshot');

    // Step narration
    const narration = adapter.getNarration(1);
    expect(narration).not.toBeNull();
    expect(narration?.sequence).toBe(1);
  });

  it('retrieves historical file at checkpoint without filesystem calls', async () => {
    const v1 = createMockV1();
    const adapter = new ReplayAdapter(v1);

    const file = adapter.getHistoricalFileAtCheckpoint(1, 'calc.py');
    expect(file.content).toBe('def calculate():\n    return 100\n');
    expect(file.sha256).toBe('e'.repeat(64));

    const missing = adapter.getHistoricalFileAtCheckpoint(1, 'nonexistent.py');
    expect(missing.content).toBeNull();
  });
});
