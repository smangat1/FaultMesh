import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { reduceLiveSpectate, EMPTY_LIVE_SPECTATE_STATE, LiveSpectateAdapter } from '../spectate/liveState';
import type { SpectateEvent } from '../spectate/types';
import { GraphView } from '../components/GraphView';
import { LiveFilesView } from '../components/LiveFilesView';

function createLayoutASpectateEvents(): SpectateEvent[] {
  return [
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-a',
      sequence: 1,
      emitted_at: '2026-10-28T00:00:00Z',
      event: 'session_started',
      root_display_name: 'layout_a',
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-a',
      sequence: 2,
      emitted_at: '2026-10-28T00:00:01Z',
      event: 'initial_snapshot',
      files: [
        { id: 'file:a.py', path: 'a.py', content_sha256: 'sha-a', line_count: 5, parse_ok: true, parse_error: null },
        { id: 'file:b.py', path: 'b.py', content_sha256: 'sha-b', line_count: 8, parse_ok: true, parse_error: null },
        { id: 'file:sub/c.py', path: 'sub/c.py', content_sha256: 'sha-c', line_count: 12, parse_ok: true, parse_error: null },
        { id: 'file:sub/d.py', path: 'sub/d.py', content_sha256: 'sha-d', line_count: 6, parse_ok: true, parse_error: null },
      ],
      structure: {
        files: [
          { id: 'file:a.py', path: 'a.py', module: 'a', content_sha256: 'sha-a', line_count: 5, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:b.py', path: 'b.py', module: 'b', content_sha256: 'sha-b', line_count: 8, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:sub/c.py', path: 'sub/c.py', module: 'sub.c', content_sha256: 'sha-c', line_count: 12, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:sub/d.py', path: 'sub/d.py', module: 'sub.d', content_sha256: 'sha-d', line_count: 6, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
        ],
        symbols: [
          { id: 'symbol:a.py:a_func', path: 'a.py', qualified_name: 'a_func', name: 'a_func', kind: 'function', disambiguator: 1, parent_id: 'file:a.py', start_line: 1, end_line: 5, content_sha256: 's-a', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:b.py:b_func', path: 'b.py', qualified_name: 'b_func', name: 'b_func', kind: 'function', disambiguator: 1, parent_id: 'file:b.py', start_line: 1, end_line: 8, content_sha256: 's-b', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:sub/c.py:c_func', path: 'sub/c.py', qualified_name: 'c_func', name: 'c_func', kind: 'function', disambiguator: 1, parent_id: 'file:sub/c.py', start_line: 1, end_line: 12, content_sha256: 's-c', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:sub/d.py:d_func', path: 'sub/d.py', qualified_name: 'd_func', name: 'd_func', kind: 'function', disambiguator: 1, parent_id: 'file:sub/d.py', start_line: 1, end_line: 6, content_sha256: 's-d', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
        ],
        skips: [],
      },
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-a',
      sequence: 3,
      emitted_at: '2026-10-28T00:00:02Z',
      event: 'relationship_update',
      edges: [
        { id: 'edge:b-call-a', layer: 'static', kind: 'possible_call', source_id: 'symbol:b.py:b_func', target_id: 'symbol:a.py:a_func', callsite_path: 'b.py', callsite_line: 2, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
        { id: 'edge:c-call-d', layer: 'static', kind: 'possible_call', source_id: 'symbol:sub/c.py:c_func', target_id: 'symbol:sub/d.py:d_func', callsite_path: 'sub/c.py', callsite_line: 2, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
        { id: 'edge:c-call-a-cross', layer: 'static', kind: 'possible_call', source_id: 'symbol:sub/c.py:c_func', target_id: 'symbol:a.py:a_func', callsite_path: 'sub/c.py', callsite_line: 3, resolution_reason: 'cross_folder_call', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
      ],
      unresolved: [],
      external_modules: [],
      stale_paths: [],
      complete: true,
      partial_reasons: [],
    },
  ];
}

describe('Layout A: Root files + subfolder files with cross-folder links', () => {
  it('renders root files and subfolder files in map nodes, files list, and allows selecting cross-folder link', async () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createLayoutASpectateEvents()) {
      state = reduceLiveSpectate(state, evt);
    }

    const adapter = new LiveSpectateAdapter(state);
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);

    // 1. Files View verification
    const { unmount } = render(
      <div style={{ width: 1024, height: 768 }}>
        <LiveFilesView
          files={state.files}
          fileHistory={state.fileHistory}
          liveStatus={state.status}
          projectName="layout_a"
        />
      </div>
    );

    // Status line reports total Python files across folders
    expect(screen.getByText('Watching 4 Python files in 2 folders')).toBeDefined();

    // Folder groups appear (root and sub/)
    expect(screen.getByText('root')).toBeDefined();
    expect(screen.getByText('sub/')).toBeDefined();

    // All file paths are shown as full relative paths, NEVER truncated to basenames
    expect(screen.getByText('a.py')).toBeDefined();
    expect(screen.getByText('b.py')).toBeDefined();
    expect(screen.getByText('sub/c.py')).toBeDefined();
    expect(screen.getByText('sub/d.py')).toBeDefined();

    // Verify collapsible folder toggle
    const subFolderHeader = screen.getByRole('button', { name: /Toggle folder sub\//i });
    expect(subFolderHeader.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(subFolderHeader);
    expect(subFolderHeader.getAttribute('aria-expanded')).toBe('false');

    unmount();

    // 2. Map View verification with selected cross-folder node
    let capturedCy: any = null;
    render(
      <div style={{ width: 1024, height: 768 }}>
        <GraphView
          graphData={graph}
          tests={[]}
          selectedTestId={null}
          onCyReady={(cy) => { capturedCy = cy; }}
          isLive={true}
          collapsedFiles={new Set()}
          selectedNodeId="symbol:sub/c.py:c_func"
        />
      </div>
    );

    await waitFor(() => expect(capturedCy).not.toBeNull());

    // Both root files and subfolder files exist as Cytoscape nodes
    expect(capturedCy.getElementById('file:a.py').length).toBe(1);
    expect(capturedCy.getElementById('file:b.py').length).toBe(1);
    expect(capturedCy.getElementById('file:sub/c.py').length).toBe(1);
    expect(capturedCy.getElementById('file:sub/d.py').length).toBe(1);

    // Child symbols exist
    expect(capturedCy.getElementById('symbol:a.py:a_func').length).toBe(1);
    expect(capturedCy.getElementById('symbol:sub/c.py:c_func').length).toBe(1);

    // Cross-folder edge from sub/c.py:c_func to a.py:a_func renders
    const crossEdge = capturedCy.getElementById('edge:c-call-a-cross');
    expect(crossEdge.length).toBe(1);
    expect(crossEdge.data('source')).toBe('symbol:sub/c.py:c_func');
    expect(crossEdge.data('target')).toBe('symbol:a.py:a_func');

    // Cross-folder edge is selectable
    expect(crossEdge.selectable()).toBe(true);
    crossEdge.select();
    expect(crossEdge.selected()).toBe(true);
  });
});
