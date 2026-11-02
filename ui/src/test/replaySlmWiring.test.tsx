import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    const cancel = vi.fn();
    const view = render(
      <ReplayWorkspace
        adapter={adapter}
        narrationProgress={{ done: 3, total: 8 }}
        onCancelNarration={cancel}
      />
    );
    expect(screen.getByTestId('replay-narration-progress').textContent).toBe('Summarizing prompts 3/8');
    fireEvent.click(screen.getByLabelText('Stop prompt summaries'));
    expect(cancel).toHaveBeenCalledTimes(1);
    view.rerender(<ReplayWorkspace adapter={adapter} narrationProgress={null} />);
    expect(screen.queryByTestId('replay-narration-progress')).toBeNull();
  });

  it('test_baseline_chapters_render_before_model_ready', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const source = structuredClone(narratedFixture) as unknown as AnyReplayExport;
    if (source.schema_version === 'replay-export-2.0') {
      source.chapters = structuredClone(source.baseline_chapters);
      source.narration = [];
    }
    const adapter = new ReplayAdapter(source);
    render(<ReplayWorkspace adapter={adapter} defaultChaptersOpen={true} plainMode={true} />);
    const baseline = adapter.getBaselineChapters()[0];
    expect(screen.getAllByText(baseline.title).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('replay-narration-progress')).toBeNull();
  });

  it('test_selection_flow_renders_checked_counts_and_reuses_ui_cache', async () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const summarize = vi.fn().mockResolvedValue({
      schema_version: 'replay-selection-summary-1.0',
      start_sequence: 1,
      end_sequence: 3,
      total_steps: 3,
      non_trivial_steps: 2,
      checked_claim_steps: 2,
      text: 'Summarized 2 of 3 steps with checked claims.',
      source: 'model',
      fallback_used: false,
      error: null,
    });
    render(
      <ReplayWorkspace
        adapter={new ReplayAdapter(structuredClone(narratedFixture) as unknown as AnyReplayExport)}
        defaultChaptersOpen={true}
        onSummarizeSelection={summarize}
      />
    );
    fireEvent.click(screen.getByTestId('replay-checkpoint-row-1'));
    fireEvent.click(screen.getByTestId('replay-checkpoint-row-3'), { shiftKey: true });
    const button = screen.getByTestId('replay-summarize-selection');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('replay-selection-checked-counts').textContent).toContain('2 of 3'));
    fireEvent.click(button);
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
  });

  it('test_trivial_step_click_is_instant_and_never_calls_model', () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const source = structuredClone(historyFixture) as unknown as AnyReplayExport;
    source.timeline[0].changed_files = [];
    source.timeline[0].test_evidence = [];
    source.records[0].tool_response = null;
    const explain = vi.fn();
    render(
      <ReplayWorkspace
        adapter={new ReplayAdapter(source)}
        defaultChaptersOpen={true}
        onExplainStep={explain}
      />
    );
    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    fireEvent.click(screen.getByTestId(`replay-checkpoint-row-${source.timeline[0].sequence}`));
    expect(screen.getByTestId('replay-step-deterministic-note').textContent).toContain('No recorded changes');
    expect(explain).not.toHaveBeenCalled();
  });

  it('test_rapid_step_selects_keep_one_explanation_in_flight_and_run_latest', async () => {
    window.localStorage.setItem(
      FIRST_USE_TIPS_STORAGE_KEY,
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    const source = structuredClone(narratedFixture) as unknown as AnyReplayExport;
    if (source.schema_version === 'replay-export-2.0') source.narration = [];
    const original = (narratedFixture as unknown as { narration: StepNarration[] }).narration;
    const resolutions: Array<(value: StepNarration) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const explain = vi.fn((_sequence: number) => new Promise<StepNarration>((resolve) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      resolutions.push((value) => {
        active -= 1;
        resolve(value);
      });
    }));
    render(
      <ReplayWorkspace
        adapter={new ReplayAdapter(source)}
        defaultChaptersOpen={true}
        onExplainStep={explain}
      />
    );

    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    fireEvent.click(screen.getByTestId('replay-checkpoint-row-3'));
    fireEvent.click(screen.getByTestId('replay-checkpoint-row-6'));
    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenLastCalledWith(3);
    expect(screen.getByTestId('replay-step-explanation-loading')).toBeDefined();

    await act(async () => resolutions[0](original.find((item) => item.sequence === 3)!));
    await waitFor(() => expect(explain).toHaveBeenCalledTimes(2));
    expect(explain).toHaveBeenLastCalledWith(6);
    expect(maximumActive).toBe(1);
    await act(async () => resolutions[1](original.find((item) => item.sequence === 6)!));
    await waitFor(() => expect(screen.queryByTestId('replay-step-explanation-loading')).toBeNull());
  });

  it('test_model_not_ready_step_select_never_calls_model', () => {
    const source = structuredClone(historyFixture) as unknown as AnyReplayExport;
    const explain = vi.fn();
    render(
      <ReplayWorkspace
        adapter={new ReplayAdapter(source)}
        defaultChaptersOpen={true}
        onDemandModelReady={false}
        onExplainStep={explain}
      />
    );
    fireEvent.click(screen.getByTestId('replay-checkpoint-row-2'));
    expect(explain).not.toHaveBeenCalled();
    expect(screen.getByTestId('replay-step-deterministic-note').textContent).toContain(
      'Set up the local model to check this step.'
    );
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
