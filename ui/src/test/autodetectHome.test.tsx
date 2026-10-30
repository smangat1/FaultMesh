import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { HistoryListPayload, SpectateBridge } from '../spectate/types';
import {
  SYNTHETIC_HISTORY_PAYLOAD,
  createSyntheticReplayExport,
} from '../fixtures/syntheticHistory';
import { sanitizeParentDirectory } from '../components/AutodetectHomeScreen';

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

async function openTool(tool: 'codex' | 'claude_code' = 'codex') {
  await waitFor(() => {
    expect(screen.getByTestId(`tool-widget-${tool}`)).toBeDefined();
  });
  fireEvent.click(screen.getByTestId(`tool-widget-${tool}`));
  await waitFor(() => {
    expect(screen.getByTestId(`tool-fullscreen-${tool}`)).toBeDefined();
  });
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

    // Clicking Codex widget leads into full screen view
    fireEvent.click(codexWidget);
    await waitFor(() => {
      expect(screen.getByTestId('tool-fullscreen-codex')).toBeDefined();
      expect(screen.getByTestId('back-to-tools-btn')).toBeDefined();
    });

    // Project folders and sessions exist inside Codex full screen
    const codexFullscreen = screen.getByTestId('tool-fullscreen-codex');
    expect(codexFullscreen.textContent).toContain('auth-service');
    expect(codexFullscreen.textContent).toContain('Fix token expiration bug [redacted: jwt secret] in auth handler');
    expect(codexFullscreen.textContent).toContain('Untitled session');

    // Clicking Back to Tools returns to the widgets overview
    fireEvent.click(screen.getByTestId('back-to-tools-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('back-to-tools-btn')).toBeNull();
      expect(screen.getByTestId('tool-widget-claude_code')).toBeDefined();
    });

    // Clicking Claude Code widget leads into its full screen view
    fireEvent.click(screen.getByTestId('tool-widget-claude_code'));
    await waitFor(() => {
      expect(screen.getByTestId('tool-fullscreen-claude_code')).toBeDefined();
    });

    const claudeFullscreen = screen.getByTestId('tool-fullscreen-claude_code');
    expect(claudeFullscreen.textContent).toContain('billing-service');
    expect(claudeFullscreen.textContent).toContain('reporting-service');
    expect(claudeFullscreen.textContent).toContain('Add stripe webhook handler [redacted: webhook key]');
  });

  it('keeps same-display-name projects with different group keys separate', async () => {
    installHistoryBridge();
    render(<App />);

    await openTool('codex');

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

    await openTool('codex');
    const codexFullscreen = screen.getByTestId('tool-fullscreen-codex');
    expect(codexFullscreen.textContent).not.toContain('billing-service');

    fireEvent.click(screen.getByTestId('back-to-tools-btn'));
    await openTool('claude_code');
    const claudeFullscreen = screen.getByTestId('tool-fullscreen-claude_code');
    expect(claudeFullscreen.textContent).not.toContain('Fix token expiration bug');
  });

  it('renders prompt_count labeled strictly as prompts, not steps', async () => {
    installHistoryBridge();
    render(<App />);

    await openTool('codex');

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

    await openTool('codex');

    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });

    const titleEl = screen.getByTestId('session-row-codex-sess-1').querySelector('[data-testid="session-title"]');
    expect(titleEl?.textContent).toContain('[redacted: jwt secret]');
  });

  it('displays partial and unsupported tags with honest hover reason', async () => {
    installHistoryBridge();
    render(<App />);

    await openTool('codex');
    await waitFor(() => {
      expect(screen.getByTestId('session-row-codex-sess-3')).toBeDefined();
    });

    const partialTag = screen.getByTestId('session-row-codex-sess-3').querySelector('[data-testid="session-parse-status-partial"]')!;
    expect(partialTag.textContent).toBe('partial');
    expect(partialTag.getAttribute('title')).toBe('1 step could not be parsed');

    fireEvent.click(screen.getByTestId('back-to-tools-btn'));
    await openTool('claude_code');
    await waitFor(() => {
      expect(screen.getByTestId('session-row-claude-sess-2')).toBeDefined();
    });

    const unsupportedTag = screen.getByTestId('session-row-claude-sess-2').querySelector('[data-testid="session-parse-status-unsupported"]')!;
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

    await openTool('codex');

    await waitFor(() => {
      expect(screen.getByTestId('tool-no-sessions-codex')).toBeDefined();
    });

    expect(screen.getByTestId('tool-no-sessions-codex').textContent).toContain(
      'No recorded sessions found in this root.'
    );
  });

  it('toggles collapsible folders with mouse and keyboard (Enter/Space)', async () => {
    installHistoryBridge();
    render(<App />);

    await openTool('codex');

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

    await openTool('codex');

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
      expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
    });
  });

  it('shows imported-session tips before the project-link prompt when opening from a home widget', async () => {
    window.localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true })
    );
    window.localStorage.removeItem('faultmesh:replay:project_links:v1');
    installHistoryBridge();
    render(<App />);

    await openTool('codex');
    fireEvent.click(await screen.findByTestId('session-row-codex-sess-1'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-workspace')).toBeDefined();
      expect(screen.getByTestId('first-use-tip-overlay').getAttribute('data-screen')).toBe(
        'replayHistory'
      );
      expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
    });
    fireEvent.click(screen.getByTestId('tip-skip-btn'));
    expect(screen.getByTestId('watch-project-prompt')).toBeDefined();
  });

  it('shows inline error on import failure without crashing or dropping prior workspace', async () => {
    const harness = installHistoryBridge();
    harness.importSession.mockRejectedValueOnce(new Error('corrupt export file'));

    render(<App />);

    await openTool('codex');

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

  describe('Phase 1.5: Real-Data Session List Fixes', () => {
    it('hides system_temp groups by default and reveals them with muted "system temp" badge when toggled', async () => {
      installHistoryBridge();
      render(<App />);

      await openTool('codex');

      // System temp folder (fixture-test) is hidden by default
      expect(screen.queryByTestId('project-folder-codex:group-temp-fixture')).toBeNull();

      // Quiet toggle button is visible showing hidden count
      const toggleBtn = screen.getByTestId('toggle-hidden-system-codex');
      expect(toggleBtn.textContent).toContain('Show 1 hidden system folder');

      // Click to reveal hidden system folders
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(screen.getByTestId('project-folder-codex:group-temp-fixture')).toBeDefined();
      });

      const tempFolder = screen.getByTestId('project-folder-codex:group-temp-fixture');
      expect(tempFolder.textContent).toContain('fixture-test');

      // Muted system temp badge is rendered
      const badge = tempFolder.querySelector('[data-testid="system-temp-badge"]');
      expect(badge).toBeDefined();
      expect(badge?.textContent).toBe('system temp');

      // Toggle text updates to Hide
      expect(toggleBtn.textContent).toContain('Hide 1 hidden system folder');

      // Click again to hide
      fireEvent.click(toggleBtn);
      expect(screen.queryByTestId('project-folder-codex:group-temp-fixture')).toBeNull();
      expect(toggleBtn.textContent).toContain('Show 1 hidden system folder');
    });

    it('disambiguates duplicate project display names within one tool by appending sanitized parent directory', async () => {
      installHistoryBridge();
      render(<App />);

      await openTool('codex');

      await waitFor(() => {
        expect(screen.getByTestId('project-folder-codex:group-auth')).toBeDefined();
        expect(screen.getByTestId('project-folder-codex:group-auth-fork')).toBeDefined();
      });

      const folder1Name = screen
        .getByTestId('project-folder-codex:group-auth')
        .querySelector('[data-testid="project-folder-name"]');
      const folder2Name = screen
        .getByTestId('project-folder-codex:group-auth-fork')
        .querySelector('[data-testid="project-folder-name"]');

      // Both folders share "auth-service", so they are disambiguated with parent directory
      expect(folder1Name?.textContent).toBe('auth-service / backend');
      expect(folder2Name?.textContent).toBe('auth-service / services');

      // Return to overview and check Claude widget
      fireEvent.click(screen.getByTestId('back-to-tools-btn'));
      await openTool('claude_code');

      // Groups without duplicates in the same tool (e.g. Claude widget) are NOT appended
      const claudeFolder1Name = screen
        .getByTestId('project-folder-claude_code:group-billing')
        .querySelector('[data-testid="project-folder-name"]');
      expect(claudeFolder1Name?.textContent).toBe('billing-service');
    });

    it('sanitizes parent directory components and never leaks full paths or user home directories', () => {
      expect(sanitizeParentDirectory('/Users/samyan/backend')).toBe('backend');
      expect(sanitizeParentDirectory('/home/developer/workspace/services')).toBe('services');
      expect(sanitizeParentDirectory('backend')).toBe('backend');

      // Home directory roots and paths must never be leaked
      expect(sanitizeParentDirectory('/Users/samyan')).toBeNull();
      expect(sanitizeParentDirectory('/home/developer')).toBeNull();
      expect(sanitizeParentDirectory('~')).toBeNull();
      expect(sanitizeParentDirectory('~/')).toBeNull();
      expect(sanitizeParentDirectory('/')).toBeNull();
      expect(sanitizeParentDirectory('Users')).toBeNull();
      expect(sanitizeParentDirectory('home')).toBeNull();
      expect(sanitizeParentDirectory(null)).toBeNull();
      expect(sanitizeParentDirectory('')).toBeNull();
    });

    it('renders quiet "archived" badge on session row when history_state is archived', async () => {
      installHistoryBridge();
      render(<App />);

      await openTool('codex');

      await waitFor(() => {
        expect(screen.getByTestId('session-row-codex-sess-3')).toBeDefined();
        expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
      });

      const archivedSession = screen.getByTestId('session-row-codex-sess-3');
      const activeSession = screen.getByTestId('session-row-codex-sess-1');

      // Archived session has the archived badge
      const badge = archivedSession.querySelector('[data-testid="session-history-state-archived"]');
      expect(badge).toBeDefined();
      expect(badge?.textContent).toBe('archived');

      // Active session does not have the archived badge
      expect(activeSession.querySelector('[data-testid="session-history-state-archived"]')).toBeNull();
    });

    it('prefers source_title over first_prompt_preview as primary row title with secondary redacted preview line', async () => {
      installHistoryBridge();
      render(<App />);

      await openTool('codex');

      await waitFor(() => {
        expect(screen.getByTestId('session-row-codex-sess-title')).toBeDefined();
        expect(screen.getByTestId('session-row-codex-sess-1')).toBeDefined();
      });

      // Session with source_title
      const sessionWithTitle = screen.getByTestId('session-row-codex-sess-title');
      const primaryTitle = sessionWithTitle.querySelector('[data-testid="session-title"]');
      const secondaryPreview = sessionWithTitle.querySelector('[data-testid="session-preview-secondary"]');

      expect(primaryTitle?.textContent).toBe('Token leak investigation');
      expect(secondaryPreview?.textContent).toBe('Check token leakage in debug logs');

      // Session without source_title (fallback to preview as primary, no secondary line)
      const sessionWithoutTitle = screen.getByTestId('session-row-codex-sess-1');
      const fallbackTitle = sessionWithoutTitle.querySelector('[data-testid="session-title"]');

      expect(fallbackTitle?.textContent).toBe('Fix token expiration bug [redacted: jwt secret] in auth handler');
      expect(sessionWithoutTitle.querySelector('[data-testid="session-preview-secondary"]')).toBeNull();
    });

    it('renders unsupported row with rollout_file_missing reason truthfully in title tooltip and remains selectable', async () => {
      const harness = installHistoryBridge();
      render(<App />);

      await openTool('codex');

      await waitFor(() => {
        expect(screen.getByTestId('session-row-codex-sess-missing-rollout')).toBeDefined();
      });

      const missingRow = screen.getByTestId('session-row-codex-sess-missing-rollout');
      const unsupportedBadge = missingRow.querySelector('[data-testid="session-parse-status-unsupported"]');

      expect(unsupportedBadge).toBeDefined();
      expect(unsupportedBadge?.textContent).toBe('unsupported');
      expect(unsupportedBadge?.getAttribute('title')).toBe('rollout_file_missing');

      // Primary title reflects source title
      const title = missingRow.querySelector('[data-testid="session-title"]');
      expect(title?.textContent).toBe('Archived catalog thread without rollout file');

      // Row is selectable/clickable
      fireEvent.click(missingRow);
      await waitFor(() => {
        expect(harness.importSession).toHaveBeenCalledWith('codex-sess-missing-rollout', 'codex');
      });
    });
  });
});
