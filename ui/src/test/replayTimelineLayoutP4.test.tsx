import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import { ReplayAdapter } from '../adapter/replayAdapter';
import heroFixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { AnyReplayExport, ReplayExportV1 } from '../replay/types';

describe('Phase P4: Timeline-First Layout & Mini-Map Dock', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders default timeline-first layout: hero bar visible, diff viewer as main stage, panels closed by default', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    // 1. Hero timeline bar is rendered
    expect(screen.getByTestId('replay-hero-bar-container')).toBeDefined();
    expect(screen.getByTestId('replay-timeline-bar')).toBeDefined();

    // 2. Header is minimal: position + origin only
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #1 of 7');
    expect(screen.getByTestId('replay-header-origin').textContent).toContain('SYNTHETIC FIXTURE');

    // 3. Diff viewer is main stage content (shows empty state when no changes at step 1, diff pane when changes present)
    expect(screen.getByTestId('replay-main-stage')).toBeDefined();
    expect(screen.getByTestId('replay-empty-diff')).toBeDefined();

    // 4. Chapters rail is closed by default
    const chaptersContainer = screen.getByTestId('replay-chapters-rail-container');
    expect(chaptersContainer.style.display).toBe('none');

    // 5. Evidence drawer is closed by default
    const evidenceContainer = screen.getByTestId('replay-evidence-drawer-container');
    expect(evidenceContainer.style.display).toBe('none');

    // 6. Mini map dock is closed by default
    expect(screen.queryByTestId('replay-minimap-dock')).toBeNull();

    // 7. Step focus strip shows current chapter and honesty signals
    const focusStrip = screen.getByTestId('replay-step-focus-strip');
    expect(focusStrip.textContent).toContain('Configure initial workspace and apply patch');
    expect(focusStrip.textContent).toContain('DETERMINISTIC TEMPLATE');
    expect(screen.getByTestId('replay-historical-status').textContent).toContain('HISTORICAL (STOPPED)');

    // 8. Navigating to step 3 where calc.py is modified shows replay-diff-pane
    const nextBtn = screen.getByTestId('replay-next-btn');
    fireEvent.click(nextBtn); // step 2
    fireEvent.click(nextBtn); // step 3
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Checkpoint #3 of 7');
    expect(screen.getByTestId('replay-diff-pane')).toBeDefined();
  });

  it('toggles Chapters left rail via C key and header button with close button dismissal', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    const chaptersContainer = screen.getByTestId('replay-chapters-rail-container');
    const toggleBtn = screen.getByTestId('replay-toggle-chapters');

    // Initially closed
    expect(chaptersContainer.style.display).toBe('none');

    // Click toggle button -> opens
    fireEvent.click(toggleBtn);
    expect(chaptersContainer.style.display).toBe('flex');

    // Click close button inside rail -> closes
    const closeBtn = screen.getByTestId('replay-chapters-close-btn');
    fireEvent.click(closeBtn);
    expect(chaptersContainer.style.display).toBe('none');

    // Press 'c' key -> opens
    fireEvent.keyDown(window, { key: 'c' });
    expect(chaptersContainer.style.display).toBe('flex');

    // Press 'Escape' -> closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(chaptersContainer.style.display).toBe('none');
  });

  it('toggles Evidence right drawer via E key and header button with close button dismissal', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    const evidenceContainer = screen.getByTestId('replay-evidence-drawer-container');
    const toggleBtn = screen.getByTestId('replay-toggle-evidence');

    // Initially closed
    expect(evidenceContainer.style.display).toBe('none');

    // Click toggle button -> opens
    fireEvent.click(toggleBtn);
    expect(evidenceContainer.style.display).toBe('flex');

    // Click close button inside drawer -> closes
    const closeBtn = screen.getByTestId('replay-evidence-close-btn');
    fireEvent.click(closeBtn);
    expect(evidenceContainer.style.display).toBe('none');

    // Press 'e' key -> opens
    fireEvent.keyDown(window, { key: 'e' });
    expect(evidenceContainer.style.display).toBe('flex');

    // Press 'Escape' -> closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(evidenceContainer.style.display).toBe('none');
  });

  it('toggles Mini Map dock via M key, cycles size states, and persists in localStorage', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    expect(screen.queryByTestId('replay-minimap-dock')).toBeNull();

    // Press 'm' key -> opens dock
    fireEvent.keyDown(window, { key: 'm' });
    let dock = screen.getByTestId('replay-minimap-dock');
    expect(dock).toBeDefined();

    // Default size is small preview (~240px wide, ~160px high)
    expect(dock.style.width).toBe('240px');
    expect(dock.style.height).toBe('160px');

    // Cycle size: small -> medium (~400x260)
    const cycleBtn = screen.getByTestId('replay-minimap-cycle-size');
    fireEvent.click(cycleBtn);
    dock = screen.getByTestId('replay-minimap-dock');
    expect(dock.style.width).toBe('400px');
    expect(dock.style.height).toBe('260px');

    // Cycle size: medium -> full
    fireEvent.click(cycleBtn);
    dock = screen.getByTestId('replay-minimap-dock');
    expect(dock.style.width).toBe('100%');
    expect(dock.style.height).toBe('100%');

    // Cycle size: full -> small
    fireEvent.click(cycleBtn);
    dock = screen.getByTestId('replay-minimap-dock');
    expect(dock.style.width).toBe('240px');
    expect(dock.style.height).toBe('160px');

    // Verify state was saved to localStorage
    const saved = localStorage.getItem('faultmesh:replay:minimap:state');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.isOpen).toBe(true);
    expect(parsed.sizeState).toBe('small');

    // Close via close button
    const closeBtn = screen.getByTestId('replay-minimap-close');
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('replay-minimap-dock')).toBeNull();

    // Verify localStorage reflects closed state
    const savedClosed = JSON.parse(localStorage.getItem('faultmesh:replay:minimap:state')!);
    expect(savedClosed.isOpen).toBe(false);
  });

  it('supports free resizing drag on mini map resize handle', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} defaultMiniMapOpen={true} />);

    const dock = screen.getByTestId('replay-minimap-dock');
    const resizeHandle = screen.getByTestId('replay-minimap-resize-handle');

    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      left: 700,
      top: 500,
      right: 940,
      bottom: 660,
      width: 240,
      height: 160,
      x: 700,
      y: 500,
      toJSON: () => {},
    });

    // Start resize drag
    fireEvent.mouseDown(resizeHandle, { clientX: 700, clientY: 500 });

    // Drag 100px left and 50px up to enlarge
    fireEvent.mouseMove(window, { clientX: 600, clientY: 450 });
    expect(dock.style.width).toBe('340px');
    expect(dock.style.height).toBe('210px');

    // Release drag
    fireEvent.mouseUp(window);
  });

  it('strictly honors Rule 2: shows honest empty state when recording carries no project structure data', () => {
    // Construct valid export with 0 manifest files and 0 changed symbols
    const noStructureFixture: ReplayExportV1 = {
      schema_version: 'replay-export-1.0',
      exported_at: '2026-10-28T12:00:00.000000Z',
      session: {
        schema_version: 'replay-store-1.0',
        id: 'no-structure-session',
        created_at: '2026-10-28T12:00:00.000000Z',
        stopped_at: '2026-10-28T12:05:00.000000Z',
        status: 'stopped',
        project_root_sha256: '0'.repeat(64),
        codex_version: 'codex-cli 0.165.0',
        raw_logging: false,
        limits: {
          max_files: 100,
          max_file_bytes: 1024,
          max_snapshot_bytes: 1024,
          max_store_bytes: 1024,
          max_text_field_bytes: 1024,
        },
      },
      records: [
        {
          schema_version: 'replay-store-1.0',
          id: 'rec-0',
          session_id: 'no-structure-session',
          sequence: 1,
          source_identity: 'init',
          source_offset: 0,
          source_sequence: null,
          record_type: 'initial_snapshot',
          captured_at: '2026-10-28T12:00:00.000000Z',
          source_timestamp: null,
          provenance: 'root',
          completeness: 'complete',
          attribution_status: 'not_applicable',
          turn_id: null,
          tool_use_id: null,
          tool_name: null,
          checkpoint_id: 'man-empty',
          manifest_id: 'man-empty',
          before_manifest_id: null,
          after_manifest_id: 'man-empty',
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
          id: 'man-empty',
          files: [], // EMPTY MANIFEST - NO RECORDED FILES
          skipped: [],
          partial: false,
        },
      ],
      content_base64_by_sha256: {},
      tests: [],
      timeline: [
        {
          sequence: 1,
          record_id: 'rec-0',
          record_type: 'initial_snapshot',
          captured_at: '2026-10-28T12:00:00.000000Z',
          completeness: 'complete',
          attribution_status: 'not_applicable',
          tool_name: null,
          tool_use_id: null,
          before_manifest_id: null,
          after_manifest_id: 'man-empty',
          changed_files: [],
          changed_symbols: [], // NO RECORDED SYMBOLS
          test_evidence: [],
          prompt_or_tool_evidence_redacted: false,
          gap_reason: null,
        },
      ],
      limitations: [],
    };

    const adapter = new ReplayAdapter(noStructureFixture, 'real_recording');
    render(<ReplayWorkspace adapter={adapter} defaultMiniMapOpen={true} />);

    // Must show plain honest empty state - NEVER invent fake nodes!
    const emptyState = screen.getByTestId('replay-minimap-empty-state');
    expect(emptyState).toBeDefined();
    expect(emptyState.textContent).toContain('This recording contains no project-structure data');
    expect(emptyState.textContent).toContain('No file manifests or AST symbols were recorded for this checkpoint');
  });

  it('renders recorded structure nodes in mini map and selects files on click', () => {
    const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} defaultMiniMapOpen={true} />);

    // Step 1 manifest has calc.py
    const fileCard = screen.getByTestId('replay-minimap-file-calc.py');
    expect(fileCard).toBeDefined();
    expect(fileCard.textContent).toContain('calc.py');

    // Click file card selects file in diff viewer
    fireEvent.click(fileCard);
    expect(fileCard.style.backgroundColor).toContain('var(--replay-bg-surface-3');
  });
});
