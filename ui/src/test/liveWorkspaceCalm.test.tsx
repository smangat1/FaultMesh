import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { GraphView } from '../components/GraphView';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { LiveFilesView } from '../components/LiveFilesView';
import { LiveChangesView } from '../components/LiveChangesView';
import { LiveToast } from '../components/LiveToast';
import { LiveMapDrawers } from '../components/LiveMapDrawers';
import type { V3FileNode, V3SymbolNode } from '../import';
import type { SpectateBridge, SpectateEvent } from '../spectate/types';
import type { GraphData, RunSummary } from '../types';

const envelope = {
  schema_version: 'spectate-1.1' as const,
  session_id: 'session-calm-live',
  emitted_at: '2026-10-27T12:00:00Z',
};

const file1: V3FileNode = {
  id: 'file:service.py',
  path: 'service.py',
  module: 'service',
  content_sha256: 'sha-service-1',
  line_count: 50,
  is_test: false,
  is_test_heuristic: false,
  parse_error: null,
  removed: false,
  revision_side: 'head',
};

const file2: V3FileNode = {
  id: 'file:tokens.py',
  path: 'tokens.py',
  module: 'tokens',
  content_sha256: 'sha-tokens-1',
  line_count: 80,
  is_test: false,
  is_test_heuristic: false,
  parse_error: null,
  removed: false,
  revision_side: 'head',
};

const file3: V3FileNode = {
  id: 'file:utils.py',
  path: 'utils.py',
  module: 'utils',
  content_sha256: 'sha-utils-1',
  line_count: 30,
  is_test: false,
  is_test_heuristic: false,
  parse_error: null,
  removed: false,
  revision_side: 'head',
};

const symService: V3SymbolNode = {
  id: 'symbol:service.py:login',
  path: 'service.py',
  qualified_name: 'login',
  name: 'login',
  kind: 'function',
  disambiguator: 1,
  parent_id: 'file:service.py',
  start_line: 10,
  end_line: 25,
  content_sha256: 'sha-login',
  signature: '(user, pass)',
  parameter_names: ['user', 'pass'],
  decorators: [],
  docstring: null,
  bases: [],
  removed: false,
  revision_side: 'head',
};

const symToken: V3SymbolNode = {
  id: 'symbol:tokens.py:validate',
  path: 'tokens.py',
  qualified_name: 'validate',
  name: 'validate',
  kind: 'function',
  disambiguator: 1,
  parent_id: 'file:tokens.py',
  start_line: 5,
  end_line: 15,
  content_sha256: 'sha-validate',
  signature: '(token)',
  parameter_names: ['token'],
  decorators: [],
  docstring: null,
  bases: [],
  removed: false,
  revision_side: 'head',
};

