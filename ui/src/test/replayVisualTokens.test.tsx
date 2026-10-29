import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import { ReplayEvidenceInspector } from '../components/replay/ReplayEvidenceInspector';
import { ReplayAdapter } from '../adapter/replayAdapter';
import type { ReplayExportV2, StepNarration } from '../replay/types';

/**
 * Calculates standard WCAG 2.1 relative luminance for an sRGB hex color.
 */
function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes the contrast ratio between two hex colors.
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function createMockV2(): ReplayExportV2 {
  return {
    schema_version: 'replay-export-2.0',
    exported_at: '2026-10-28T16:00:00Z',
    session: {
      schema_version: 'replay-store-1.0',
      id: 'session-tokens-001',
      created_at: '2026-10-28T15:50:00Z',
      stopped_at: '2026-10-28T16:00:00Z',
      status: 'stopped',
      project_root_sha256: 'a'.repeat(64),
      codex_version: 'codex-cli 0.165.0',
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
        id: 'rec-01',
        session_id: 'session-tokens-001',
        sequence: 1,
        source_identity: 'src-01',
        source_offset: 0,
        source_sequence: 1,
        record_type: 'initial_snapshot',
        captured_at: '2026-10-28T15:50:00Z',
        source_timestamp: null,
        provenance: 'initial_snapshot',
        completeness: 'complete',
        attribution_status: 'not_applicable',
        turn_id: null,
        tool_use_id: null,
        tool_name: null,
        checkpoint_id: 'cp-01',
        manifest_id: 'man-01',
        before_manifest_id: null,
        after_manifest_id: 'man-01',
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
        id: 'rec-02',
        session_id: 'session-tokens-001',
        sequence: 2,
        source_identity: 'src-02',
        source_offset: 50,
        source_sequence: 2,
        record_type: 'post_tool',
        captured_at: '2026-10-28T15:52:00Z',
        source_timestamp: null,
        provenance: 'tool_boundary',
        completeness: 'complete',
        attribution_status: 'tool_boundary',
        turn_id: 'turn-1',
        tool_use_id: 'tool-patch',
        tool_name: 'apply_patch',
        checkpoint_id: 'cp-02',
        manifest_id: 'man-02',
        before_manifest_id: 'man-01',
        after_manifest_id: 'man-02',
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
        schema_version: 'replay-store-1.0',
        id: 'man-01',
        skipped: [],
        partial: false,
        files: [{ path: 'app.py', content_sha256: '1'.repeat(64), size: 50, mtime_ns: 1000, parse_ok: true, parse_error: null }],
      },
      {
        schema_version: 'replay-store-1.0',
        id: 'man-02',
        skipped: [],
        partial: false,
        files: [{ path: 'app.py', content_sha256: '2'.repeat(64), size: 70, mtime_ns: 2000, parse_ok: true, parse_error: null }],
      },
    ],
    content_base64_by_sha256: {
      ['1'.repeat(64)]: Buffer.from('print("hello")\n').toString('base64'),
      ['2'.repeat(64)]: Buffer.from('print("hello world")\n').toString('base64'),
    },
    tests: [],
    timeline: [
      {
        sequence: 1,
        record_id: 'rec-01',
        record_type: 'initial_snapshot',
        captured_at: '2026-10-28T15:50:00Z',
        completeness: 'complete',
        attribution_status: 'not_applicable',
        tool_name: null,
        tool_use_id: null,
        before_manifest_id: null,
        after_manifest_id: 'man-01',
        changed_files: [],
        changed_symbols: [],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
      {
        sequence: 2,
        record_id: 'rec-02',
        record_type: 'post_tool',
        captured_at: '2026-10-28T15:52:00Z',
        completeness: 'complete',
        attribution_status: 'tool_boundary',
        tool_name: 'apply_patch',
        tool_use_id: 'tool-patch',
        before_manifest_id: 'man-01',
        after_manifest_id: 'man-02',
        changed_files: [
          {
            path: 'app.py',
            change: 'modified',
            before_sha256: '1'.repeat(64),
            after_sha256: '2'.repeat(64),
            unified_diff: '--- app.py\n+++ app.py\n@@ -1 +1 @@\n-print("hello")\n+print("hello world")',
          },
        ],
        changed_symbols: [],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
    ],
    limitations: ['Sandbox memory bound'],
    chapters: [
      {
        id: 'ch-model-1',
        start_sequence: 1,
        end_sequence: 2,
        title: 'Updating greeting print message',
        source: 'model',
        title_status: 'model interpretation',
        evidence_refs: ['rec-02'],
      },
    ],
    baseline_chapters: [],
    chapter_run: {
      schema_version: 'replay-chapter-run-1.0',
      chapters: [],
      raw_model_output: null,
      parsed_model_output: null,
      error: null,
      fallback_used: false,
      backend: 'local',
      model: null,
      latency_ms: 0,
    },
    narration: [],
  };
}

describe('Replay Visual Foundation & Tokens', () => {
  describe('WCAG 2.1 AA & AAA Contrast Compliance', () => {
    const bgCanvas = '#07090e';
    const bgSurface1 = '#0d111a';
    const bgSurface2 = '#141a26';
    const textPrimary = '#e6edf8';
    const textMuted = '#8b97ad';
    const accent = '#4a7bb0';
    const buttonText = '#ffffff';

    it('text-primary passes WCAG AAA contrast (>= 7.0:1) on all dark surfaces', () => {
      expect(getContrastRatio(textPrimary, bgCanvas)).toBeGreaterThanOrEqual(7.0);
      expect(getContrastRatio(textPrimary, bgSurface1)).toBeGreaterThanOrEqual(7.0);
      expect(getContrastRatio(textPrimary, bgSurface2)).toBeGreaterThanOrEqual(7.0);
    });

    it('text-muted passes WCAG AA contrast (>= 4.5:1) on all dark surfaces', () => {
      expect(getContrastRatio(textMuted, bgCanvas)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(textMuted, bgSurface1)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(textMuted, bgSurface2)).toBeGreaterThanOrEqual(4.5);
    });

    it('accent elements pass WCAG 2.1 graphical & UI component contrast (>= 3.0:1)', () => {
      expect(getContrastRatio(accent, bgCanvas)).toBeGreaterThanOrEqual(3.0);
      expect(getContrastRatio(buttonText, accent)).toBeGreaterThanOrEqual(3.0);
    });
  });

  describe('No Purple or Yellow Regressions', () => {
    it('renders ReplayWorkspace using calm tokens without deprecated vibrant styles', () => {
      const v2 = createMockV2();
      const adapter = new ReplayAdapter(v2, 'synthetic_fixture');
      const { container } = render(<ReplayWorkspace adapter={adapter} />);

      const html = container.innerHTML;

      // Ensure no deprecated purple (#c084fc, #a855f7, #8b5cf6) or bright yellow (#fbbf24, #f59e0b) badges
      expect(html).not.toContain('#c084fc');
      expect(html).not.toContain('rgba(168, 85, 247');
      expect(html).not.toContain('#fbbf24');
      expect(html).not.toContain('rgba(245, 158, 11');
      expect(html).not.toContain('#10b981'); // no bright neon green
      expect(html).not.toContain('#ef4444'); // no bright neon red

      // Confirms calm tokens are present in DOM
      expect(html).toContain('var(--replay-bg-canvas');
      expect(html).toContain('var(--replay-accent');
      expect(html).toContain('var(--replay-border-subtle');
    });

    it('renders ReplayEvidenceInspector with calm status tokens and no purple badges', () => {
      const mockNarration: StepNarration = {
        sequence: 1,
        packet: {
          schema_version: 'replay-evidence-packet-1.0',
          session_id: 'session-1',
          checkpoint_id: 'cp-1',
          sequence: 1,
          before_manifest_id: null,
          after_manifest_id: null,
          record_complete: true,
          selection_truncated: false,
          redaction_present: false,
          files: [],
          functions: [],
          sources: [],
          evidence_hash: 'hash-1',
        },
        claims: {
          schema_version: 'replay-claim-run-1.0',
          final_claims: [
            {
              id: 'c-1',
              assertion: {
                predicate: 'file_changed',
                path: 'app.py',
                change: 'modified',
                before_sha256: '1'.repeat(64),
                after_sha256: '2'.repeat(64),
              },
              evidence_refs: ['rec-02'],
              statement: 'app.py was modified with greeting change',
            },
          ],
          final_source: 'first',
          verdicts: [
            {
              claim_id: 'c-1',
              verdict: 'supported',
              reason_code: 'manifest_hash_change',
              reason: 'File SHA matches new content',
              evidence_refs: ['rec-02'],
              checker_version: 'replay-checker-1.0',
            },
          ],
          fallback_used: false,
          repair_attempts: 0,
          backend: 'local-gguf',
          model: 'qwen2.5-coder-7b',
          latency_ms: 12,
        },
        reason: {
          schema_version: 'replay-reason-run-1.0',
          raw_model_output: '{}',
          parsed_reason: null,
          checked_reason: {
            label: 'likely reason (model inference)',
            text: 'Updated greeting text to hello world.',
            citations: [],
            citation_status: 'valid',
            entailment_status: 'not_deterministically_assessed',
            verified_intent: false,
          },
          error: null,
          fallback_used: false,
          backend: 'local-gguf',
          model: 'qwen2.5-coder-7b',
          latency_ms: 25,
        },
        summary_audit: null,
      };

      const { container } = render(
        <ReplayEvidenceInspector
          narration={mockNarration}
          tests={[]}
          limitations={['Storage cap 512MB']}
          isNarrationOn={true}
        />
      );

      const html = container.innerHTML;

      // Model inference label should use calm neutral status, not purple
      expect(screen.getByTestId('replay-likely-reason-label').textContent).toContain('likely reason (model inference)');
      expect(html).not.toContain('#c084fc');
      expect(html).not.toContain('rgba(168, 85, 247');

      // Claim verdict badge should use calm tokens
      expect(screen.getByTestId('replay-claim-verdict-supported').textContent).toContain('checked against recording');
      expect(html).toContain('var(--replay-status-complete');
    });
  });
});
