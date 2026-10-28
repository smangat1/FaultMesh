import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { reduceLiveSpectate, EMPTY_LIVE_SPECTATE_STATE, LiveSpectateAdapter } from '../spectate/liveState';
import type { SpectateEvent } from '../spectate/types';
import { GraphView } from '../components/GraphView';
import { LiveFilesView } from '../components/LiveFilesView';
import { Header } from '../components/Header';
import { formatWatchingStatus } from '../utils/nestedPaths';

function createZeroFilesSpectateEvents(): SpectateEvent[] {
  return [
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-zero-files',
      sequence: 1,
      emitted_at: '2026-10-28T00:00:00Z',
      event: 'session_started',
      root_display_name: 'empty_project',
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-zero-files',
      sequence: 2,
      emitted_at: '2026-10-28T00:00:01Z',
      event: 'initial_snapshot',
      files: [],
      structure: {
        files: [],
        symbols: [],
        skips: [],
      },
    },
    {
      schema_version: 'spectate-1.1',
      session_id: 'session-zero-files',
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

describe('Zero Python Files Anywhere', () => {
  const EXPECTED_ZERO_MSG =
    'No Python files found in this folder. Pick the folder that contains your .py code.';

  it('formatWatchingStatus returns plain zero-files instruction', () => {
    expect(formatWatchingStatus([])).toBe(EXPECTED_ZERO_MSG);
  });

  it('renders plain zero-files message in LiveFilesView', () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createZeroFilesSpectateEvents()) {
      state = reduceLiveSpectate(state, evt);
    }

    render(
      <LiveFilesView
        files={state.files}
        fileHistory={state.fileHistory}
        liveStatus={state.status}
        projectName="empty_project"
      />
    );

    // Header status line and empty state both display plain zero-files message
    const matches = screen.getAllByText(EXPECTED_ZERO_MSG);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('files-empty-state')).toBeDefined();
  });

  it('renders plain zero-files message in GraphView when watching empty folder', async () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createZeroFilesSpectateEvents()) {
      state = reduceLiveSpectate(state, evt);
    }

    const adapter = new LiveSpectateAdapter(state);
    const [run] = await adapter.getRuns();
    const graph = await adapter.getGraph(run.id);

    render(
      <div style={{ width: 1024, height: 768 }}>
        <GraphView
          graphData={graph}
          tests={[]}
          selectedTestId={null}
          isLive={true}
        />
      </div>
    );

    expect(screen.getByText(EXPECTED_ZERO_MSG)).toBeDefined();
  });

  it('renders plain zero-files message in Header when live run has no files', async () => {
    let state = EMPTY_LIVE_SPECTATE_STATE;
    for (const evt of createZeroFilesSpectateEvents()) {
      state = reduceLiveSpectate(state, evt);
    }

    const adapter = new LiveSpectateAdapter(state);
    const [run] = await adapter.getRuns();

    render(
      <Header
        activeRun={run}
        activeView="files"
        onSelectView={() => {}}
        liveWatchingStatus={formatWatchingStatus(state.files)}
      />
    );

    expect(screen.getByText(EXPECTED_ZERO_MSG)).toBeDefined();
  });
});
