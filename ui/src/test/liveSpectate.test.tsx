import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { GraphView } from '../components/GraphView';
import type { V2RunEvidenceExport, V3FileNode, V3SymbolNode } from '../import';
import {
  EMPTY_LIVE_SPECTATE_STATE,
  LiveSpectateAdapter,
  reduceLiveSpectate,
  type LiveSpectateState,
} from '../spectate/liveState';
import type { SpectateEvent } from '../spectate/types';
import type { SpectateBridge } from '../spectate/types';

const envelope = {
  schema_version: 'spectate-1.1' as const,
  session_id: 'session-live',
  emitted_at: '2026-10-27T12:00:00Z',
};

const providerFile: V3FileNode = {
  id: 'file:provider.py',
  path: 'provider.py',
  module: 'provider',
  content_sha256: 'provider-good',
  line_count: 2,
  is_test: false,
  is_test_heuristic: true,
  parse_error: null,
  removed: false,
  revision_side: 'head',
};

const consumerFile: V3FileNode = {
  ...providerFile,
  id: 'file:consumer.py',
  path: 'consumer.py',
  module: 'consumer',
  content_sha256: 'consumer-good',
  line_count: 4,
};

const providerSymbol: V3SymbolNode = {
  id: 'symbol:provider.py:target',
  path: 'provider.py',
  qualified_name: 'target',
  name: 'target',
  kind: 'function',
  disambiguator: 1,
  parent_id: 'file:provider.py',
  start_line: 1,
  end_line: 2,
  content_sha256: 'provider-symbol',
  signature: '()',
  parameter_names: [],
  decorators: [],
  docstring: { text: 'Return the target value.', source: 'docstring' },
  bases: [],
  removed: false,
  revision_side: 'head',
};

const consumerSymbol: V3SymbolNode = {
  ...providerSymbol,
  id: 'symbol:consumer.py:caller',
  path: 'consumer.py',
  qualified_name: 'caller',
  name: 'caller',
  parent_id: 'file:consumer.py',
  start_line: 3,
  end_line: 4,
  content_sha256: 'consumer-symbol',
  docstring: null,
};

function apply(state: LiveSpectateState, event: SpectateEvent): LiveSpectateState {
  return reduceLiveSpectate(state, event);
}

function initialLiveState(): LiveSpectateState {
  let state = apply(EMPTY_LIVE_SPECTATE_STATE, {
    ...envelope,
    sequence: 1,
    event: 'session_started',
    root_display_name: 'watched-project',
  });
  state = apply(state, {
    ...envelope,
    sequence: 2,
    event: 'initial_snapshot',
    files: [],
    structure: {
      files: [consumerFile, providerFile],
      symbols: [consumerSymbol, providerSymbol],
      skips: [],
    },
  });
  return apply(state, {
    ...envelope,
    sequence: 3,
    event: 'relationship_update',
    edges: [{
      id: 'edge:call',
      layer: 'static',
      kind: 'possible_call',
      source_id: consumerSymbol.id,
      target_id: providerSymbol.id,
      callsite_path: 'consumer.py',
      callsite_line: 4,
      resolution_reason: 'import_binding',
      confidence: 'resolved',
      external_module: null,
      removed: false,
      revision_side: 'head',
    }],
    unresolved: [],
    external_modules: [],
    stale_paths: [],
    complete: true,
    partial_reasons: [],
  });
}

afterEach(() => {
  delete window.faultmeshSpectate;
});

