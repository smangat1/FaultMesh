import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  SYNTHETIC_HISTORY_PAYLOAD,
  createSyntheticReplayExport,
} from '../fixtures/syntheticHistory';
import type { ReplayExportV2 } from '../replay/types';
import type { HistorySearchResult, SpectateBridge } from '../spectate/types';

const SESSION_ID = 'codex-sess-1';

function withNewPrompt(): ReplayExportV2 {
  const exported = structuredClone(
    createSyntheticReplayExport(SESSION_ID, 'codex')
  ) as ReplayExportV2;
  const previousRecord = exported.records[exported.records.length - 1];
  const previousEntry = exported.timeline[exported.timeline.length - 1];
  exported.records.push({
    ...previousRecord,
    id: 'rec-live-8',
    session_id: SESSION_ID,
    sequence: 8,
    source_identity: 'prompt:live-8',
    captured_at: '2026-10-28T12:20:00.000000Z',
    turn_id: 'turn-live',
    prompt_id: 'prompt-live',
    prompt_text: 'Document the negative input behavior.',
  });
  exported.timeline.push({
    ...previousEntry,
    sequence: 8,
    record_id: 'rec-live-8',
    captured_at: '2026-10-28T12:20:00.000000Z',
  });
  exported.chapters = exported.chapters.map((chapter) => (
    chapter.id === 'chapter:hero-c2'
      ? {
          ...chapter,
          end_sequence: 8,
          evidence_refs: [...chapter.evidence_refs, 'rec-live-8'],
          title: 'Recorded events extended',
          source: 'deterministic_fixed_group',
          title_status: 'deterministic template',
        }
      : chapter
  ));
  exported.baseline_chapters = exported.baseline_chapters.map((chapter) => (
    chapter.id === 'chapter:base-2'
      ? { ...chapter, end_sequence: 8, evidence_refs: [...chapter.evidence_refs, 'rec-live-8'] }
      : chapter
  ));
  exported.chapter_run = { ...exported.chapter_run, chapters: exported.chapters };
  return exported;
}

const searchResult: HistorySearchResult = {
  schema_version: 'history-search-1.0',
  query: 'negative',
  match_count: 1,
  indexed_session_count: 1,
  sessions: [{
    session_id: SESSION_ID,
    tool: 'codex',
    source: 'history',
    title: 'Calculator safety',
    project_display_name: 'calculator',
    started_at: '2026-10-28T12:00:00Z',
    ended_at: '2026-10-28T12:19:00Z',
    prompts: [{
      prompt_id: 'turn-1',
      first_line: 'Handle negative calculator inputs',
      start_sequence: 2,
      end_sequence: 3,
      changed_files: ['calc.py'],
      changed_file_count: 1,
      started_at: '2026-10-28T12:01:00Z',
      ended_at: '2026-10-28T12:03:00Z',
      matched_in: ['prompt_text'],
    }],
  }],
};

describe('Phase 7: live prompt surfacing', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true }),
    );
    window.localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({
        dismissedSessionIds: [SESSION_ID],
        links: { [SESSION_ID]: { handle: 'opaque-handle', displayName: 'calculator' } },
      }),
    );
  });

  afterEach(() => {
    delete window.faultmeshSpectate;
    window.localStorage.clear();
  });

  it('extends the open replay and announces a new prompt without moving the current selection', async () => {
    const initial = createSyntheticReplayExport(SESSION_ID, 'codex');
    const updated = withNewPrompt();
    const importSession = vi.fn()
      .mockResolvedValueOnce({
        name: 'initial.json',
        size: JSON.stringify(initial).length,
        text: JSON.stringify(initial),
      })
      .mockResolvedValue({
        name: 'updated.json',
        size: JSON.stringify(updated).length,
        text: JSON.stringify(updated),
      });
    const listPrompts = vi.fn().mockResolvedValue({
      schema_version: 'history-prompt-index-1.1' as const,
      session_id: SESSION_ID,
      source_file_sha256: 'b'.repeat(64),
      cached: false,
      prompts: [{
        prompt_id: 'prompt-live',
        first_line: 'Document the negative input behavior.',
        start_sequence: 8,
        end_sequence: 8,
        changed_files: [],
        changed_file_count: 0,
        started_at: '2026-10-28T12:20:00Z',
        ended_at: '2026-10-28T12:20:00Z',
        test_observation: 'not_observed' as const,
        grouping: 'prompt_turn' as const,
      }],
    });
    const bridge: SpectateBridge = {
      chooseProjectFolder: vi.fn().mockResolvedValue(null),
      startWatch: vi.fn().mockResolvedValue({ watching: true, displayName: 'calculator' }),
      stopWatch: vi.fn().mockResolvedValue({ watching: false }),
      onSpectateEvent: vi.fn(() => () => {}),
      listHistory: vi.fn().mockResolvedValue(SYNTHETIC_HISTORY_PAYLOAD),
      searchHistory: vi.fn().mockResolvedValue(searchResult),
      listPrompts,
      importSession,
    };
    window.faultmeshSpectate = bridge;

    render(<App />);
    fireEvent.change(await screen.findByTestId('history-search-input'), {
      target: { value: 'negative' },
    });
    fireEvent.click(await screen.findByTestId(`history-search-prompt-${SESSION_ID}-2`));

    await waitFor(() => expect(screen.getByTestId('replay-recording-indicator')).toBeDefined());
    await waitFor(() => expect(importSession).toHaveBeenCalledTimes(2));
    expect(listPrompts).toHaveBeenCalledWith(SESSION_ID, 'codex');
    expect((await screen.findByTestId('replay-new-prompt-toast')).textContent).toContain(
      'New prompt recorded'
    );
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Prompt 2 of 5');
    fireEvent.click(screen.getByTestId('replay-toggle-chapters'));
    expect(screen.getByTestId('replay-chapters-rail-container').textContent).toContain(
      'Refactor core logic and verify tests'
    );
    expect(screen.getByTestId('replay-chapters-rail-container').textContent).not.toContain(
      'Recorded events extended'
    );
    fireEvent.click(screen.getByTestId('replay-toggle-chapters'));

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByTestId('replay-next-btn'));
    }
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Prompt 5 of 5');
    expect(screen.getByTestId('replay-prompt-card').textContent).toContain(
      'Document the negative input behavior.'
    );
  });
});
