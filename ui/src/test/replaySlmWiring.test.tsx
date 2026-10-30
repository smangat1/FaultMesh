import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayEvidenceInspector } from '../components/replay/ReplayEvidenceInspector';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import historyFixture from '../fixtures/fixture_replay_history_import.json';
import narratedFixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { AnyReplayExport, ReplayChapter, StepNarration } from '../replay/types';
import { validateReplayExport } from '../replay/validators';
import { FIRST_USE_TIPS_STORAGE_KEY } from '../utils/firstUseTipsStorage';
import { REPLAY_PROJECT_LINKS_STORAGE_KEY } from '../utils/replayProjectLinksStorage';

const historyAdapter = () => new ReplayAdapter(historyFixture as unknown as AnyReplayExport);

describe('replay local narration wiring', () => {
  beforeEach(() => {
    window.localStorage.removeItem(FIRST_USE_TIPS_STORAGE_KEY);
    window.localStorage.removeItem(REPLAY_PROJECT_LINKS_STORAGE_KEY);
  });

  it('test_imported_unlinked_unseen_session_shows_only_tips', () => {
    render(<ReplayWorkspace adapter={historyAdapter()} importedSessionId="session-new" />);
    expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
    expect(screen.queryByTestId('replay-model-setup')).toBeNull();
  });

  it('test_watch_prompt_appears_after_tips_dismissed', () => {
    render(<ReplayWorkspace adapter={historyAdapter()} importedSessionId="session-new" />);
    fireEvent.click(screen.getByTestId('tip-skip-btn'));
    expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
    expect(screen.getByTestId('watch-project-prompt')).toBeDefined();
  });

  it('test_watch_prompt_shows_immediately_when_tips_already_seen', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    render(<ReplayWorkspace adapter={historyAdapter()} importedSessionId="session-seen" />);
    expect(screen.queryByTestId('first-use-tip-overlay')).toBeNull();
    expect(screen.getByTestId('watch-project-prompt')).toBeDefined();
  });

  it('test_setup_screen_does_not_overlap_tips_or_watch_prompt', () => {
    render(
      <ReplayWorkspace
        adapter={historyAdapter()}
        importedSessionId="session-new"
        modelSetupOpen={true}
      />
    );
    expect(screen.getByTestId('first-use-tip-overlay')).toBeDefined();
    expect(screen.queryByTestId('replay-model-setup')).toBeNull();
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
    fireEvent.click(screen.getByTestId('tip-skip-btn'));
    expect(screen.getByTestId('replay-model-setup')).toBeDefined();
    expect(screen.queryByTestId('watch-project-prompt')).toBeNull();
  });

  it('test_chapters_swap_in_place_on_partial_event', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const source = structuredClone(narratedFixture) as unknown as AnyReplayExport;
    const adapter = new ReplayAdapter(source);
    const first = (source as { narration: StepNarration[] }).narration[0];
    const chapters: ReplayChapter[] = [{
      id: 'chapter:live',
      start_sequence: 1,
      end_sequence: 3,
      title: 'Live local chapter title',
      evidence_refs: [],
      source: 'model',
      title_status: 'model proposal',
    }];
    const view = render(
      <ReplayWorkspace adapter={adapter} defaultChaptersOpen={true} narrationRevision={0} />
    );
    adapter.applyNarrationProgress(first, chapters);
    view.rerender(
      <ReplayWorkspace adapter={adapter} defaultChaptersOpen={true} narrationRevision={1} />
    );
    expect(screen.getAllByText('Live local chapter title')).toHaveLength(2);
    expect(screen.getByTestId('replay-step-plain-label')).toBeDefined();
  });

  it('test_progress_chip_shows_count_and_hides_when_done', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const adapter = historyAdapter();
    const view = render(
      <ReplayWorkspace adapter={adapter} narrationProgress={{ done: 3, total: 8 }} />
    );
    expect(screen.getByTestId('replay-narration-progress').textContent).toBe('Narrating 3/8');
    view.rerender(<ReplayWorkspace adapter={adapter} narrationProgress={null} />);
    expect(screen.queryByTestId('replay-narration-progress')).toBeNull();
  });

  it('test_yellow_claim_shows_plain_reason', () => {
    const narration = {
      sequence: 1,
      claims: {
        final_claims: [{
          id: 'claim-unknown',
          assertion: { predicate: 'file_changed', path: 'example.py', change: 'modified' },
          evidence_refs: [],
          statement: 'example.py changed',
        }],
        verdicts: [{
          claim_id: 'claim-unknown',
          verdict: 'unsupported_or_unknown',
          reason_code: 'derived_file_state_unavailable',
          reason: 'internal jargon must not be shown',
          evidence_refs: [],
          checker_version: 'test',
        }],
        final_source: 'first',
      },
    } as unknown as StepNarration;
    render(
      <ReplayEvidenceInspector
        narration={narration}
        tests={[]}
        limitations={[]}
        isNarrationOn={true}
      />
    );
    expect(screen.getByText('could not check')).toBeDefined();
    expect(screen.getByText("couldn't rebuild this file from the log")).toBeDefined();
    expect(screen.queryByText(/derived_file_state_unavailable/)).toBeNull();
  });

  it('test_old_export_without_narration_still_validates', () => {
    const result = validateReplayExport(historyFixture);
    expect(result.success).toBe(true);
  });
});
