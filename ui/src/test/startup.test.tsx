import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { SpectateBridge, SpectateEvent } from '../spectate/types';

function installBridge() {
  let callback: ((event: SpectateEvent) => void) | null = null;
  const bridge: SpectateBridge = {
    chooseProjectFolder: vi.fn().mockResolvedValue({ handle: 'opaque', displayName: 'my-app' }),
    startWatch: vi.fn().mockResolvedValue({ watching: true, displayName: 'my-app' }),
    stopWatch: vi.fn().mockResolvedValue({ watching: false }),
    onSpectateEvent: vi.fn((listener: (event: SpectateEvent) => void) => {
      callback = listener;
      return () => {
        callback = null;
      };
    }),
  };
  window.faultmeshSpectate = bridge;
  return {
    bridge,
    emit(event: SpectateEvent) {
      if (!callback) throw new Error('spectate listener is not installed');
      act(() => callback?.(event));
    },
  };
}

describe('Real-project-first Startup Screen', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    delete window.faultmeshSpectate;
    window.history.replaceState({}, '', '/');
  });

  it('renders a minimal, quiet startup screen with Select project button and no Open Project JSON button', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'FaultMesh' })).toBeDefined();
    expect(screen.getByText(/Live architectural map and execution tracer for Python codebases/i)).toBeDefined();

    const selectBtn = screen.getByRole('button', { name: /select project/i });
    expect(selectBtn).toBeDefined();

    expect(screen.queryByRole('button', { name: /open project json/i })).toBeNull();
    expect(screen.queryByText(/Open Real Project Export/i)).toBeNull();
  });

  it('does not render sample cards, Recorded Sample Run, Agent Repair, or marketing cards at normal startup', () => {
    render(<App />);

    expect(screen.queryByText('auth-service')).toBeNull();
    expect(screen.queryByText('empty-repo')).toBeNull();
    expect(screen.queryByText('payment-gateway')).toBeNull();

    expect(screen.queryByRole('button', { name: /load recorded sample run/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /watch agent repair/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /explore project map/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open project map/i })).toBeNull();

    expect(screen.queryByText(/1\. Whole-Project Map/i)).toBeNull();
    expect(screen.queryByText(/2\. Test Execution Tracing/i)).toBeNull();
    expect(screen.queryByText(/3\. Grounded Inspector/i)).toBeNull();
  });

  it('disables Select project button in a plain browser and displays desktop app requirement note', () => {
    render(<App />);

    const selectBtn = screen.getByRole('button', { name: /select project/i });
    expect(selectBtn.getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText('Desktop app required to watch local projects')).toBeDefined();
  });

  it('enables Select project directly from startup screen with Electron bridge and starts watch without Explore Project Map detour', async () => {
    const harness = installBridge();
    render(<App />);

    const selectBtn = screen.getByRole('button', { name: /select project/i });
    expect(selectBtn.getAttribute('disabled')).toBeNull();
    expect(screen.queryByText('Desktop app required to watch local projects')).toBeNull();

    fireEvent.click(selectBtn);

    await waitFor(() => {
      expect(harness.bridge.chooseProjectFolder).toHaveBeenCalledTimes(1);
      expect(harness.bridge.startWatch).toHaveBeenCalledTimes(1);
    });
  });

  it('transitions to workspace with real project data when initial_snapshot is received', async () => {
    const harness = installBridge();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /select project/i }));
    await waitFor(() => expect(harness.bridge.startWatch).toHaveBeenCalledTimes(1));

    harness.emit({
      schema_version: 'spectate-1.1',
      session_id: 'session-startup-1',
      sequence: 1,
      emitted_at: '2026-10-27T10:00:00Z',
      event: 'session_started',
      root_display_name: 'my-app',
    });

    harness.emit({
      schema_version: 'spectate-1.1',
      session_id: 'session-startup-1',
      sequence: 2,
      emitted_at: '2026-10-27T10:00:01Z',
      event: 'initial_snapshot',
      root_display_name: 'my-app',
      files: [],
      structure: {
        files: [
          {
            id: 'file:src/main.py',
            path: 'src/main.py',
            module: 'src.main',
            content_sha256: 'sha-main',
            line_count: 10,
            is_test: false,
            is_test_heuristic: false,
            parse_error: null,
            removed: false,
            revision_side: 'head',
          },
        ],
        symbols: [
          {
            id: 'symbol:src/main.py:entry',
            path: 'src/main.py',
            qualified_name: 'entry',
            name: 'entry',
            kind: 'function',
            disambiguator: 1,
            parent_id: 'file:src/main.py',
            start_line: 2,
            end_line: 5,
            content_sha256: 'sha-entry',
            signature: '()',
            parameter_names: [],
            decorators: [],
            docstring: null,
            bases: [],
            removed: false,
            revision_side: 'head',
          },
        ],
        skips: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeDefined();
      expect(screen.getByRole('button', { name: /projects/i })).toBeDefined();
    });

    expect(screen.queryByText(/Select project/i)).toBeNull();
    expect(screen.getByTestId('spectate-hook')).toBeDefined();
  });

  it('keeps "back to selector" working from header and displays Return to workspace on startup screen', async () => {
    const harness = installBridge();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /select project/i }));
    await waitFor(() => expect(harness.bridge.startWatch).toHaveBeenCalledTimes(1));

    harness.emit({
      schema_version: 'spectate-1.1',
      session_id: 'session-startup-2',
      sequence: 1,
      emitted_at: '2026-10-27T10:00:00Z',
      event: 'session_started',
      root_display_name: 'my-app',
    });

    harness.emit({
      schema_version: 'spectate-1.1',
      session_id: 'session-startup-2',
      sequence: 2,
      emitted_at: '2026-10-27T10:00:01Z',
      event: 'initial_snapshot',
      root_display_name: 'my-app',
      files: [],
      structure: {
        files: [],
        symbols: [],
        skips: [],
      },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /projects/i })).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /projects/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'FaultMesh' })).toBeDefined();
      expect(screen.getByRole('button', { name: /select project/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /return to workspace/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /return to workspace/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /projects/i })).toBeDefined();
    });
  });

  it('reaches sample demo fixtures when explicit ?demo=1 URL parameter is set', async () => {
    window.history.replaceState({}, '', '?demo=1');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('auth-service (Sample Demo)')).toBeDefined();
      expect(screen.getByRole('button', { name: /load recorded sample run/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /watch agent repair/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /open project json/i })).toBeDefined();
    });
  });
});
