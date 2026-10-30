import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstUseTipOverlay, type TipStep } from '../components/FirstUseTipOverlay';
import {
  FIRST_USE_TIPS_STORAGE_KEY,
  isScreenTipSeen,
  markScreenTipSeen,
  resetScreenTipSeen,
  getSeenState,
} from '../utils/firstUseTipsStorage';
import { AutodetectHomeScreen } from '../components/AutodetectHomeScreen';
import { LiveEntranceScreen } from '../components/LiveEntranceScreen';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import { ReplayAdapter } from '../adapter/replayAdapter';
import heroFixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { AnyReplayExport } from '../replay/types';

describe('First-Use Tips System', () => {
  beforeEach(() => {
    window.localStorage.removeItem(FIRST_USE_TIPS_STORAGE_KEY);
  });

  describe('Storage Utility', () => {
    it('returns false for unseen screens and handles missing storage', () => {
      expect(isScreenTipSeen('home')).toBe(false);
      expect(isScreenTipSeen('entrance')).toBe(false);
      expect(isScreenTipSeen('replay')).toBe(false);
      expect(getSeenState()).toEqual({});
    });

    it('marks screen seen and persists in localStorage', () => {
      markScreenTipSeen('home');
      expect(isScreenTipSeen('home')).toBe(true);
      expect(isScreenTipSeen('entrance')).toBe(false);
      expect(getSeenState()).toEqual({ home: true });

      markScreenTipSeen('replay');
      expect(isScreenTipSeen('replay')).toBe(true);
      expect(getSeenState()).toEqual({ home: true, replay: true });
    });

    it('resets screen seen state', () => {
      markScreenTipSeen('home');
      markScreenTipSeen('entrance');
      expect(isScreenTipSeen('home')).toBe(true);

      resetScreenTipSeen('home');
      expect(isScreenTipSeen('home')).toBe(false);
      expect(isScreenTipSeen('entrance')).toBe(true);
    });

    it('handles corrupt localStorage safely without crashing', () => {
      window.localStorage.setItem(FIRST_USE_TIPS_STORAGE_KEY, '{ invalid json');
      expect(getSeenState()).toEqual({});
      expect(isScreenTipSeen('home')).toBe(false);

      window.localStorage.setItem(FIRST_USE_TIPS_STORAGE_KEY, '["not an object"]');
      expect(getSeenState()).toEqual({});
      expect(isScreenTipSeen('home')).toBe(false);

      // Writing after corrupt state recovers gracefully
      markScreenTipSeen('home');
      expect(isScreenTipSeen('home')).toBe(true);
    });
  });

  describe('FirstUseTipOverlay Component', () => {
    const mockSteps: TipStep[] = [
      {
        targetTestId: 'target-1',
        title: 'Step One Title',
        description: 'Step one description explaining feature.',
      },
      {
        targetTestId: 'target-2',
        title: 'Step Two Title',
        description: 'Step two description explaining feature.',
      },
      {
        targetTestId: 'target-3',
        title: 'Final Step Title',
        description: 'Step three description explaining feature.',
      },
    ];

    it('renders overlay, spotlight svg, and tip card on first visit when active', () => {
      const onDismiss = vi.fn();
      render(
        <div>
          <div data-testid="target-1">Target Element 1</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={true}
            onDismiss={onDismiss}
          />
        </div>
      );

      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
      expect(screen.getByTestId('first-use-spotlight-svg')).toBeDefined();
      expect(screen.getByTestId('first-use-tip-card')).toBeDefined();
      expect(screen.getByTestId('tip-card-title').textContent).toBe('Step One Title');
      expect(screen.getByTestId('tip-card-description').textContent).toBe(
        'Step one description explaining feature.'
      );
      expect(screen.getByTestId('tip-step-dots').children.length).toBe(3);
    });

    it('does not render overlay when active is false', () => {
      const onDismiss = vi.fn();
      render(
        <div>
          <div data-testid="target-1">Target Element 1</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={false}
            onDismiss={onDismiss}
          />
        </div>
      );

      expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
    });

    it('advances through steps with Next button and marks seen on completion', () => {
      const onDismiss = vi.fn();
      render(
        <div>
          <div data-testid="target-1">Target Element 1</div>
          <div data-testid="target-2">Target Element 2</div>
          <div data-testid="target-3">Target Element 3</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={true}
            onDismiss={onDismiss}
          />
        </div>
      );

      // Step 1
      expect(screen.getByTestId('tip-card-title').textContent).toBe('Step One Title');
      const nextBtn = screen.getByTestId('tip-next-btn');
      expect(nextBtn.textContent).toBe('Next');

      // Click Next -> Step 2
      fireEvent.click(nextBtn);
      expect(screen.getByTestId('tip-card-title').textContent).toBe('Step Two Title');
      expect(screen.getByTestId('tip-next-btn').textContent).toBe('Next');

      // Click Next -> Step 3 (final)
      fireEvent.click(screen.getByTestId('tip-next-btn'));
      expect(screen.getByTestId('tip-card-title').textContent).toBe('Final Step Title');
      expect(screen.getByTestId('tip-next-btn').textContent).toBe('Got it');

      // Click "Got it" -> Completes and marks seen
      fireEvent.click(screen.getByTestId('tip-next-btn'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(isScreenTipSeen('home')).toBe(true);
    });

    it('skips and marks seen when Skip button is clicked', () => {
      const onDismiss = vi.fn();
      render(
        <div>
          <div data-testid="target-1">Target Element 1</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={true}
            onDismiss={onDismiss}
          />
        </div>
      );

      fireEvent.click(screen.getByTestId('tip-skip-btn'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(isScreenTipSeen('home')).toBe(true);
    });

    it('skips and marks seen when Escape key is pressed', () => {
      const onDismiss = vi.fn();
      render(
        <div>
          <div data-testid="target-1">Target Element 1</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={true}
            onDismiss={onDismiss}
          />
        </div>
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(isScreenTipSeen('home')).toBe(true);
    });

    it('gracefully skips missing target elements without crashing', () => {
      const onDismiss = vi.fn();
      // Only target-2 exists; target-1 is missing
      render(
        <div>
          <div data-testid="target-2">Target Element 2</div>
          <FirstUseTipOverlay
            screenId="home"
            steps={mockSteps}
            active={true}
            onDismiss={onDismiss}
          />
        </div>
      );

      // target-1 was missing, so overlay automatically skipped to Step 2
      expect(screen.getByTestId('tip-card-title').textContent).toBe('Step Two Title');
    });
  });

  describe('Integration Across Screens', () => {
    it('AutodetectHomeScreen shows tips on first visit, skips on skip click, and replays via "?" button', () => {
      // Unseen state
      expect(isScreenTipSeen('home')).toBe(false);

      render(
        <AutodetectHomeScreen
          onSelectProject={vi.fn()}
          hasBridge={true}
          cachedRoots={[]}
          cachedSessions={[]}
        />
      );

      // First visit renders tips
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
      expect(screen.getByTestId('home-help-tips-btn')).toBeDefined();

      // Click Skip
      fireEvent.click(screen.getByTestId('tip-skip-btn'));
      expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
      expect(isScreenTipSeen('home')).toBe(true);

      // Replay via "?" button
      fireEvent.click(screen.getByTestId('home-help-tips-btn'));
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
    });

    it('LiveEntranceScreen shows tips on first visit and replays via "?" button', () => {
      expect(isScreenTipSeen('entrance')).toBe(false);

      render(
        <LiveEntranceScreen
          projectName="test-project"
          filesCount={5}
          nodesCount={10}
          changedFilesCount={1}
          onSelectMode={vi.fn()}
        />
      );

      // First visit renders tips
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
      expect(screen.getByTestId('entrance-help-tips-btn')).toBeDefined();

      // Skip
      fireEvent.click(screen.getByTestId('tip-skip-btn'));
      expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
      expect(isScreenTipSeen('entrance')).toBe(true);

      // Replay via "?" button
      fireEvent.click(screen.getByTestId('entrance-help-tips-btn'));
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
    });

    it('ReplayWorkspace shows tips on first visit and replays via "?" button', () => {
      expect(isScreenTipSeen('replay')).toBe(false);
      const adapter = new ReplayAdapter(heroFixture as unknown as AnyReplayExport, 'synthetic_fixture');

      render(
        <ReplayWorkspace
          adapter={adapter}
        />
      );

      // First visit renders tips
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
      expect(screen.getByTestId('replay-help-tips-btn')).toBeDefined();

      // Skip
      fireEvent.click(screen.getByTestId('tip-skip-btn'));
      expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
      expect(isScreenTipSeen('replay')).toBe(true);

      // Replay via "?" button in header tools
      fireEvent.click(screen.getByTestId('replay-help-tips-btn'));
      expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
    });
  });
});
