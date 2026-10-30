import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { AutodetectHomeScreen } from '../components/AutodetectHomeScreen';
import { ReplayEvidenceInspector } from '../components/replay/ReplayEvidenceInspector';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import historyFixture from '../fixtures/fixture_replay_history_import.json';
import { plainReplayStepLabel } from '../replay/stepLabel';
import type { AnyReplayExport, ReplayRecord, TimelineEntry } from '../replay/types';
import { FIRST_USE_TIPS_STORAGE_KEY } from '../utils/firstUseTipsStorage';
import { REPLAY_PROJECT_LINKS_STORAGE_KEY } from '../utils/replayProjectLinksStorage';

function timelineEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    sequence: 1,
    record_id: 'synthetic-record',
    record_type: 'checkpoint',
    captured_at: '2026-10-29T12:00:00Z',
    completeness: 'complete',
    attribution_status: 'tool_boundary',
    tool_name: null,
    tool_use_id: null,
    before_manifest_id: null,
    after_manifest_id: null,
    changed_files: [],
    changed_symbols: [],
    test_evidence: [],
    prompt_or_tool_evidence_redacted: false,
    gap_reason: null,
    ...overrides,
  };
}

function replayRecord(overrides: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    schema_version: 'replay-store-1.0',
    id: 'synthetic-record',
    session_id: 'synthetic-session',
    sequence: 1,
    source_identity: 'synthetic',
    source_offset: 0,
    source_sequence: 1,
    record_type: 'checkpoint',
    captured_at: '2026-10-29T12:00:00Z',
    source_timestamp: null,
    provenance: 'history_import',
    completeness: 'complete',
    attribution_status: 'tool_boundary',
    turn_id: null,
    tool_use_id: null,
    tool_name: null,
    checkpoint_id: null,
    manifest_id: null,
    before_manifest_id: null,
    after_manifest_id: null,
    partial: false,
    truncated: false,
    redaction_applied: false,
    tool_input: null,
    tool_response: null,
    gap_reason: null,
    test_refs: [],
    ...overrides,
  };
}

describe('Phase 1 replay history UX', () => {
  beforeEach(() => {
    window.localStorage.removeItem(REPLAY_PROJECT_LINKS_STORAGE_KEY);
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
  });

  it('derives plain step labels from prompt, patch, command, and unknown tool evidence', () => {
    expect(plainReplayStepLabel(
      replayRecord({ prompt_text: 'Explain the failure\nKeep this line hidden' }),
      timelineEntry()
    )).toBe('Explain the failure');
    expect(plainReplayStepLabel(
      replayRecord({ edit_patch: '*** update: src/example.py\n+VALUE = 2' }),
      timelineEntry()
    )).toBe('Edited src/example.py');
    expect(plainReplayStepLabel(
      replayRecord({ edit_command: 'python -m pytest -q\nignored' }),
      timelineEntry()
    )).toBe('Ran: python -m pytest -q');
    expect(plainReplayStepLabel(
      null,
      timelineEntry({ tool_name: 'tool', tool_use_id: 'synthetic-call' })
    )).toBe('Ran a tool action');
  });

  it('shows a plain imported-session step label and keeps provenance in closed details', () => {
    const adapter = new ReplayAdapter(historyFixture as unknown as AnyReplayExport);
    render(
      <ReplayWorkspace
        adapter={adapter}
        importedSessionId="synthetic-session"
        hasSpectateBridge={false}
      />
    );

    expect(screen.getByTestId('replay-step-plain-label').textContent).toContain(
      'Investigate why the nightly invoice reconciliation reports duplicate rows.'
    );
    expect(screen.getByTestId('replay-step-details').hasAttribute('open')).toBe(false);
    expect(screen.getByTestId('timeline-step-indicator').textContent).not.toContain('tool:');
    expect(screen.getByTestId('watch-project-no-bridge').textContent).toBe(
      'Desktop app required to watch local projects'
    );

    fireEvent.click(screen.getByTestId('replay-next-btn'));
    expect(screen.getByTestId('replay-step-plain-label').textContent).toBe(
      'Edited src/reconciliation.py'
    );
  });

  it('persists an imported session project link after the existing watch flow succeeds', async () => {
    const adapter = new ReplayAdapter(historyFixture as unknown as AnyReplayExport);
    const onWatchProject = vi.fn().mockResolvedValue({
      handle: 'synthetic-opaque-handle',
      displayName: 'synthetic-project',
    });
    const onLinkSessionProject = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <ReplayWorkspace
        adapter={adapter}
        importedSessionId="synthetic-session"
        hasSpectateBridge={true}
        onWatchProject={onWatchProject}
        onLinkSessionProject={onLinkSessionProject}
      />
    );

    fireEvent.click(screen.getByTestId('watch-project-choose'));
    await waitFor(() => expect(screen.queryByTestId('watch-project-prompt')).toBeNull());
    expect(onWatchProject).toHaveBeenCalledTimes(1);
    expect(onLinkSessionProject).toHaveBeenCalledWith(
      'synthetic-session',
      'synthetic-opaque-handle'
    );

    const stored = JSON.parse(window.localStorage.getItem(REPLAY_PROJECT_LINKS_STORAGE_KEY) ?? '{}');
    expect(stored.links['synthetic-session']).toEqual({
      handle: 'synthetic-opaque-handle',
      displayName: 'synthetic-project',
    });

    view.unmount();
    render(
      <ReplayWorkspace
        adapter={adapter}
        importedSessionId="synthetic-session"
        hasSpectateBridge={true}
      />
    );
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
  });

  it('shows and remembers dismissal of the home watch-project prompt with honest no-bridge copy', () => {
    const view = render(
      <AutodetectHomeScreen
        onSelectProject={vi.fn()}
        hasBridge={false}
        cachedRoots={[]}
        cachedSessions={[]}
        showWatchProjectPrompt={true}
      />
    );
    expect(screen.getByTestId('watch-project-prompt').textContent).toContain(
      'Give us the project folder to spectate and we can keep this even more up to date'
    );
    expect(screen.getByTestId('watch-project-no-bridge')).toBeDefined();
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();

    view.unmount();
    render(
      <AutodetectHomeScreen
        onSelectProject={vi.fn()}
        hasBridge={false}
        cachedRoots={[]}
        cachedSessions={[]}
        showWatchProjectPrompt={true}
      />
    );
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
  });

  it('fires the imported-session tips once and keeps the help button available to reopen them', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true })
    );
    const adapter = new ReplayAdapter(historyFixture as unknown as AnyReplayExport);
    render(
      <ReplayWorkspace
        adapter={adapter}
        importedSessionId="synthetic-session"
        hasSpectateBridge={false}
      />
    );

    expect(screen.getByTestId('first-use-tip-overlay').getAttribute('data-screen')).toBe(
      'replayHistory'
    );
    fireEvent.click(screen.getByTestId('tip-skip-btn'));
    expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
    fireEvent.click(screen.getByTestId('replay-help-tips-btn'));
    expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
  });

  it('lays evidence tabs and content out without fixed-width or left-edge clipping', () => {
    render(
      <ReplayEvidenceInspector
        narration={null}
        tests={[]}
        limitations={['Synthetic limitation']}
        isNarrationOn={true}
      />
    );
    const pane = screen.getByTestId('replay-evidence-inspector-pane');
    expect(pane.style.width).toBe('100%');
    const testsTab = screen.getByTestId('replay-tab-tests');
    expect(testsTab.parentElement?.style.display).toBe('grid');
    expect(testsTab.parentElement?.style.width).toBe('100%');
  });
});
