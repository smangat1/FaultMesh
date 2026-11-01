import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import fixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { ReplayExportV2 } from '../replay/types';

function promptExport(): ReplayExportV2 {
  const exported = structuredClone(fixture) as ReplayExportV2;
  const promptRecord = exported.records.find((record) => record.sequence === 2)!;
  promptRecord.prompt_id = 'prompt-one';
  promptRecord.prompt_text = 'Update the calculator safely\nKeep the public API stable.';
  promptRecord.tool_name = 'Command';
  promptRecord.tool_response = { aggregatedOutput: 'Inspection completed.' };
  exported.records.find((record) => record.sequence === 3)!.prompt_id = 'prompt-one';
  const secondPrompt = exported.records.find((record) => record.sequence === 5)!;
  secondPrompt.prompt_id = 'prompt-two';
  secondPrompt.prompt_text = 'Run the test suite';
  exported.records.find((record) => record.sequence === 6)!.prompt_id = 'prompt-two';
  exported.records.find((record) => record.sequence === 7)!.prompt_id = 'prompt-two';
  return exported;
}

describe('prompt-centric replay navigation', () => {
  it('uses prompt stops, folds no-file evidence, and keeps raw steps available', () => {
    const adapter = new ReplayAdapter(promptExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Prompt 1 of');
    expect(screen.getAllByTestId('timeline-folded-step').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('replay-next-btn'));
    const card = screen.getByTestId('replay-prompt-card');
    expect(card.textContent).toContain('Update the calculator safely');
    expect(card.textContent).toContain('1 file changed');
    expect(card.textContent).toContain('Tests passed');
    expect(screen.getByTestId('replay-folded-evidence').textContent).toContain('Command');
    expect(screen.queryByText('No files changed in this step')).toBeNull();

    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Prompt 3 of');

    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Step \d+ of 7/);

    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Prompt \d+ of 4/);
    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Step \d+ of 7/);
    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Step \d+ of 7/);
  });

  it('shows an honest prompt-level state when a prompt changed no files', () => {
    const adapter = new ReplayAdapter(promptExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);

    expect(screen.getByTestId('replay-prompt-no-files').textContent).toContain(
      'No recorded file changes for this prompt'
    );
    expect(screen.queryByText('No files changed in this step')).toBeNull();
  });
});
