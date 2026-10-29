import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import { ReplayAdapter } from '../adapter/replayAdapter';
import type { ReplayExportV1, ReplayExportV2 } from '../replay/types';

function createTestV1(): ReplayExportV1 {
  const sha1 = '1'.repeat(64);
  const sha2 = '2'.repeat(64);
  const codeB64 = Buffer.from('def calculate():\n    return 42\n', 'utf-8').toString('base64');

  return {
    schema_version: 'replay-export-1.0',
    exported_at: '2026-10-28T16:00:00Z',
    session: {
      schema_version: 'replay-store-1.0',
      id: 'session-view-001',
      created_at: '2026-10-28T15:50:00Z',
      stopped_at: '2026-10-28T16:00:00Z',
      status: 'stopped',
      project_root_sha256: '3'.repeat(64),
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
        id: 'rec-01',
        session_id: 'session-view-001',
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
        session_id: 'session-view-001',
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
        files: [
          {
            path: 'calc.py',
            content_sha256: sha1,
            size: 28,
            mtime_ns: 1000,
            parse_ok: true,
            parse_error: null,
          },
        ],
        skipped: [],
        partial: false,
      },
      {
        schema_version: 'replay-store-1.0',
        id: 'man-02',
        files: [
          {
            path: 'calc.py',
            content_sha256: sha2,
            size: 28,
            mtime_ns: 2000,
            parse_ok: true,
            parse_error: null,
          },
        ],
        skipped: [],
        partial: false,
      },
    ],
    content_base64_by_sha256: {
      [sha1]: codeB64,
      [sha2]: codeB64,
    },
    tests: [],
    timeline: [
      {
        sequence: 1,
        record_id: 'rec-01',
        record_type: 'initial',
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
            path: 'calc.py',
            change: 'modified',
            before_sha256: sha1,
            after_sha256: sha2,
            unified_diff: '--- calc.py\n+++ calc.py\n@@ -1,2 +1,2 @@\n-def calculate():\n-    return 0\n+def calculate():\n+    return 42\n',
          },
        ],
        changed_symbols: [
          {
            path: 'calc.py',
            qualified_name: 'calculate',
            kind: 'function',
            change: 'modified',
            before_content_sha256: sha1,
            after_content_sha256: sha2,
            verified: false, // STALE AST due to syntax error
          },
        ],
        test_evidence: [],
        prompt_or_tool_evidence_redacted: false,
        gap_reason: null,
      },
    ],
    limitations: ['Local-only playback; commands are never reexecuted.'],
  };
}

