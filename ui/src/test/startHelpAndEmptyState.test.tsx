import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StartupScreen } from '../components/StartupScreen';
import { LiveEntranceScreen } from '../components/LiveEntranceScreen';
import { LiveFilesView } from '../components/LiveFilesView';
import { LiveChangesView } from '../components/LiveChangesView';
import { GraphView } from '../components/GraphView';
import type { GraphData } from '../types';

describe('Part 3: Make the Start Easy to Understand', () => {
  describe('StartupScreen plain wording and 3-step example path', () => {
    it('plainly states that FaultMesh works with Python projects only', () => {
      render(
        <StartupScreen
          onSelectProject={vi.fn()}
          hasBridge={true}
        />
      );

      expect(
        screen.getByText('FaultMesh works with Python projects only (it reads your .py files).')
      ).toBeDefined();
    });

    it('displays the 3-step try-an-example card with exact copy command', () => {
      // Mock navigator.clipboard
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(
        <StartupScreen
          onSelectProject={vi.fn()}
          hasBridge={true}
        />
      );

      const exampleCard = screen.getByTestId('startup-example-card');
      expect(exampleCard).toBeDefined();
      expect(screen.getByText('No project yet? Try the included example')).toBeDefined();
      expect(
        screen.getByText('cp -r examples/vscode_playground ~/Desktop/faultmesh-playground')
      ).toBeDefined();

      // Click copy button
      const copyButton = screen.getByLabelText('Copy command');
      fireEvent.click(copyButton);
      expect(writeTextMock).toHaveBeenCalledWith(
        'cp -r examples/vscode_playground ~/Desktop/faultmesh-playground'
      );
    });
  });

  describe('LiveEntranceScreen honest snapshot handling', () => {
    it('displays honest Watching N Python files when files exist', () => {
      render(
        <LiveEntranceScreen
          projectName="my-python-app"
          filesCount={12}
          nodesCount={45}
          changedFilesCount={0}
          onSelectMode={vi.fn()}
        />
      );

      expect(
        screen.getByText('Watching 12 Python files (saved changes update live)')
      ).toBeDefined();
      expect(screen.getByText('12 Python files, 45 nodes')).toBeDefined();
    });

    it('displays honest error banner and Pick another folder button when 0 Python files found', () => {
      const onSelectAnotherProject = vi.fn();
      const onBackToSelector = vi.fn();

      render(
        <LiveEntranceScreen
          projectName="empty-folder"
          filesCount={0}
          nodesCount={0}
          changedFilesCount={0}
          onSelectMode={vi.fn()}
          onBackToSelector={onBackToSelector}
          onSelectAnotherProject={onSelectAnotherProject}
        />
      );

      // Verify header status reflects 0 files
      expect(screen.getByText('0 Python files found')).toBeDefined();

      // Verify banner
      const banner = screen.getByTestId('no-python-files-banner');
      expect(banner).toBeDefined();
      expect(
        screen.getByText('No Python files found in this folder. Pick the folder that contains your .py code.')
      ).toBeDefined();

      // Click "Pick another folder"
      const pickBtn = screen.getByTestId('entrance-pick-another-folder');
      fireEvent.click(pickBtn);
      expect(onSelectAnotherProject).toHaveBeenCalledTimes(1);

      // Click "Return to Start"
      const backBtn = screen.getByLabelText('Return to Start');
      fireEvent.click(backBtn);
      expect(onBackToSelector).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mode 1-line first-run guide text and empty states', () => {
    it('renders first-run help banner in Files mode and handles 0 files', () => {
      const { rerender } = render(
        <LiveFilesView
          files={[]}
          fileHistory={[]}
          liveStatus="live"
        />
      );

      // 1-line guide text
      expect(screen.getByTestId('files-help-banner')).toBeDefined();
      expect(
        screen.getByText(
          /Files shows all Python files in this folder and their save recency\. Click a file to view symbols/i
        )
      ).toBeDefined();

      // Empty state notice
      const emptyState = screen.getByTestId('files-empty-state');
      expect(emptyState).toBeDefined();
      expect(screen.getByText('No Python files found in this folder')).toBeDefined();

      // When files are present, empty state disappears
      rerender(
        <LiveFilesView
          files={[{ id: 'file:main.py', path: 'main.py', line_count: 50, symbol_count: 3 } as any]}
          fileHistory={[]}
          liveStatus="live"
        />
      );
      expect(screen.queryByTestId('files-empty-state')).toBeNull();
    });

    it('renders first-run help banner in Changes mode', () => {
      render(
        <LiveChangesView
          fileHistory={[]}
          liveStatus="live"
        />
      );

      // 1-line guide text
      expect(screen.getByTestId('changes-help-banner')).toBeDefined();
      expect(
        screen.getByText(
          /Changes lists files modified on disk during this session and their line diffs/i
        )
      ).toBeDefined();
    });

    it('renders first-run help banner and 0 files notice in Map mode', () => {
      const emptyGraph: GraphData = {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        parseErrors: [],
        files: [],
      };

      const { rerender } = render(
        <GraphView
          graphData={emptyGraph}
          tests={[]}
          highlightedNodeIds={[]}
          datasetKey="test-key"
          selectedTestId={null}
          onSelectTest={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          selectedFile={null}
          onSelectFile={vi.fn()}
          pinnedSymbolIds={[]}
          collapsedFiles={new Set()}
          onToggleCollapseFile={vi.fn()}
          onCollapseAllFiles={vi.fn()}
          onExpandAllFiles={vi.fn()}
          viewMode="structure"
          onSelectViewMode={vi.fn()}
          isLive={true}
        />
      );

      // Empty state notice when 0 files
      expect(screen.getByTestId('map-empty-state')).toBeDefined();
      expect(
        screen.getByText('No Python files found in this folder. Pick the folder that contains your .py code.')
      ).toBeDefined();

      // When files are present, empty state notice disappears and 1-line guide banner is rendered
      const populatedGraph: GraphData = {
        ...emptyGraph,
        files: [
          {
            file: 'main.py',
            name: 'main.py',
            symbolCount: 1,
            changeStatus: 'unchanged',
            lineCount: 20,
          },
        ],
        nodes: [
          {
            id: 'sym:1',
            name: 'main',
            file: 'main.py',
            parentModule: 'main',
            kind: 'function',
            changeStatus: 'unchanged',
            lineStart: 1,
            lineEnd: 10,
          },
        ],
      };

      rerender(
        <GraphView
          graphData={populatedGraph}
          tests={[]}
          highlightedNodeIds={[]}
          datasetKey="test-key-2"
          selectedTestId={null}
          onSelectTest={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          selectedFile={null}
          onSelectFile={vi.fn()}
          pinnedSymbolIds={[]}
          collapsedFiles={new Set()}
          onToggleCollapseFile={vi.fn()}
          onCollapseAllFiles={vi.fn()}
          onExpandAllFiles={vi.fn()}
          viewMode="structure"
          onSelectViewMode={vi.fn()}
          isLive={true}
        />
      );

      expect(screen.queryByTestId('map-empty-state')).toBeNull();
      expect(screen.getByTestId('map-help-banner')).toBeDefined();
      expect(
        screen.getByText(
          /Map shows your Python files and static call links\. Click any file or function to trace connections/i
        )
      ).toBeDefined();
    });
  });
});
