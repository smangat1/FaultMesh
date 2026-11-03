import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import fixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { ReplayExportV2 } from '../replay/types';

function playbackExport(): ReplayExportV2 {
  const exported = structuredClone(fixture) as ReplayExportV2;
  const firstPrompt = exported.records.find((record) => record.sequence === 1)!;
  firstPrompt.prompt_id = 'prompt-one';
  firstPrompt.turn_id = 'turn-one';
  firstPrompt.prompt_text = 'Update the calculator safely';
  for (const sequence of [2, 3, 4]) {
    const action = exported.records.find((record) => record.sequence === sequence)!;
    action.prompt_id = 'prompt-one';
    action.turn_id = 'turn-one';
    action.prompt_text = null;
  }
  exported.timeline.find((entry) => entry.sequence === 2)!.changed_files = structuredClone(
    exported.timeline.find((entry) => entry.sequence === 3)!.changed_files
  );
  const secondPrompt = exported.records.find((record) => record.sequence === 5)!;
  secondPrompt.prompt_id = 'prompt-two';
  secondPrompt.turn_id = 'turn-two';
  secondPrompt.prompt_text = 'Run the test suite';
  for (const sequence of [6, 7]) {
    const action = exported.records.find((record) => record.sequence === sequence)!;
    action.prompt_id = 'prompt-two';
    action.turn_id = 'turn-two';
    action.prompt_text = null;
  }
  return exported;
}

function mockReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('prompt-centric replay playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays only the selected prompt actions and stops at its end', () => {
    const adapter = new ReplayAdapter(playbackExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    fireEvent.click(screen.getByTestId('replay-play-toggle'));
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('true');
    act(() => vi.advanceTimersByTime(2399));
    expect(adapter.getCurrentSequence()).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(adapter.getCurrentSequence()).toBe(3);

    act(() => vi.advanceTimersByTime(1200));
    expect(adapter.getCurrentSequence()).toBe(4);
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('changes speed while playing and lets Space toggle without scrolling', () => {
    const adapter = new ReplayAdapter(playbackExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    fireEvent.click(screen.getByTestId('replay-speed-4'));
    expect(screen.getByTestId('replay-speed-4').getAttribute('aria-pressed')).toBe('true');
    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space' })).toBe(false);
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('true');

    act(() => vi.advanceTimersByTime(599));
    expect(adapter.getCurrentSequence()).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(adapter.getCurrentSequence()).toBe(3);

    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space' })).toBe(false);
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('pauses immediately when the user navigates or starts dragging the scrubber', () => {
    const adapter = new ReplayAdapter(playbackExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    fireEvent.click(screen.getByTestId('replay-play-toggle'));
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('false');
    const sequenceAfterKey = adapter.getCurrentSequence();
    act(() => vi.advanceTimersByTime(5000));
    expect(adapter.getCurrentSequence()).toBe(sequenceAfterKey);

    fireEvent.click(screen.getByTestId('replay-play-toggle'));
    fireEvent.pointerDown(screen.getByTestId('timeline-track-lane'), {
      button: 0,
      clientX: 300,
      pointerId: 1,
    });
    expect(screen.getByTestId('replay-play-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the reduced-motion path while keeping playback functional', () => {
    mockReducedMotion(true);
    const adapter = new ReplayAdapter(playbackExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    expect(screen.getByTestId('replay-workspace').getAttribute('data-motion')).toBe('reduced');
    fireEvent.click(screen.getByTestId('replay-play-toggle'));
    act(() => vi.advanceTimersByTime(2400));
    expect(adapter.getCurrentSequence()).toBe(3);
  });
});
