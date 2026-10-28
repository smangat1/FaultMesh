import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { reduceLiveSpectate, EMPTY_LIVE_SPECTATE_STATE, LiveSpectateAdapter } from '../spectate/liveState';
import type { SpectateEvent } from '../spectate/types';
import { GraphView } from '../components/GraphView';
import { Sidebar } from '../components/Sidebar';
import { LiveFilesView } from '../components/LiveFilesView';

function createLayoutCSpectateEvents(): SpectateEvent[] {
  return [
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-c',
      sequence: 1,
      emitted_at: '2026-10-28T00:00:00Z',
      event: 'session_started',
      root_display_name: 'layout_c',
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-c',
      sequence: 2,
      emitted_at: '2026-10-28T00:00:01Z',
      event: 'initial_snapshot',
      files: [
        { id: 'file:a.py', path: 'a.py', content_sha256: 'sha-root-a', line_count: 5, parse_ok: true, parse_error: null },
        { id: 'file:sub/a.py', path: 'sub/a.py', content_sha256: 'sha-sub-a', line_count: 15, parse_ok: true, parse_error: null },
      ],
      structure: {
        files: [
          { id: 'file:a.py', path: 'a.py', module: 'a', content_sha256: 'sha-root-a', line_count: 5, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
          { id: 'file:sub/a.py', path: 'sub/a.py', module: 'sub.a', content_sha256: 'sha-sub-a', line_count: 15, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
        ],
        symbols: [
          { id: 'symbol:a.py:root_func', path: 'a.py', qualified_name: 'root_func', name: 'root_func', kind: 'function', disambiguator: 1, parent_id: 'file:a.py', start_line: 1, end_line: 5, content_sha256: 's-ra', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
          { id: 'symbol:sub/a.py:sub_func', path: 'sub/a.py', qualified_name: 'sub_func', name: 'sub_func', kind: 'function', disambiguator: 1, parent_id: 'file:sub/a.py', start_line: 1, end_line: 15, content_sha256: 's-sa', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
        ],
        skips: [],
      },
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-layout-c',
      sequence: 3,
      emitted_at: '2026-10-28T00:00:02Z',
      event: 'relationship_update',
      edges: [],
      unresolved: [],
      external_modules: [],
      stale_paths: [],
      complete: true,
      partial_reasons: [],
    },
  ];
}

describe('Layout C: Duplicate basenames in different folders (a.py vs sub/a.py)', () => {
  it('disambiguates same-named files with distinct labels across Map, Sidebar, and Files view', async () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createLayoutCSpectateEvents()) {
      state = reduceLiveSpectate(state, evt);
    }

    const adapter = new LiveSpectateAdapter(state);
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);

    // 1. Adapter produces distinct cluster names
    const rootCluster = graph.files?.find((f) => f.file === 'a.py');
    const subCluster = graph.files?.find((f) => f.file === 'sub/a.py');
    expect(rootCluster).toBeDefined();
    expect(subCluster).toBeDefined();
    expect(rootCluster?.name).toBe('a.py');
    expect(subCluster?.name).toBe('sub/a.py');
    expect(rootCluster?.name).not.toBe(subCluster?.name);

    // 2. Map View renders distinct node labels
    let capturedCy: any = null;
    const { unmount: unmountMap } = render(
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

    const rootCyNode = capturedCy.getElementById('file:a.py');
    const subCyNode = capturedCy.getElementById('file:sub/a.py');
    expect(rootCyNode.length).toBe(1);
    expect(subCyNode.length).toBe(1);

    // Labels are distinct: "a.py" vs "sub/a.py"
    expect(rootCyNode.data('label')).toBe('a.py');
    expect(subCyNode.data('label')).toBe('sub/a.py');
    expect(rootCyNode.data('label')).not.toBe(subCyNode.data('label'));

    unmountMap();

    // 3. Sidebar shows distinct labels
    const { unmount: unmountSidebar } = render(
      <Sidebar
        tests={[]}
        selectedTestId={null}
        onSelectTest={() => {}}
        files={graph.files}
        nodes={graph.nodes}
      />
    );

    expect(screen.getByText('a.py')).toBeDefined();
    expect(screen.getByText('sub/a.py')).toBeDefined();

    unmountSidebar();

    // 4. Files view shows full paths in distinct folder groups
    render(
      <LiveFilesView
        files={state.files}
        fileHistory={state.fileHistory}
        liveStatus={state.status}
        projectName="layout_c"
      />
    );

    expect(screen.getByText('root')).toBeDefined();
    expect(screen.getByText('sub/')).toBeDefined();
    expect(screen.getByText('a.py')).toBeDefined();
    expect(screen.getByText('sub/a.py')).toBeDefined();
  });
});
