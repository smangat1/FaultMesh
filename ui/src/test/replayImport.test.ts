import { describe, it, expect } from 'vitest';
import { validateReplayExport, MAX_REPLAY_SIZE_BYTES } from '../replay/validators';
import type { ReplayExportV1, ReplayExportV2 } from '../replay/types';
import { decodeBase64ToUtf8 } from '../replay/utils';

function makeValidV1Export(): ReplayExportV1 {
  const contentSha = 'a'.repeat(64);
  const base64Code = Buffer.from('def hello():\n    return 42\n', 'utf-8').toString('base64');

  return {
    schema_version: 'replay-export-1.0',
    exported_at: '2026-10-28T14:00:00Z',
    session: {
      schema_version: 'replay-store-1.0',
      id: 'session-valid-001',
      created_at: '2026-10-28T13:50:00Z',
      stopped_at: '2026-10-28T14:00:00Z',
      status: 'stopped',
      project_root_sha256: 'b'.repeat(64),
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
        schema_version: 'replay-store-1.0',
        id: 'rec-001',
        session_id: 'session-valid-001',
        sequence: 1,
        source_identity: 'src-01',
        source_offset: 0,
        source_sequence: 1,
        record_type: 'initial_snapshot',
        captured_at: '2026-10-28T13:50:00Z',
        source_timestamp: '2026-10-28T13:50:00Z',
        provenance: 'initial_snapshot',
        completeness: 'complete',
        attribution_status: 'not_applicable',
        turn_id: null,
        tool_use_id: null,
        tool_name: null,
        checkpoint_id: 'cp-001',
        manifest_id: 'man-001',
        before_manifest_id: null,
        after_manifest_id: 'man-001',
        partial: false,
        truncated: false,
        redaction_applied: false,
        tool_input: null,
        tool_response: null,
        gap_reason: null,
        test_refs: [],
      },
      {
        schema_version: 'replay-store-1.0',
        id: 'rec-002',
        session_id: 'session-valid-001',
        sequence: 2,
        source_identity: 'src-02',
        source_offset: 100,
        source_sequence: 2,
        record_type: 'post_tool',
        captured_at: '2026-10-28T13:52:00Z',
        source_timestamp: '2026-10-28T13:52:00Z',
        provenance: 'tool_boundary',
        completeness: 'complete',
        attribution_status: 'tool_boundary',
        turn_id: 'turn-1',
        tool_use_id: 'tool-apply-patch',
        tool_name: 'apply_patch',
        checkpoint_id: 'cp-002',
        manifest_id: 'man-002',
        before_manifest_id: 'man-001',
        after_manifest_id: 'man-002',
        partial: false,
        truncated: false,
        redaction_applied: false,
        tool_input: { patch: 'diff...' },
        tool_response: { status: 'applied' },
        gap_reason: null,
        test_refs: ['test-ev-1'],
      },
    ],
    manifests: [
      {
        schema_version: 'replay-store-1.0',
        id: 'man-001',
        files: [
          {
            path: 'hello.py',
            content_sha256: contentSha,
            size: 26,
            mtime_ns: 1000000,
            parse_ok: true,
            parse_error: null,
          },
        ],
        skipped: [],
        partial: false,
      },
      {
        schema_version: 'replay-store-1.0',
        id: 'man-002',
        files: [
          {
            path: 'hello.py',
            content_sha256: contentSha,
            size: 26,
            mtime_ns: 2000000,
            parse_ok: true,
            parse_error: null,
          },
        ],
        skipped: [],
        partial: false,
      },
    ],
    content_base64_by_sha256: {
      [contentSha]: base64Code,
    },
    tests: [
      {
        schema_version: 'replay-store-1.0',
        id: 'test-ev-1',
        session_id: 'session-valid-001',
        observed_at: '2026-10-28T13:52:05Z',
        state: 'fail',
        suite_scope: 'tests/test_hello.py',
        source: 'structured_pytest',
        command_record_id: 'rec-002',
        command_exit_code: 1,
        associated_manifest_id: 'man-002',
        association: 'content_identity',
        counts: { passed: 0, failed: 1, errors: 0, skipped: 0 },
        tests: [
          {
            node_id: 'tests/test_hello.py::test_val',
            state: 'fail',
            duration_ms: 12,
            error_text: 'AssertionError: 42 != 0',
          },
        ],
        output_missing: false,
        partial: false,
      },
    ],
    timeline: [
      {
        sequence: 1,
        record_id: 'rec-001',
        record_type: 'initial_snapshot',
        captured_at: '2026-10-28T13:50:00Z',
        completeness: 'complete',
        attribution_status: 'not_applicable',
        tool_name: null,
        tool_use_id: null,
        before_manifest_id: null,
        after_manifest_id: 'man-001',
        changed_files: [],
        changed_symbols: [],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
      {
        sequence: 2,
        record_id: 'rec-002',
        record_type: 'post_tool',
        captured_at: '2026-10-28T13:52:00Z',
        completeness: 'complete',
        attribution_status: 'tool_boundary',
        tool_name: 'apply_patch',
        tool_use_id: 'tool-apply-patch',
        before_manifest_id: 'man-001',
        after_manifest_id: 'man-002',
        changed_files: [
          {
            path: 'hello.py',
            change: 'modified',
            before_sha256: contentSha,
            after_sha256: contentSha,
            unified_diff: '--- hello.py\n+++ hello.py\n@@ -1 +1 @@\n-1\n+2\n',
          },
        ],
        changed_symbols: [
          {
            path: 'hello.py',
            qualified_name: 'hello',
            kind: 'function',
            change: 'modified',
            before_content_sha256: contentSha,
            after_content_sha256: contentSha,
            verified: true,
          },
        ],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
    ],
    limitations: ['Replay does not reexecute commands on playback.'],
  };
}

function makeValidV2Export(): ReplayExportV2 {
  const v1 = makeValidV1Export();
  return {
    ...v1,
    schema_version: 'replay-export-2.0',
    baseline_chapters: [
      {
        id: 'chap-base-1',
        start_sequence: 1,
        end_sequence: 2,
        title: 'Initial snapshot and patch tool boundary',
        evidence_refs: ['rec-001', 'rec-002'],
        source: 'deterministic_fixed_group',
        title_status: 'deterministic template',
      },
    ],
    chapters: [
      {
        id: 'chap-model-1',
        start_sequence: 1,
        end_sequence: 2,
        title: 'Refactored return value in hello.py',
        evidence_refs: ['rec-001', 'rec-002'],
        source: 'model',
        title_status: 'model interpretation',
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
      latency_ms: 250,
    },
    narration: [
      {
        sequence: 2,
        packet: {
          schema_version: 'replay-evidence-packet-1.0',
          session_id: 'session-valid-001',
          checkpoint_id: 'cp-002',
          sequence: 2,
          before_manifest_id: 'man-001',
          after_manifest_id: 'man-002',
          record_complete: true,
          selection_truncated: false,
          redaction_present: false,
          files: [{ path: 'hello.py', before_sha256: 'a'.repeat(64), after_sha256: 'a'.repeat(64), change: 'modified' }],
          functions: [{ path: 'hello.py', before_functions: ['hello'], after_functions: ['hello'], before_ast_complete: true, after_ast_complete: true }],
          sources: [{ id: 'src-01', kind: 'tool_call', session_id: 'session-valid-001', sequence: 2, content_sha256: 'a'.repeat(64), text: 'applied patch', redacted: false, truncated: false }],
          evidence_hash: 'c'.repeat(64),
        },
        claims: {
          schema_version: 'replay-claim-run-1.0',
          final_claims: [
            {
              id: 'claim-1',
              assertion: {
                predicate: 'file_changed',
                path: 'hello.py',
                before_sha256: 'a'.repeat(64),
                after_sha256: 'a'.repeat(64),
                change: 'modified',
              },
              evidence_refs: ['rec-002'],
              statement: 'hello.py modified from hash a to hash a',
            },
          ],
          final_source: 'first',
          verdicts: [
            {
              claim_id: 'claim-1',
              verdict: 'supported',
              reason_code: 'exact_file_fact',
              reason: 'Path and content hashes match recorded boundary.',
              evidence_refs: ['rec-002'],
              checker_version: 'replay-checker-1.0',
            },
          ],
          fallback_used: false,
          repair_attempts: 0,
          backend: 'local-gguf',
          model: 'qwen2.5-coder-7b',
          latency_ms: 120,
        },
        reason: {
          schema_version: 'replay-reason-run-1.0',
          raw_model_output: '{"text":"Updating return value","citations":[]}',
          parsed_reason: { text: 'Updating return value', citations: [] },
          checked_reason: {
            label: 'likely reason (model inference)',
            text: 'Updating return value',
            citations: [],
            citation_status: 'valid',
            entailment_status: 'not_deterministically_assessed',
            verified_intent: false,
          },
          error: null,
          fallback_used: false,
          backend: 'local-gguf',
          model: 'qwen2.5-coder-7b',
          latency_ms: 80,
        },
        summary_audit: {
          schema_version: 'replay-summary-audit-1.0',
          summary_text: 'hello.py was modified.',
          statements: [
            {
              statement: {
                start: 0,
                end: 22,
                exact_text: 'hello.py was modified.',
                claim: {
                  id: 'claim-1',
                  assertion: {
                    predicate: 'file_changed',
                    path: 'hello.py',
                    before_sha256: 'a'.repeat(64),
                    after_sha256: 'a'.repeat(64),
                    change: 'modified',
                  },
                  evidence_refs: ['rec-002'],
                  statement: 'hello.py was modified.',
                },
              },
              span_valid: true,
              canonical_mapping_valid: true,
              atomic_boundary_valid: true,
              claim_verdict: {
                claim_id: 'claim-1',
                verdict: 'supported',
                reason_code: 'exact_file_fact',
                reason: 'Verified',
                evidence_refs: ['rec-002'],
                checker_version: 'replay-checker-1.0',
              },
              display_status: 'supported_recorded_fact',
            },
          ],
          supported_claims: [],
          auditor_version: 'replay-summary-auditor-1.0',
          limitations: [],
        },
      },
    ],
  };
}

describe('Replay Export Validation (Phase C1)', () => {
  it('validates a correct replay-export-1.0 document successfully', () => {
    const v1 = makeValidV1Export();
    const result = validateReplayExport(v1);

    expect(result.success).toBe(true);
    expect(result.version).toBe('replay-export-1.0');
    expect(result.origin).toBe('real_recording');
    expect(result.missingContentHashes).toHaveLength(0);
    expect(result.data?.schema_version).toBe('replay-export-1.0');
  });

  it('validates a correct replay-export-2.0 document successfully', () => {
    const v2 = makeValidV2Export();
    const result = validateReplayExport(v2);

    expect(result.success).toBe(true);
    expect(result.version).toBe('replay-export-2.0');
    expect(result.origin).toBe('real_recording');
    expect(result.missingContentHashes).toHaveLength(0);
  });

  it('detects synthetic fixture origin when marked or named fixture', () => {
    const v1 = makeValidV1Export();
    v1.sanitized = true;
    const res1 = validateReplayExport(v1);
    expect(res1.origin).toBe('synthetic_fixture');

    const v2 = makeValidV2Export();
    const res2 = validateReplayExport(v2, undefined, 'fixtures/narration_fixture.json');
    expect(res2.origin).toBe('synthetic_fixture');
  });

  it('rejects unsupported schema versions', () => {
    const bad1 = { ...makeValidV1Export(), schema_version: 'replay-export-3.0' };
    const res1 = validateReplayExport(bad1);
    expect(res1.success).toBe(false);
    expect(res1.errors?.[0]?.message).toMatch(/Unsupported replay schema_version "replay-export-3.0"/);

    const bad2 = { ...makeValidV1Export(), schema_version: '3.0' };
    const res2 = validateReplayExport(bad2);
    expect(res2.success).toBe(false);
    expect(res2.errors?.[0]?.message).toMatch(/Unsupported replay schema_version "3.0"/);
  });

  it('rejects oversized files exceeding 64 MB', () => {
    const v1 = makeValidV1Export();
    const result = validateReplayExport(v1, MAX_REPLAY_SIZE_BYTES + 100);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.message).toMatch(/exceeds maximum size limit of 64 MB/);
  });

  it('rejects non-object or malformed JSON input', () => {
    const res1 = validateReplayExport('not an object');
    expect(res1.success).toBe(false);
    expect(res1.errors?.[0]?.message).toMatch(/must be a JSON object/);

    const res2 = validateReplayExport(null);
    expect(res2.success).toBe(false);
  });

  it('rejects missing top-level required fields', () => {
    const base = makeValidV1Export() as any;
    delete base.session;
    delete base.timeline;

    const result = validateReplayExport(base);
    expect(result.success).toBe(false);
    const msgs = result.errors?.map((e) => e.path) || [];
    expect(msgs).toContain('session');
    expect(msgs).toContain('timeline');
  });

  it('flags missing content hashes from manifests as partial export', () => {
    const v1 = makeValidV1Export();
    // Manifest references a hash that does not exist in content_base64_by_sha256
    const missingHash = 'f'.repeat(64);
    v1.manifests[0].files.push({
      path: 'missing.py',
      content_sha256: missingHash,
      size: 100,
      mtime_ns: 12345,
      parse_ok: true,
      parse_error: null,
    });

    const result = validateReplayExport(v1);
    expect(result.success).toBe(true);
    expect(result.missingContentHashes).toContain(missingHash);
    expect(result.isPartial).toBe(true);
  });

  it('safely decodes base64 text in memory with zero filesystem access', () => {
    const raw = 'print("hello world")\n';
    const b64 = Buffer.from(raw, 'utf-8').toString('base64');
    const decoded = decodeBase64ToUtf8(b64);
    expect(decoded).toBe(raw);
  });

  it('successfully validates generated disk fixtures fixture_replay_v2_enriched and fixture_replay_v1_nomodel', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const v2Path = path.resolve(__dirname, '../../../tests/fixtures/replay/fixture_replay_v2_enriched.json');
    const v1Path = path.resolve(__dirname, '../../../tests/fixtures/replay/fixture_replay_v1_nomodel.json');

    const v2Json = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));
    const v1Json = JSON.parse(fs.readFileSync(v1Path, 'utf-8'));

    const v2Result = validateReplayExport(v2Json, fs.statSync(v2Path).size, v2Path);
    expect(v2Result.success).toBe(true);
    expect(v2Result.version).toBe('replay-export-2.0');
    expect(v2Result.origin).toBe('synthetic_fixture');

    const v1Result = validateReplayExport(v1Json, fs.statSync(v1Path).size, v1Path);
    expect(v1Result.success).toBe(true);
    expect(v1Result.version).toBe('replay-export-1.0');
    expect(v1Result.origin).toBe('synthetic_fixture');
    expect(v1Result.data?.session.status).toBe('active');
  });
});
