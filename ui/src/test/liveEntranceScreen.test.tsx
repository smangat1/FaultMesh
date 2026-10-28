import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { LiveEntranceScreen } from '../components/LiveEntranceScreen';
import { App } from '../App';
import type { SpectateBridge, SpectateEvent } from '../spectate/types';
import type { V3FileNode, V3SymbolNode } from '../import';

describe('Part 2: Live Workspace Entrance Screen', () => {
  describe('LiveEntranceScreen component', () => {
    it('renders the calm entrance screen with three large widget cards and live status', () => {
      const onSelectMode = vi.fn();
      const onBackToSelector = vi.fn();

      render(
        <LiveEntranceScreen
          projectName="playground"
          filesCount={5}
          nodesCount={8}
          changedFilesCount={1}
          lastSavedText="just now"
          liveStatus="live"
          onSelectMode={onSelectMode}
          onBackToSelector={onBackToSelector}
        />
      );

      // Verify Entrance Screen container
      expect(screen.getByTestId('live-entrance-screen')).toBeDefined();
      expect(screen.getByText('Project Workspace')).toBeDefined();
      expect(screen.getByText('LIVE: playground')).toBeDefined();

      // Card 1: Map
      const mapCard = screen.getByTestId('entrance-card-map');
      expect(mapCard).toBeDefined();
      expect(screen.getByText('5 Python files, 8 nodes')).toBeDefined();
      expect(screen.getByText(/Interactive structural map of your files and dependencies/i)).toBeDefined();

      // Card 2: Files
      const filesCard = screen.getByTestId('entrance-card-files');
      expect(filesCard).toBeDefined();
      expect(screen.getByText('5 Python files, last saved just now')).toBeDefined();
      expect(screen.getByText(/Explore project files, symbol counts/i)).toBeDefined();

      // Card 3: Changes
      const changesCard = screen.getByTestId('entrance-card-changes');
      expect(changesCard).toBeDefined();
      expect(screen.getByText('1 file changed on disk')).toBeDefined();
      expect(screen.getByText(/Review files modified on disk and inspect line-by-line diffs/i)).toBeDefined();

      // Test clicks
      fireEvent.click(mapCard);
      expect(onSelectMode).toHaveBeenCalledWith('map');

      fireEvent.click(filesCard);
      expect(onSelectMode).toHaveBeenCalledWith('files');

      fireEvent.click(changesCard);
      expect(onSelectMode).toHaveBeenCalledWith('changes');

      // Test return to selector
      const backBtn = screen.getByTestId('entrance-back-to-projects');
      fireEvent.click(backBtn);
      expect(onBackToSelector).toHaveBeenCalledTimes(1);
    });

    it('displays pluralized changed files count correctly when 0 or multiple', () => {
      const onSelectMode = vi.fn();

      const { rerender } = render(
        <LiveEntranceScreen
          projectName="test-repo"
          filesCount={3}
          nodesCount={6}
          changedFilesCount={0}
          lastSavedText="just now"
          onSelectMode={onSelectMode}
        />
      );

      expect(screen.getByText('0 files changed on disk')).toBeDefined();

      rerender(
        <LiveEntranceScreen
          projectName="test-repo"
          filesCount={3}
          nodesCount={6}
          changedFilesCount={2}
          lastSavedText="2m ago"
          onSelectMode={onSelectMode}
        />
      );

      expect(screen.getByText('2 files changed on disk')).toBeDefined();
      expect(screen.getByText('3 Python files, last saved 2m ago')).toBeDefined();
    });
  });

  describe('Full Application Navigation Flow with Live Watching', () => {
    const envelope = {
      schema_version: 'spectate-1.1' as const,
      session_id: 'sess-entrance-test',
      emitted_at: '2026-10-27T20:00:00Z',
    };

    const fileA: V3FileNode = {
      id: 'file:src/main.py',
      path: 'src/main.py',
      module: 'main',
      content_sha256: 'sha-a',
      line_count: 20,
      is_test: false,
    };
    const symA1: V3SymbolNode = {
      id: 'symbol:src/main.py:app',
      name: 'app',
      qualified_name: 'app',
      disambiguator: 0,
      parent_id: 'file:src/main.py',
      path: 'src/main.py',
      kind: 'function',
      start_line: 1,
      end_line: 10,
      content_sha256: 'sha-app',
      signature: '() -> None',
      revision_side: 'head',
    };
    const symA2: V3SymbolNode = {
      id: 'symbol:src/main.py:run',
      name: 'run',
      qualified_name: 'run',
      disambiguator: 0,
      parent_id: 'file:src/main.py',
      path: 'src/main.py',
      kind: 'function',
      start_line: 11,
      end_line: 20,
      content_sha256: 'sha-run',
      signature: '() -> None',
      revision_side: 'head',
    };

    it('lands on calm entrance screen when watching starts and supports back-to-modes navigation', async () => {
      const listeners = new Set<(event: SpectateEvent) => void>();
      const bridge: SpectateBridge = {
        chooseProjectFolder: vi.fn(),
        startWatch: vi.fn(),
        stopWatch: vi.fn(),
        onSpectateEvent: vi.fn((callback) => {
          listeners.add(callback);
          return () => { listeners.delete(callback); };
        }),
      };
      window.faultmeshSpectate = bridge;

      // Start on selector screen (normal real startup)
      render(<App initialScreen="selector" />);

      await waitFor(() => expect(bridge.onSpectateEvent).toHaveBeenCalled());
      const emit = (event: SpectateEvent) => act(() => {
        listeners.forEach((l) => l(event));
      });

      // 1. Session started & initial snapshot
      emit({
        ...envelope,
        sequence: 1,
        event: 'session_started',
        root_display_name: 'calm-repo',
      });
      emit({
        ...envelope,
        sequence: 2,
        event: 'initial_snapshot',
        files: [],
        structure: {
          files: [fileA],
          symbols: [symA1, symA2],
          skips: [],
        },
      });

      // 2. Confirms we land on the Entrance Screen, NOT a tab bar
      await waitFor(() => {
        expect(screen.getByTestId('live-entrance-screen')).toBeDefined();
      });
      expect(screen.getByText('LIVE: calm-repo')).toBeDefined();
      expect(screen.getByTestId('entrance-card-map')).toBeDefined();
      expect(screen.getByTestId('entrance-card-files')).toBeDefined();
      expect(screen.getByTestId('entrance-card-changes')).toBeDefined();

      // Verify live status cards on entrance screen
      expect(screen.getByText('1 Python file, 2 nodes')).toBeDefined();
      expect(screen.getByText('0 files changed on disk')).toBeDefined();

      // 3. Disk file change occurs while on entrance screen: live watching keeps running and updates cards
      emit({
        ...envelope,
        sequence: 3,
        event: 'file_changed',
        path: 'src/main.py',
        kind: 'modified',
        new_sha256: 'sha-a-v2',
        changed_line_ranges: [{ start_line: 5, end_line: 8 }],
        parse_ok: true,
        parse_error: null,
        affected_file_ids: ['file:src/main.py'],
        affected_symbol_ids: [symA1.id],
      });

      await waitFor(() => {
        expect(screen.getByText('1 file changed on disk')).toBeDefined();
      });

      // 4. Click Map card -> enters Map mode full screen
      fireEvent.click(screen.getByTestId('entrance-card-map'));

      // Clear "Back to modes" control is present in header
      await waitFor(() => {
        expect(screen.getByTestId('header-back-to-modes')).toBeDefined();
      });
      const backToModesBtn = screen.getByTestId('header-back-to-modes');
      expect(backToModesBtn).toBeDefined();

      // 5. Click "Modes" -> returns to Entrance Screen
      fireEvent.click(backToModesBtn);
      await waitFor(() => {
        expect(screen.getByTestId('live-entrance-screen')).toBeDefined();
      });

      // 6. Click Files card -> enters Files view
      fireEvent.click(screen.getByTestId('entrance-card-files'));
      await waitFor(() => {
        expect(screen.getByTestId('live-files-view')).toBeDefined();
      });

      // Return to Entrance Screen again
      fireEvent.click(screen.getByTestId('header-back-to-modes'));
      await waitFor(() => {
        expect(screen.getByTestId('live-entrance-screen')).toBeDefined();
      });

      // 7. Click Changes card -> enters Changes view
      fireEvent.click(screen.getByTestId('entrance-card-changes'));
      await waitFor(() => {
        expect(screen.getByTestId('live-changes-view')).toBeDefined();
      });

      // Return to Entrance Screen
      fireEvent.click(screen.getByTestId('header-back-to-modes'));
      await waitFor(() => {
        expect(screen.getByTestId('live-entrance-screen')).toBeDefined();
      });
    });
  });
});