describe('live spectate graph binding', () => {
  it('feeds initial files, symbols, and relationships through ImportedAdapter mapping', async () => {
    const adapter = new LiveSpectateAdapter(initialLiveState());
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);

    expect(run.project).toBe('watched-project');
    expect(run.isLive).toBe(true);
    expect(run.fixtureLabel).toBe('Live: watched-project');
    expect(graph.files?.map((file) => file.file)).toEqual(['consumer.py', 'provider.py']);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      consumerSymbol.id,
      providerSymbol.id,
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: consumerSymbol.id,
        target: providerSymbol.id,
        category: 'static_call',
      }),
    ]));
    expect(graph.nodes.some((node) => node.id.includes('auth/'))).toBe(false);
  });

  it('updates structure in place, exposes hash-matched source, and marks stale parse facts', async () => {
    let state = initialLiveState();
    state = apply(state, {
      ...envelope,
      sequence: 4,
      event: 'file_changed',
      path: 'provider.py',
      kind: 'modified',
      new_sha256: 'provider-broken',
      changed_line_ranges: [{ start_line: 1, end_line: 2 }],
      affected_file_ids: ['file:provider.py'],
      affected_symbol_ids: [providerSymbol.id],
      parse_ok: false,
      parse_error: 'invalid syntax at line 1',
    });
    state = apply(state, {
      ...envelope,
      sequence: 5,
      event: 'source',
      path: 'provider.py',
      sha256: 'provider-broken',
      text: 'def target(:\n    return 2\n',
      complete: true,
      skipped_reason: null,
    });
    state = apply(state, {
      ...envelope,
      sequence: 6,
      event: 'diff',
      path: 'provider.py',
      text: '@@ -1 +1 @@\n-def target():\n+def target(:',
      truncated: false,
      skipped_reason: null,
    });
    state = apply(state, {
      ...envelope,
      sequence: 7,
      event: 'structure_update',
      path: 'provider.py',
      file: {
        ...providerFile,
        content_sha256: 'provider-broken',
        parse_error: 'invalid syntax at line 1',
      },
      symbols: [providerSymbol],
      changed_node_ids: ['file:provider.py', providerSymbol.id],
      kept_last_good_symbols: true,
      parse_ok: false,
      parse_error: 'invalid syntax at line 1',
    });
    state = apply(state, {
      ...envelope,
      sequence: 8,
      event: 'relationship_update',
      edges: [],
      unresolved: [],
      external_modules: [],
      stale_paths: [{
        path: 'provider.py',
        last_good_sha256: 'provider-good',
        current_sha256: 'provider-broken',
      }],
      complete: false,
      partial_reasons: ['stale_paths'],
    });

    const adapter = new LiveSpectateAdapter(state);
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);
    const target = graph.nodes.find((node) => node.id === providerSymbol.id);
    expect(target).toEqual(expect.objectContaining({
      changeStatus: 'modified',
      structureStale: true,
      sourceSnippet: 'def target(:\n    return 2',
      gitDiff: expect.stringContaining('+def target(:'),
    }));
    expect(run.limitations.join(' ')).toContain('last good parse is stale');
  });

  it('marks explicitly imported V2 evidence stale by containing-file hash', async () => {
    const evidence: V2RunEvidenceExport = {
      schema_version: '2.0',
      run: { id: 'recorded-run', outcome: 'FAILED' },
      tests: [{
        run_id: 'recorded-run',
        node_id: 'tests/test_provider.py::test_target',
        outcome: 'FAILED',
        phases: [],
        observation: {
          status: 'COMPLETE',
          instrumentation_version: '2.0',
          source_revision: 'old',
          source_content_sha256: 'old-project',
          symbols: [{
            path: 'provider.py',
            content_sha256: 'old-provider-hash',
            qualified_name: 'target',
            start_line: 1,
            end_line: 2,
            executed_lines: [2],
            phases: ['call'],
          }],
        },
      }],
    };
    const adapter = new LiveSpectateAdapter(initialLiveState(), [evidence]);
    const tests = await adapter.getTests('recorded-run');
    expect(tests[0].staleCoverage).toBe(true);
    expect(tests[0].exercisedNodeIds).toEqual([providerSymbol.id]);
  });

  it('highlights changed IDs without moving existing nodes on same-dataset updates', async () => {
    const adapter = new LiveSpectateAdapter(initialLiveState());
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);
    let cy: any = null;
    const { rerender } = render(
      <div style={{ width: 800, height: 600 }}>
        <GraphView
          graphData={graph}
          tests={[]}
          datasetKey="live:session-live"
          selectedTestId={null}
          highlightedNodeIds={[providerSymbol.id]}
          collapsedFiles={new Set()}
          onCyReady={(value) => { cy = value; }}
        />
      </div>,
    );
    expect(cy.getElementById(providerSymbol.id).hasClass('live-changed')).toBe(true);
    const before = { ...cy.getElementById(providerSymbol.id).position() };

    rerender(
      <div style={{ width: 800, height: 600 }}>
        <GraphView
          graphData={{ ...graph, nodes: graph.nodes.map((node) => ({ ...node })) }}
          tests={[]}
          datasetKey="live:session-live"
          selectedTestId={null}
          highlightedNodeIds={[providerSymbol.id]}
          collapsedFiles={new Set()}
        />
      </div>,
    );
    expect(cy.getElementById(providerSymbol.id).position()).toEqual(before);
  });

  it('keeps the last map and labels it stopped after the session ends', async () => {
    const stopped = apply(initialLiveState(), {
      ...envelope,
      sequence: 4,
      event: 'session_ended',
      reason: 'stopped_by_user',
    });
    const adapter = new LiveSpectateAdapter(stopped);
    const [run] = await adapter.getRuns();
    expect(run.liveStatus).toBe('stopped');
    expect(run.fixtureLabel).toBe('Stopped · last known: watched-project');
    expect((await adapter.getGraph(run.id)).nodes).toHaveLength(2);
  });

  it('replaces the demo workspace with the watched map and keeps it truthfully labeled on stop', async () => {
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
    emit({
      ...envelope,
      sequence: 1,
      event: 'session_started',
      root_display_name: 'watched-project',
    });
    emit({
      ...envelope,
      sequence: 2,
      event: 'initial_snapshot',
      files: [],
      structure: {
        files: [consumerFile, providerFile],
        symbols: [consumerSymbol, providerSymbol],
        skips: [],
      },
    });
    emit({
      ...envelope,
      sequence: 3,
      event: 'relationship_update',
      edges: [],
      unresolved: [],
      external_modules: [],
      stale_paths: [],
      complete: true,
      partial_reasons: [],
    });

    await waitFor(() => expect(screen.getByText('LIVE: watched-project')).toBeDefined());
    expect(screen.queryByText('SAMPLE DATA')).toBeNull();
    expect(screen.getAllByText('provider.py').length).toBeGreaterThan(0);

    emit({
      ...envelope,
      sequence: 4,
      event: 'session_ended',
      reason: 'stopped_by_user',
    });
    await waitFor(() => expect(screen.getByText('STOPPED · LAST KNOWN')).toBeDefined());
    expect(screen.getAllByText('provider.py').length).toBeGreaterThan(0);
  });
});
