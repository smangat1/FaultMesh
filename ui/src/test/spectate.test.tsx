import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpectateHook } from '../components/SpectateHook';
import type { SpectateBridge, SpectateEvent } from '../spectate/types';

const base = {
  schema_version: 'spectate-1.1' as const,
  session_id: 'session-test',
  emitted_at: '2026-10-26T20:00:00Z',
};

function installBridge() {
  let callback: ((event: SpectateEvent) => void) | null = null;
  const bridge: SpectateBridge = {
    chooseProjectFolder: vi.fn().mockResolvedValue({ handle: 'opaque', displayName: 'demo' }),
    startWatch: vi.fn().mockResolvedValue({ watching: true, displayName: 'demo' }),
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

afterEach(() => {
  delete window.faultmeshSpectate;
});

describe('SpectateHook', () => {
  it('requires explicit folder choice and keeps a persistent truthful status', async () => {
    const harness = installBridge();
    render(<SpectateHook />);

    fireEvent.click(screen.getByRole('button', { name: /Watch project/i }));
    await waitFor(() => expect(screen.getByText(/Watching \(no tests rerun\).*demo/i)).toBeDefined());
    expect(harness.bridge.chooseProjectFolder).toHaveBeenCalledTimes(1);
    expect(harness.bridge.startWatch).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole('button', { name: /Stop/i }));
    await waitFor(() => expect(harness.bridge.stopWatch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Live spectate is off')).toBeDefined();
  });

  it('offers one debounced banner and shows exact source, diff, errors, and IDs', async () => {
    const harness = installBridge();
    render(<SpectateHook />);
    fireEvent.click(screen.getByRole('button', { name: /Watch project/i }));
    await screen.findByText(/Watching \(no tests rerun\)/i);

    harness.emit({
      ...base,
      sequence: 1,
      event: 'session_started',
      root_display_name: 'demo',
    });

    harness.emit({
      ...base,
      sequence: 2,
      event: 'file_changed',
      path: 'src/demo.py',
      kind: 'modified',
      new_sha256: '1234567890abcdef',
      changed_line_ranges: [{ start_line: 2, end_line: 2 }],
      affected_file_ids: ['file:src/demo.py'],
      affected_symbol_ids: ['symbol:src/demo.py:value'],
      parse_ok: true,
      parse_error: null,
    });
    harness.emit({
      ...base,
      sequence: 3,
      event: 'source',
      path: 'src/demo.py',
      sha256: '1234567890abcdef',
      text: 'def value():\n    return 2\n',
      complete: true,
      skipped_reason: null,
    });
    harness.emit({
      ...base,
      sequence: 4,
      event: 'diff',
      path: 'src/demo.py',
      text: '@@ -2 +2 @@\n-    return 1\n+    return 2',
      truncated: false,
      skipped_reason: null,
    });

    await waitFor(() => expect(screen.getByText(/Code changing in/i)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Spectate/i }));
    expect(screen.getByText('src/demo.py')).toBeDefined();
    expect(screen.getByText('Live source')).toBeDefined();
    expect(screen.getByText('Current stable source')).toBeDefined();
    expect(screen.getByText('Diff vs previous stable snapshot')).toBeDefined();
    expect(screen.getByText(/def value/)).toBeDefined();
    expect(screen.getByText(/return 1/)).toBeDefined();
    expect(screen.getByText('symbol:src/demo.py:value')).toBeDefined();
    expect(screen.getByText(/highlighted on the watched project's live map/i)).toBeDefined();

    harness.emit({
      ...base,
      sequence: 5,
      event: 'structure_update',
      path: 'src/demo.py',
      changed_node_ids: ['file:src/demo.py'],
      parse_ok: false,
      parse_error: 'invalid syntax at line 1',
    });
    expect(screen.getByRole('alert').textContent).toContain('Structure from last good parse (stale)');
  });

  it('remembers not now for one file during the session', async () => {
    const harness = installBridge();
    render(<SpectateHook />);
    const change: SpectateEvent = {
      ...base,
      sequence: 2,
      event: 'file_changed',
      path: 'src/quiet.py',
      kind: 'modified',
      changed_line_ranges: [],
      affected_file_ids: [],
      affected_symbol_ids: [],
      parse_ok: true,
    };
    harness.emit(change);
    await waitFor(() => expect(screen.getByText(/Code changing in/i)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Not now/i }));
    expect(screen.queryByText(/Code changing in/i)).toBeNull();
    harness.emit({ ...change, sequence: 3 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(screen.queryByText(/Code changing in/i)).toBeNull();
  });
});