function createTestV2(): ReplayExportV2 {
  const v1 = createTestV1();
  return {
    ...v1,
    schema_version: 'replay-export-2.0',
    baseline_chapters: [
      {
        id: 'base-1',
        start_sequence: 1,
        end_sequence: 2,
        title: 'Initial snapshot and patch',
        evidence_refs: ['rec-01', 'rec-02'],
        source: 'deterministic_fixed_group',
        title_status: 'deterministic template',
      },
    ],
    chapters: [
      {
        id: 'model-1',
        start_sequence: 1,
        end_sequence: 2,
        title: 'Implement calculation formula',
        evidence_refs: ['rec-01', 'rec-02'],
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
      latency_ms: 120,
    },
    narration: [
      {
        sequence: 2,
        packet: {
          schema_version: 'replay-evidence-packet-1.0',
          session_id: 'session-view-001',
          checkpoint_id: 'cp-02',
          sequence: 2,
          before_manifest_id: 'man-01',
          after_manifest_id: 'man-02',
          record_complete: true,
          selection_truncated: false,
          redaction_present: false,
          files: [],
          functions: [],
          sources: [],
          evidence_hash: 'h'.repeat(64),
        },
        claims: {
          schema_version: 'replay-claim-run-1.0',
          final_claims: [],
          final_source: 'first',
          verdicts: [],
          fallback_used: false,
          repair_attempts: 0,
          backend: 'local-gguf',
          model: 'qwen2.5-coder-7b',
          latency_ms: 50,
        },
      },
    ],
  };
}

describe('ReplayWorkspace Component (Phase C2)', () => {
  it('renders a quiet Obsidian-like interface with honest states and no live claims', () => {
    const v1 = createTestV1();
    const adapter = new ReplayAdapter(v1, 'real_recording');
    render(<ReplayWorkspace adapter={adapter} />);

    // Honesty badges
    expect(screen.getByTestId('replay-header-origin').textContent).toContain('REAL RECORDING');
    expect(screen.getByText('HISTORICAL (STOPPED)')).toBeDefined();
    expect(screen.queryByText(/LIVE:/i)).toBeNull();
    expect(screen.getByText('TOOL BOUNDARY')).toBeDefined();
    expect(screen.getByText('codex-cli 0.165.0-alpha.1.2')).toBeDefined();

    // Checkpoint count
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #1 of 2');

    // V1 export has NO chapters
    expect(screen.queryByTestId('replay-chapters-list')).toBeNull();
  });

  it('supports checkpoint navigation (Previous, Next, and Click)', () => {
    const v1 = createTestV1();
    const adapter = new ReplayAdapter(v1);
    render(<ReplayWorkspace adapter={adapter} />);

    const nextBtn = screen.getByTestId('replay-next-btn') as HTMLButtonElement;
    const prevBtn = screen.getByTestId('replay-prev-btn') as HTMLButtonElement;

    // Initial sequence is #1, Prev is disabled
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    // Click Next
    fireEvent.click(nextBtn);
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #2 of 2');
    expect(nextBtn.disabled).toBe(true);
    expect(prevBtn.disabled).toBe(false);

    // Click row #1 directly
    const row1 = screen.getByTestId('replay-checkpoint-row-1');
    fireEvent.click(row1);
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #1 of 2');
  });

  it('supports keyboard navigation via ArrowLeft / ArrowRight', () => {
    const v1 = createTestV1();
    const adapter = new ReplayAdapter(v1);
    render(<ReplayWorkspace adapter={adapter} />);

    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #1 of 2');

    // Fire ArrowRight
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #2 of 2');

    // Fire ArrowLeft
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #1 of 2');
  });

  it('renders V2 chapters with prominent "model interpretation" and "baseline" tags', () => {
    const v2 = createTestV2();
    const adapter = new ReplayAdapter(v2, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    // Origin is synthetic fixture
    expect(screen.getByTestId('replay-header-origin').textContent).toContain('SYNTHETIC FIXTURE');

    // Model chapter title and explicit status tag
    const chapterItem = screen.getByTestId('replay-chapter-item-model-1');
    expect(chapterItem).toBeDefined();
    expect(chapterItem.textContent).toContain('Implement calculation formula');
    expect(chapterItem.textContent).toContain('model interpretation');

    // Toggle baseline chapters
    const baselineToggle = screen.getByTestId('replay-baseline-toggle');
    fireEvent.click(baselineToggle);

    // Now shows baseline chapter with 'baseline' status
    const baselineItem = screen.getByTestId('replay-chapter-item-base-1');
    expect(baselineItem).toBeDefined();
    expect(baselineItem.textContent).toContain('Initial snapshot and patch');
    expect(baselineItem.textContent).toContain('baseline');
  });

  it('renders historical unified diff and highlights stale AST syntax errors', () => {
    const v1 = createTestV1();
    const adapter = new ReplayAdapter(v1);
    render(<ReplayWorkspace adapter={adapter} />);

    // Navigate to checkpoint #2
    fireEvent.click(screen.getByTestId('replay-next-btn'));

    // Changed file tab
    const fileTabs = screen.getAllByText('calc.py');
    expect(fileTabs.length).toBeGreaterThan(0);
    expect(screen.getByText('MODIFIED')).toBeDefined();

    // Unified diff content
    expect(screen.getByTestId('replay-unified-diff-content').textContent).toContain('+def calculate():');
    expect(screen.getByTestId('replay-unified-diff-content').textContent).toContain('+    return 42');

    // Stale AST / syntax error badge is visibly rendered
    expect(screen.getByTestId('replay-stale-ast-badge').textContent).toContain('Stale AST / Syntax error');

    // Toggle to full source view
    fireEvent.click(screen.getByLabelText('View full historical source'));
    expect(screen.getByTestId('replay-historical-source-content').textContent).toContain('def calculate():');
  });

  it('provides optional project map action without requiring graph to read run', () => {
    const v1 = createTestV1();
    const adapter = new ReplayAdapter(v1);
    const onOpenMap = vi.fn();
    render(<ReplayWorkspace adapter={adapter} onOpenProjectMap={onOpenMap} />);

    const openMapBtn = screen.getByTestId('replay-open-map-btn');
    expect(openMapBtn).toBeDefined();
    fireEvent.click(openMapBtn);
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });
});