const sampleLiveGraph: GraphData = {
  files: [
    { file: 'service.py', name: 'service.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 50 },
    { file: 'tokens.py', name: 'tokens.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 80 },
    { file: 'utils.py', name: 'utils.py', symbolCount: 0, changeStatus: 'unchanged', lineCount: 30 },
  ],
  nodes: [
    {
      id: symService.id,
      name: 'login',
      file: 'service.py',
      parentModule: 'service',
      kind: 'function',
      changeStatus: 'unchanged',
      lineStart: 10,
      lineEnd: 25,
    },
    {
      id: symToken.id,
      name: 'validate',
      file: 'tokens.py',
      parentModule: 'tokens',
      kind: 'function',
      changeStatus: 'unchanged',
      lineStart: 5,
      lineEnd: 15,
    },
  ],
  edges: [
    {
      id: 'edge:service-to-token',
      source: symService.id,
      target: symToken.id,
      category: 'static_call',
      provenance: 'static_ast',
    },
  ],
  unresolvedReferences: [],
  parseErrors: [],
};

const sampleLiveRun: RunSummary = {
  id: 'v3-structure-live',
  project: 'my-project',
  gitRevision: 'current',
  gitBranch: 'watched',
  commitMessage: 'Live structure',
  startedAt: '2026-10-27T12:00:00Z',
  isFixture: false,
  fixtureLabel: 'Live: my-project',
  status: 'running',
  isLive: true,
  liveStatus: 'live',
  stats: { totalTests: 0, passed: 0, failed: 0, errored: 0, skipped: 0, totalNodes: 2, modifiedNodes: 0 },
  limitations: [],
  durationMs: 0,
};

afterEach(() => {
  delete window.faultmeshSpectate;
  window.history.replaceState({}, '', '/');
});

describe('Live-Watch Calm Workspace (Parts A, B, C, D)', () => {
  describe('Part A & B: Live-Watch Fixes and Decluttering', () => {
    it('declutters the Header in live watch: shows minimum controls, view switcher, and hides demo-era controls', () => {
      const onSelectView = vi.fn();
      render(
        <Header
          activeRun={sampleLiveRun}
          activeView="map"
          onSelectView={onSelectView}
          onBackToSelector={vi.fn()}
        />
      );

      // 1. Shows project name + live status badge + way back to projects
      expect(screen.getByText('my-project')).toBeDefined();
      expect(screen.getByText('LIVE: my-project')).toBeDefined();
      expect(screen.getByRole('button', { name: /projects/i })).toBeDefined();

      // 2. Shows the 3-view switcher (Map, Files, Changes)
      expect(screen.getByRole('button', { name: 'Map view' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Files view' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Changes view' })).toBeDefined();

      // 3. Demo-era and import controls must NOT appear in live watch
      expect(screen.queryByText(/Run Diagnostics/i)).toBeNull();
      expect(screen.queryByText(/Open JSON/i)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /switch active test run/i })).toBeNull();
      expect(screen.queryByText('STRUCTURE ONLY')).toBeNull();
      expect(screen.queryByText('ALL PASSED')).toBeNull();
    });

    it('declutters the Sidebar in live watch: does not render empty Tests or Pinned Shortlist sections', () => {
      render(
        <Sidebar
          tests={[]}
          selectedTestId={null}
          onSelectTest={vi.fn()}
          files={sampleLiveGraph.files}
          nodes={sampleLiveGraph.nodes}
          pinnedSymbols={[]}
          isLive={true}
        />
      );

      // Neither "Tests" nor "Pinned Shortlist" should render when empty in live watch
      expect(screen.queryByText(/Tests \(/i)).toBeNull();
      expect(screen.queryByText(/Pinned Shortlist \(/i)).toBeNull();
      expect(screen.queryByText(/No pinned symbols/i)).toBeNull();

      // Project files list is rendered cleanly
      expect(screen.getByText(/Files \(3\)/i)).toBeDefined();
      expect(screen.getByText('service.py')).toBeDefined();
      expect(screen.getByText('tokens.py')).toBeDefined();
    });

    it('declutters Map edges in live watch: stops drawing links when no node is selected or changed', () => {
      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={sampleLiveGraph}
            tests={[]}
            datasetKey="live:calm-edges-1"
            selectedTestId={null}
            selectedNodeId={null}
            highlightedNodeIds={[]}
            isLive={true}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      // When isLive is true and no node is selected or changed:
      // All inter-node links should be excluded (only containment edges exist)
      const nonContainmentEdges = cy.edges('[category != "containment"]');
      expect(nonContainmentEdges.length).toBe(0);

      // "Agent Auto-Repair (Demo only)" must not appear in live watch
      expect(screen.queryByText('Agent Auto-Repair (Demo only)')).toBeNull();
      expect(screen.queryByRole('button', { name: /agent auto-repair/i })).toBeNull();
    });

    it('draws links for the selected node and its immediate neighbors in live watch', () => {
      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={sampleLiveGraph}
            tests={[]}
            datasetKey="live:calm-edges-2"
            selectedTestId={null}
            selectedNodeId={symService.id} // symService is selected
            highlightedNodeIds={[]}
            isLive={true}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      // With symService selected, the edge connecting it to symToken is rendered
      const edges = cy.edges('[id = "edge:service-to-token"]');
      expect(edges.length).toBe(1);
    });

    it('fixes opening camera to fit whole graph with comfortable padding and readable semantic zoom level (mid)', () => {
      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={sampleLiveGraph}
            tests={[]}
            datasetKey="live:opening-camera"
            selectedTestId={null}
            selectedNodeId={null}
            highlightedNodeIds={[]}
            isLive={true}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      // Camera must establish a readable zoom level (mid zoom >= 0.85)
      expect(cy.zoom()).toBeGreaterThanOrEqual(0.85);
      expect(screen.getByText(/mid/i)).toBeDefined();
    });
  });

  describe('Part C: Three-View Live Workspace', () => {
    it('renders the Files view with recency-sorted files and recency coloring', () => {
      const now = Date.now();
      const mockHistory = [
        {
          path: 'tokens.py',
          kind: 'modified' as const,
          updatedAt: new Date(now - 15000).toISOString(),
          timestamp: now - 15000, // 15 seconds ago (strong highlight)
          sha256: 'sha-tokens-new',
          ranges: [{ start_line: 5, end_line: 12 }],
          parseError: null,
        },
        {
          path: 'service.py',
          kind: 'modified' as const,
          updatedAt: new Date(now - 120000).toISOString(),
          timestamp: now - 120000, // 2 minutes ago (medium highlight)
          sha256: 'sha-service-new',
          ranges: [],
          parseError: null,
        },
      ];

      render(
        <LiveFilesView
          files={[file1, file2, file3]}
          fileHistory={mockHistory}
          liveStatus="live"
          projectName="my-project"
          onOpenMap={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      );

      // Header shows file count and session save count
      expect(screen.getByText(/my-project · Watched Files/i)).toBeDefined();
      expect(screen.getByText('(3 files)')).toBeDefined();
      expect(screen.getByText('2 saved this session')).toBeDefined();

      // Recent files (tokens.py then service.py) appear at the top
      const fileElements = screen.getAllByText(/\.py/);
      expect(fileElements[0].textContent).toBe('tokens.py');
      expect(fileElements[1].textContent).toBe('service.py');
      expect(fileElements[2].textContent).toBe('utils.py'); // unchanged file comes last
    });

    it('renders the Changes view with DiffViewer and gracefully handles empty state', () => {
      // Empty state
      const { rerender } = render(
        <LiveChangesView
          fileHistory={[]}
          liveStatus="live"
        />
      );
      expect(screen.getByText('No file changes observed yet')).toBeDefined();

      // With changed files
      const now = Date.now();
      const historyWithDiff = [
        {
          path: 'tokens.py',
          kind: 'modified' as const,
          updatedAt: new Date(now).toISOString(),
          timestamp: now,
          sha256: 'sha-2',
          ranges: [],
          parseError: null,
          diff: '@@ -5,2 +5,2 @@\n-def validate(token):\n+def validate(token, strict=True):',
          source: 'def validate(token, strict=True):\n    return True\n',
        },
      ];

      rerender(
        <LiveChangesView
          fileHistory={historyWithDiff}
          liveStatus="live"
        />
      );

      expect(screen.getByText('Observed Changes')).toBeDefined();
      expect(screen.getByText('(1 file changed on disk)')).toBeDefined();
      expect(screen.getByText(/\+def validate\(token, strict=True\):/)).toBeDefined();
    });

    it('handles watcher-stopped state gracefully in Files and Changes views', () => {
      render(
        <LiveFilesView
          files={[file1]}
          fileHistory={[]}
          liveStatus="stopped"
          stopReason="stopped_by_user"
        />
      );
      expect(screen.getByText(/Watcher stopped \(stopped_by_user\) · displaying last known project files/i)).toBeDefined();

      render(
        <LiveChangesView
          fileHistory={[]}
          liveStatus="stopped"
          stopReason="stopped_by_user"
        />
      );
      expect(screen.getByText(/Watcher stopped \(stopped_by_user\) · displaying last known changes/i)).toBeDefined();
    });
  });

  describe('Part D: Map-View Notifications and Drawers', () => {
    it('renders a quiet, auto-dismissing toast over the map view with honest phrasing', () => {
      const onDismiss = vi.fn();
      render(
        <LiveToast
          message="tokens.py changed on disk"
          onDismiss={onDismiss}
        />
      );

      expect(screen.getByText('tokens.py changed on disk')).toBeDefined();
      const closeBtn = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('unfolds and collapses the Files drawer and Diff drawer over the Map view', () => {
      const onSelectFile = vi.fn();
      const onClose = vi.fn();

      const { rerender } = render(
        <LiveMapDrawers
          activeDrawer="files"
          onClose={onClose}
          files={[file1, file2]}
          fileHistory={[]}
          selectedFile={null}
          onSelectFile={onSelectFile}
        />
      );

      expect(screen.getByText(/watched files/i)).toBeDefined();
      expect(screen.getByText('service.py')).toBeDefined();

      // Clicking a file calls onSelectFile
      fireEvent.click(screen.getByText('service.py'));
      expect(onSelectFile).toHaveBeenCalledWith('service.py');

      // Clicking collapse calls onClose
      fireEvent.click(screen.getByRole('button', { name: /collapse drawer/i }));
      expect(onClose).toHaveBeenCalled();

      // Render Diff drawer
      rerender(
        <LiveMapDrawers
          activeDrawer="diff"
          onClose={onClose}
          files={[file1, file2]}
          fileHistory={[
            {
              path: 'service.py',
              kind: 'modified',
              updatedAt: new Date().toISOString(),
              timestamp: Date.now(),
              sha256: 'sha-s',
              ranges: [],
              parseError: null,
              diff: '@@ -1 +1 @@\n-def login():\n+def login(user):',
            },
          ]}
          selectedFile="service.py"
          onSelectFile={onSelectFile}
        />
      );

      expect(screen.getByText(/diff \/ source/i)).toBeDefined();
      expect(screen.getByText(/\+def login\(user\):/)).toBeDefined();
    });
  });

  describe('Full Application Live Watch Flow', () => {
    it('transitions from startup to live workspace with 3-view switcher, quiet toasts, and drawers', async () => {
      let listener: ((event: SpectateEvent) => void) | null = null;
      const bridge: SpectateBridge = {
        chooseProjectFolder: vi.fn(),
        startWatch: vi.fn(),
        stopWatch: vi.fn(),
        onSpectateEvent: vi.fn((callback) => {
          listener = callback;
          return () => { listener = null; };
        }),
      };
      window.faultmeshSpectate = bridge;

      render(<App initialScreen="workspace" />);
      await waitFor(() => expect(bridge.onSpectateEvent).toHaveBeenCalled());

      const emit = (event: SpectateEvent) => act(() => listener?.(event));

      // 1. Session started & initial snapshot
      emit({
        ...envelope,
        sequence: 1,
        event: 'session_started',
        root_display_name: 'watched-repo',
      });
      emit({
        ...envelope,
        sequence: 2,
        event: 'initial_snapshot',
        files: [],
        structure: {
          files: [file1, file2],
          symbols: [symService, symToken],
          skips: [],
        },
      });

      await waitFor(() => {
        expect(screen.getByText('LIVE: watched-repo')).toBeDefined();
      });

      // 2. View switcher is present in the live workspace header
      const mapBtn = screen.getByRole('button', { name: 'Map view' });
      const filesBtn = screen.getByRole('button', { name: 'Files view' });
      const changesBtn = screen.getByRole('button', { name: 'Changes view' });
      expect(mapBtn).toBeDefined();
      expect(filesBtn).toBeDefined();
      expect(changesBtn).toBeDefined();

      // 3. Switch to Files view
      fireEvent.click(filesBtn);
      await waitFor(() => {
        expect(screen.getByTestId('live-files-view')).toBeDefined();
      });

      // 4. Switch to Changes view
      fireEvent.click(changesBtn);
      await waitFor(() => {
        expect(screen.getByTestId('live-changes-view')).toBeDefined();
      });

      // 5. Switch back to Map view
      fireEvent.click(mapBtn);

      // 6. Emit a file_changed event: triggers quiet toast
      emit({
        ...envelope,
        sequence: 3,
        event: 'file_changed',
        path: 'tokens.py',
        kind: 'modified',
        new_sha256: 'sha-tokens-v2',
        changed_line_ranges: [{ start_line: 5, end_line: 10 }],
        affected_file_ids: ['file:tokens.py'],
        affected_symbol_ids: [symToken.id],
      });

      await waitFor(() => {
        expect(screen.getByText('tokens.py changed on disk')).toBeDefined();
      });

      // 7. Toggle unfoldable Map drawer for files
      const toggleFilesDrawerBtn = screen.getByRole('button', { name: /toggle files drawer/i });
      fireEvent.click(toggleFilesDrawerBtn);

      await waitFor(() => {
        expect(screen.getByTestId('live-map-drawer')).toBeDefined();
        expect(screen.getByText(/watched files/i)).toBeDefined();
      });

      // 8. Close drawer
      const closeDrawerBtn = screen.getByRole('button', { name: /collapse drawer/i });
      fireEvent.click(closeDrawerBtn);
      await waitFor(() => {
        expect(screen.queryByTestId('live-map-drawer')).toBeNull();
      });
    });
  });
});
