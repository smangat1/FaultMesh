import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  SYNTHETIC_HISTORY_PAYLOAD,
  createSyntheticReplayExport,
} from '../fixtures/syntheticHistory';
import type { HistorySearchResult, SpectateBridge } from '../spectate/types';

function installSearchBridge(result: HistorySearchResult) {
  const searchHistory = vi.fn().mockResolvedValue(result);
  const importSession = vi.fn().mockImplementation((sessionId: string, tool: string) => (
    Promise.resolve({
      name: `${sessionId}.json`,
      size: 1024,
      text: JSON.stringify(createSyntheticReplayExport(sessionId, tool)),
    })
  ));
  const bridge: SpectateBridge = {
    chooseProjectFolder: vi.fn().mockResolvedValue(null),
    startWatch: vi.fn().mockResolvedValue({ watching: true, displayName: 'project' }),
    stopWatch: vi.fn().mockResolvedValue({ watching: false }),
    onSpectateEvent: vi.fn(() => () => {}),
    listHistory: vi.fn().mockResolvedValue(SYNTHETIC_HISTORY_PAYLOAD),
    searchHistory,
    importSession,
  };
  window.faultmeshSpectate = bridge;
  return { searchHistory, importSession };
}

const groupedResult: HistorySearchResult = {
  schema_version: 'history-search-1.0',
  query: 'auth',
  match_count: 2,
  indexed_session_count: 8,
  sessions: [
    {
      session_id: 'codex-sess-title',
      tool: 'codex',
      source: 'history',
      title: 'Token leak investigation',
      project_display_name: 'auth-service',
      started_at: '2026-10-29T08:30:00Z',
      ended_at: '2026-10-29T08:45:00Z',
      prompts: [{
        prompt_id: 'prompt-title',
        first_line: 'Check authentication token leakage',
        start_sequence: 5,
        end_sequence: 7,
        changed_files: ['src/auth.ts'],
        changed_file_count: 1,
        started_at: '2026-10-29T08:30:00Z',
        ended_at: '2026-10-29T08:45:00Z',
        matched_in: ['prompt_text', 'changed_file'],
      }],
    },
    {
      session_id: 'codex-sess-1',
      tool: 'codex',
      source: 'history',
      title: 'Fix token expiration bug [redacted: jwt secret] in auth handler',
      project_display_name: 'auth-service',
      started_at: '2026-10-29T10:00:00Z',
      ended_at: '2026-10-29T10:15:00Z',
      prompts: [{
        prompt_id: 'prompt-auth',
        first_line: 'Repair the auth middleware [redacted: token]',
        start_sequence: 2,
        end_sequence: 3,
        changed_files: ['src/auth.py'],
        changed_file_count: 1,
        started_at: '2026-10-29T10:00:00Z',
        ended_at: '2026-10-29T10:05:00Z',
        matched_in: ['session_title', 'prompt_text', 'changed_file'],
      }],
    },
  ],
};

describe('Phase 5: cross-session history search', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true }),
    );
  });

  afterEach(() => {
    delete window.faultmeshSpectate;
    window.localStorage.clear();
  });

  it('groups local matches by session and jumps to the selected prompt', async () => {
    const bridge = installSearchBridge(groupedResult);
    render(<App />);
    const input = await screen.findByTestId('history-search-input');

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'auth' } });

    await waitFor(() => expect(bridge.searchHistory).toHaveBeenCalledWith('auth'));
    expect(screen.getByTestId('history-search-session-codex-sess-title')).toBeDefined();
    expect(screen.getByTestId('history-search-session-codex-sess-1')).toBeDefined();
    expect(screen.getByTestId('history-search-results').textContent).toContain('2 matching prompts');
    expect(screen.getByTestId('history-search-results').textContent).toContain('src/auth.ts');
    expect(screen.getByTestId('history-search-results').textContent).toContain('[redacted: token]');

    fireEvent.click(screen.getByTestId('history-search-prompt-codex-sess-title-5'));
    await waitFor(() => {
      expect(bridge.importSession).toHaveBeenCalledWith('codex-sess-title', 'codex');
      expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Prompt 4 of 4');
    });
  });

  it('shows an honest empty state while background indexing remains explicit', async () => {
    installSearchBridge({
      schema_version: 'history-search-1.0',
      query: 'missing phrase',
      sessions: [],
      match_count: 0,
      indexed_session_count: 5,
    });
    render(<App />);
    fireEvent.change(await screen.findByTestId('history-search-input'), {
      target: { value: 'missing phrase' },
    });

    const empty = await screen.findByTestId('history-search-empty');
    expect(empty.textContent).toContain('No matching prompts');
    expect(empty.textContent).toContain('indexed quietly in the background');
    expect(screen.getByTestId('history-search-results').textContent).toContain('5 indexed sessions');
  });
});
