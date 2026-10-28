import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { reduceLiveSpectate, EMPTY_LIVE_SPECTATE_STATE, LiveSpectateAdapter } from '../spectate/liveState';
import type { SpectateEvent } from '../spectate/types';
import { GraphView } from '../components/GraphView';
import { LiveFilesView } from '../components/LiveFilesView';

function createLayoutBSpectateEvents(): SpectateEvent[] {
  return [
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-b',
      sequence: 1,
      emitted_at: '2026-10-28T00:00:00Z',
      event: 'session_started',
      root_display_name: 'layout_b',
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-b',
      sequence: 2,
      emitted_at: '2026-10-28T00:00:01Z',
      event: 'initial_snapshot',
      files: [
        { id: 'file:outer/a.py', path: 'outer/a.py', content_sha256: 'sha-oa', line_count: 10, parse_ok: true, parse_error: null },
        { id: 'file:outer/inner/b.py', path: 'outer/inner/b.py', content_sha256: 'sha-oib', line_count: 20, parse_ok: true, parse_error: null },
        { id: 'file:outer/inner/deep/c.py', path: 'outer/inner/deep/c.py', content_sha256: 'sha-oidc', line_count: 30, parse_ok: true, parse_error: null },
      ],
      structure: {
        files: [
          { id: 'file:outer/a.py', path: 'outer/a.py', module: 'outer.a', content_sha256: 'sha-oa', line_count: 10, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:outer/inner/b.py', path: 'outer/inner/b.py', module: 'outer.inner.b', content_sha256: 'sha-oib', line_count: 20, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:outer/inner/deep/c.py', path: 'outer/inner/deep/c.py', module: 'outer.inner.deep.c', content_sha256: 'sha-oidc', line_count: 30, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
        ],
        symbols: [
          { id: 'symbol:outer/a.py:outer_a', path: 'outer/a.py', qualified_name: 'outer_a', name: 'outer_a', kind: 'function', disambiguator: 1, parent_id: 'file:outer/a.py', start_line: 1, end_line: 10, content_sha256: 's-oa', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:outer/inner/b.py:inner_b', path: 'outer/inner/b.py', qualified_name: 'inner_b', name: 'inner_b', kind: 'function', disambiguator: 1, parent_id: 'file:outer/inner/b.py', start_line: 1, end_line: 20, content_sha256: 's-oib', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:outer/inner/deep/c.py:deep_c', path: 'outer/inner/deep/c.py', qualified_name: 'deep_c', name: 'deep_c', kind: 'function', disambiguator: 1, parent_id: 'file:outer/inner/deep/c.py', start_line: 1, end_line: 30, content_sha256: 's-oidc', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
        ],
        skips: [],
      },
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-b',
      sequence: 3,
      emitted_at: '2026-10-28T00:00:02Z',
      event: 'relationship_update',
      edges: [
        { id: 'edge:b-call-a', layer: 'static', kind: 'possible_call', source_id: 'symbol:outer/inner/b.py:inner_b', target_id: 'symbol:outer/a.py:outer_a', callsite_path: 'outer/inner/b.py', callsite_line: 5, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
        { id: 'edge:c-call-b', layer: 'static', kind: 'possible_call', source_id: 'symbol:outer/inner/deep/c.py:deep_c', target_id: 'symbol:outer/inner/b.py:inner_b', callsite_path: 'outer/inner/deep/c.py', callsite_line: 5, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
      ],
      unresolved: [],
      external_modules: [],
      stale_paths: [],
      complete: true,
      partial_reasons: [],
    },
  ];
}

describe('Layout B: Deeply nested subfolders with no Python files in root', () => {
  it('does not show root as empty, reports total Python files across folders in status line, and groups files by nested folder', async () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createLayoutBSpectateEvents()) {
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
          projectName="layout_b"
        />
      </div>
    );

    // Folder with only subfolders is not shown as empty
    expect(screen.queryByText(/No files recorded/i)).toBeNull();
    expect(screen.queryByText(/No Python files found/i)).toBeNull();

    // Status line reports total Python files across folders
    expect(screen.getByText('Watching 3 Python files in 3 folders')).toBeDefined();

    // Nested folders appear as folder groups
    expect(screen.getByText('outer/')).toBeDefined();
    expect(screen.getByText('outer/inner/')).toBeDefined();
    expect(screen.getByText('outer/inner/deep/')).toBeDefined();

    // Full relative paths are rendered, never just the basename
    expect(screen.getByText('outer/a.py')).toBeDefined();
    expect(screen.getByText('outer/inner/b.py')).toBeDefined();
    expect(screen.getByText('outer/inner/deep/c.py')).toBeDefined();

    unmount();

    // 2. Map View verification
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
        />
      </div>
    );

    await waitFor(() => expect(capturedCy).not.toBeNull());

    // All nested file nodes are rendered on the map
    expect(capturedCy.getElementById('file:outer/a.py').length).toBe(1);
    expect(capturedCy.getElementById('file:outer/inner/b.py').length).toBe(1);
    expect(capturedCy.getElementById('file:outer/inner/deep/c.py').length).toBe(1);

    // Child symbols exist
    expect(capturedCy.getElementById('symbol:outer/a.py:outer_a').length).toBe(1);
    expect(capturedCy.getElementById('symbol:outer/inner/b.py:inner_b').length).toBe(1);
    expect(capturedCy.getElementById('symbol:outer/inner/deep/c.py:deep_c').length).toBe(1);
  });
});
