import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import fixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { ReplayExportV2 } from '../replay/types';
import type { RevertPlan } from '../spectate/types';
import { REPLAY_PROJECT_LINKS_STORAGE_KEY } from '../utils/replayProjectLinksStorage';

const SESSION_ID = 'synthetic-session-hero';

function promptAdapter(): ReplayAdapter {
  const exported = structuredClone(fixture) as ReplayExportV2;
  const first = exported.records.find((record) => record.sequence === 2)!;
  first.prompt_id = 'prompt-one';
  first.prompt_text = 'Update the calculator safely.';
  exported.records.find((record) => record.sequence === 3)!.prompt_id = 'prompt-one';
  return new ReplayAdapter(exported, 'synthetic_fixture');
}

function syntheticPlan(): RevertPlan {
  return {
    schema_version: 'replay-revert-plan-1.0',
    session_id: SESSION_ID,
    start_sequence: 2,
    end_sequence: 3,
    actions: [
      {
        sequence: 3,
        path: 'calc.py',
        action: 'apply_reverse_diff',
        instruction: 'Review and apply the included reverse diff.',
        provenance: 'recorded_patch',
        provenance_label: 'recorded patch',
        reverse_diff: '--- b/calc.py\n+++ a/calc.py\n',
        restore_text: null,
      },
    ],
    truncated: false,
    text: [
      'Read-only revert plan for recorded steps 2-3',
      'Derived from recorded evidence. This plan does not write files or run commands.',
      'Provenance: recorded patch',
    ].join('\n'),
  };
}

describe('prompt replay actions', () => {
  beforeEach(() => {
    window.localStorage.setItem(REPLAY_PROJECT_LINKS_STORAGE_KEY, JSON.stringify({
      links: {
        [SESSION_ID]: { handle: 'synthetic-handle', displayName: 'Synthetic project' },
      },
    }));
  });

  it('copies a combined diff and opens the selected changed file through the desktop bridge', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const openSessionFile = vi.fn().mockResolvedValue({ opened: true, method: 'code' as const });
    render(
      <ReplayWorkspace
        adapter={promptAdapter()}
        importedSessionId={SESSION_ID}
        importedSessionTool="codex"
        hasSpectateBridge={true}
        onOpenSessionFile={openSessionFile}
      />
    );

    fireEvent.click(screen.getByTestId('replay-next-btn'));
    expect(screen.getByTestId('replay-prompt-actions')).toBeDefined();
    fireEvent.click(screen.getByTestId('replay-copy-prompt-diff'));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain('+++ b/calc.py');
    expect(await screen.findByText('Prompt diff copied.')).toBeDefined();

    fireEvent.click(screen.getByTestId('replay-open-prompt-file'));
    await waitFor(() => expect(openSessionFile).toHaveBeenCalledWith(SESSION_ID, 'calc.py'));
    expect(await screen.findByText('Opened in your editor.')).toBeDefined();
  });

  it('requests and copies an honest read-only revert plan for the active prompt range', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const requestPlan = vi.fn().mockResolvedValue(syntheticPlan());
    render(
      <ReplayWorkspace
        adapter={promptAdapter()}
        importedSessionId={SESSION_ID}
        importedSessionTool="codex"
        importedSessionSource="history"
        hasSpectateBridge={true}
        onRequestRevertPlan={requestPlan}
      />
    );

    fireEvent.click(screen.getByTestId('replay-next-btn'));
    fireEvent.click(screen.getByTestId('replay-generate-revert-plan'));
    expect(screen.getByRole('status').textContent).toContain('Building the plan');
    await waitFor(() => expect(requestPlan).toHaveBeenCalledWith(
      SESSION_ID,
      'codex',
      2,
      3,
      'history',
    ));
    const dialog = await screen.findByTestId('replay-revert-plan');
    expect(dialog.textContent).toContain('Derived, not applied');
    expect(dialog.textContent).toContain('Reconstructed content is unverified');
    expect(dialog.textContent).toContain('unknown evidence remains marked unknown');
    expect(screen.getByTestId('replay-revert-plan-text').textContent).toContain(
      'This plan does not write files or run commands.'
    );

    fireEvent.click(screen.getByTestId('replay-copy-revert-plan'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(syntheticPlan().text));
  });

  it('hides the editor action in the browser while leaving read-only actions available', () => {
    render(<ReplayWorkspace adapter={promptAdapter()} hasSpectateBridge={false} />);
    fireEvent.click(screen.getByTestId('replay-next-btn'));

    expect(screen.getByTestId('replay-copy-prompt-diff')).toBeDefined();
    expect(screen.queryByTestId('replay-open-prompt-file')).toBeNull();
    expect(screen.queryByTestId('replay-generate-revert-plan')).toBeNull();
  });
});
