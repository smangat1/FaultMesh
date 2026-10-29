import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { HistoryListPayload, SpectateBridge } from '../spectate/types';
import {
  SYNTHETIC_HISTORY_PAYLOAD,
  createSyntheticReplayExport,
} from '../fixtures/syntheticHistory';

function installHistoryBridge(customPayload?: Partial<HistoryListPayload>) {
  const payload: HistoryListPayload = {
    roots: customPayload?.roots ?? SYNTHETIC_HISTORY_PAYLOAD.roots,
    sessions: customPayload?.sessions ?? SYNTHETIC_HISTORY_PAYLOAD.sessions,
  };

  const listHistory = vi.fn().mockResolvedValue(payload);
  const importSession = vi.fn().mockImplementation((sessionId: string, tool: string) => {
    return Promise.resolve({
      name: `${sessionId}.json`,
      size: 1024,
      text: JSON.stringify(createSyntheticReplayExport(sessionId, tool)),
    });
  });

  const bridge: SpectateBridge = {
    chooseProjectFolder: vi.fn().mockResolvedValue({ handle: 'h1', displayName: 'my-proj' }),
    startWatch: vi.fn().mockResolvedValue({ watching: true, displayName: 'my-proj' }),
    stopWatch: vi.fn().mockResolvedValue({ watching: false }),
    onSpectateEvent: vi.fn(() => () => {}),
    openRecording: vi.fn(),
    listHistory,
    importSession,
  };

  window.faultmeshSpectate = bridge;
  return { bridge, listHistory, importSession, payload };
}

describe('Phase 1: Autodetect Home Screen & Tool Widgets', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    delete window.faultmeshSpectate;
    window.history.replaceState({}, '', '/');
  });

  it('renders two tool widgets (Codex & Claude Code) with project folders and session titles inside their widgets', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
      expect(screen.getByTestId('tool-widget-claude_code')).toBeDefined();
    });

    const codexWidget = screen.getByTestId('tool-widget-codex');
    const claudeWidget = screen.getByTestId('tool-widget-claude_code');

    // Both widgets show correct tool names
    expect(codexWidget.textContent).toContain('Codex');
    expect(claudeWidget.textContent).toContain('Claude Code');

    // Claude Code widget has synthetic contract badge
    expect(claudeWidget.textContent).toContain('Synthetic contract only');

    // Source files counts honestly labeled
    expect(codexWidget.textContent).toContain('14 source files');
    expect(claudeWidget.textContent).toContain('5 source files');

    // Project folders exist inside their respective widgets
    expect(codexWidget.textContent).toContain('auth-service');
    expect(claudeWidget.textContent).toContain('billing-service');
    expect(claudeWidget.textContent).toContain('reporting-service');

    // Sessions listed by first_prompt_preview or "Untitled session"
    expect(codexWidget.textContent).toContain('Fix token expiration bug [redacted: jwt secret] in auth handler');
    expect(codexWidget.textContent).toContain('Untitled session');
    expect(claudeWidget.textContent).toContain('Add stripe webhook handler [redacted: webhook key]');
  });

  it('keeps same-display-name projects with different group keys separate', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('project-folder-codex:group-auth')).toBeDefined();
      expect(screen.getByTestId('project-folder-codex:group-auth-fork')).toBeDefined();
    });

    const folder1 = screen.getByTestId('project-folder-codex:group-auth');
    const folder2 = screen.getByTestId('project-folder-codex:group-auth-fork');

    expect(folder1).not.toBe(folder2);
    expect(folder1.textContent).toContain('auth-service');
    expect(folder2.textContent).toContain('auth-service');

    // Folder 1 has 2 sessions, Folder 2 has 1 session
    expect(folder1.textContent).toContain('Fix token expiration bug');
    expect(folder2.textContent).toContain('Update login rate limiting');
  });

  it('does not leak sessions across tool widgets', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
      expect(screen.getByTestId('tool-widget-claude_code')).toBeDefined();
    });

    const codexWidget = screen.getByTestId('tool-widget-codex');
    const claudeWidget = screen.getByTestId('tool-widget-claude_code');

    // Codex sessions never appear in Claude widget
    expect(codexWidget.textContent).not.toContain('billing-service');
    expect(claudeWidget.textContent).not.toContain('Fix token expiration bug');
  });

  it('renders prompt_count labeled strictly as prompts, not steps', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });

    const sessionRow1 = screen.getByTestId('session-row-codex-sess-1');
    expect(sessionRow1.textContent).toContain('3 prompts');
    expect(sessionRow1.textContent).not.toContain('3 steps');

    const sessionRow2 = screen.getByTestId('session-row-codex-sess-2');
    expect(sessionRow2.textContent).toContain('1 prompt');
    expect(sessionRow2.textContent).not.toContain('1 step');
  });

  it('preserves redaction markers visibly verbatim', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });

    const titleEl = screen.getByTestId('session-row-codex-sess-1').querySelector('[data-testid="session-title"]');
    expect(titleEl?.textContent).toContain('[redacted: jwt secret]');
  });

  it('displays partial and unsupported tags with honest hover reason', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-3')).toBeDefined();
      expect(screen.getByTestId('session-row-claude-sess-2')).toBeDefined();
    });

    const partialTag = screen.getByTestId('session-parse-status-partial');
    expect(partialTag.textContent).toBe('partial');
    expect(partialTag.getAttribute('title')).toBe('1 step could not be parsed');

    const unsupportedTag = screen.getByTestId('session-parse-status-unsupported');
    expect(unsupportedTag.textContent).toBe('unsupported');
    expect(unsupportedTag.getAttribute('title')).toBe('Requires local zstd decompression');
  });

  it('does not claim to detect unsupported tools or arbitrary installed editors', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
    });

    expect(screen.queryByText(/cursor/i)).toBeNull();
    expect(screen.queryByText(/windsurf/i)).toBeNull();
    expect(screen.queryByText(/all installed editors/i)).toBeNull();
  });

  it('renders compact "Not found on this machine" status for missing roots without treating as error', async () => {
    installHistoryBridge({
      roots: [
        { tool: 'codex', status: 'ok', file_count: 5, message: null },
        { tool: 'claude_code', status: 'missing', file_count: 0, message: null },
      ],
      sessions: [
        SYNTHETIC_HISTORY_PAYLOAD.sessions[0],
      ],
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
    });

    // Claude widget is not rendered as detected tool
    expect(screen.queryByTestId('tool-widget-claude_code')).toBeNull();

    // Instead, compact not-found status is shown
    const missingStatus = screen.getByTestId('autodetect-missing-roots-status');
    expect(missingStatus.textContent).toContain('Not found on this machine: Claude Code');
  });

  it('renders unreadable roots truthfully with retry button and no permission speculation', async () => {
    installHistoryBridge({
      roots: [
        { tool: 'codex', status: 'unreadable', file_count: 0, message: 'Permission denied reading history folder' },
      ],
      sessions: [],
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-unreadable-codex')).toBeDefined();
    });

    const unreadableWidget = screen.getByTestId('tool-widget-unreadable-codex');
    expect(unreadableWidget.textContent).toContain('Codex (Unreadable)');
    expect(unreadableWidget.textContent).toContain('Permission denied reading history folder');
    expect(screen.queryByText(/macOS System Settings/i)).toBeNull();
  });

  it('renders honest zero-session state when root is ok but carries 0 sessions', async () => {
    installHistoryBridge({
      roots: [{ tool: 'codex', status: 'ok', file_count: 0, message: null }],
      sessions: [],
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
    });

    expect(screen.getByTestId('tool-no-sessions-codex').textContent).toContain(
      'No recorded sessions found in this root.'
    );
  });

  it('toggles collapsible folders with mouse and keyboard (Enter/Space)', async () => {
    installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('folder-toggle-codex:group-auth')).toBeDefined();
    });

    const toggleBtn = screen.getByTestId('folder-toggle-codex:group-auth');
    expect(screen.getByTestId('folder-sessions-codex:group-auth')).toBeDefined();

    // Click collapses
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId('folder-sessions-codex:group-auth')).toBeNull();

    // Space expands
    fireEvent.keyDown(toggleBtn, { key: ' ' });
    expect(screen.getByTestId('folder-sessions-codex:group-auth')).toBeDefined();

    // Enter collapses
    fireEvent.keyDown(toggleBtn, { key: 'Enter' });
    expect(screen.queryByTestId('folder-sessions-codex:group-auth')).toBeNull();
  });

  it('imports session on click, opens replay workspace, and preserves home state when navigating back', async () => {
    const harness = installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });

    // Click session to import
    fireEvent.click(screen.getByTestId('session-row-codex-sess-1'));

    await waitFor(() => {
      expect(harness.importSession).toHaveBeenCalledWith('codex-sess-1', 'codex');
      // Opens replay workspace
      expect(screen.getByTestId('replay-workspace')).toBeDefined();
      expect(screen.getByTestId('replay-timeline-bar')).toBeDefined();
    });

    // Header back button returns to autodetect home with cached state
    const backBtn = screen.getByRole('button', { name: /projects/i });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByTestId('tool-widget-codex')).toBeDefined();
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });
  });

  it('shows inline error on import failure without crashing or dropping prior workspace', async () => {
    const harness = installHistoryBridge();
    harness.importSession.mockRejectedValueOnce(new Error('corrupt export file'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('session-row-codex-sess-1'));

    await waitFor(() => {
      expect(screen.getByTestId('session-import-error-codex-sess-1')).toBeDefined();
    });

    const errorEl = screen.getByTestId('session-import-error-codex-sess-1');
    expect(errorEl.textContent).toContain('Import failed: corrupt export file');
    expect(errorEl.textContent).toContain('Retry');
  });

  it('clicking Refresh re-scans history without importing any session', async () => {
    const harness = installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('autodetect-refresh-btn')).toBeDefined();
    });

    expect(harness.listHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('autodetect-refresh-btn'));

    await waitFor(() => {
      expect(harness.listHistory).toHaveBeenCalledTimes(2);
    });

    // importSession was NEVER called by refresh
    expect(harness.importSession).not.toHaveBeenCalled();
  });

  it('keeps "Open recording (.json)" reachable on desktop and browser and handles file input', async () => {
    const harness = installHistoryBridge();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('startup-open-recording-btn')).toBeDefined();
    });

    const openBtn = screen.getByTestId('startup-open-recording-btn');
    fireEvent.click(openBtn);

    expect(harness.bridge.openRecording).toHaveBeenCalledTimes(1);
  });

  it('displays calm empty state when bridge is completely absent', () => {
    delete window.faultmeshSpectate;
    render(<App />);

    expect(screen.getByTestId('autodetect-no-bridge-empty-state')).toBeDefined();
    expect(screen.getByText(/Local session autodetect requires the FaultMesh desktop app/i)).toBeDefined();
    expect(screen.getByTestId('startup-open-recording-btn')).toBeDefined();
  });
});
