import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import fixture from '../fixtures/fixture_replay_timeline_hero.json';
import type { ReplayExportV2 } from '../replay/types';

function promptExport(): ReplayExportV2 {
  const exported = structuredClone(fixture) as ReplayExportV2;
  const promptRecord = exported.records.find((record) => record.sequence === 1)!;
  promptRecord.prompt_id = 'prompt-one';
  promptRecord.turn_id = 'turn-one';
  promptRecord.prompt_text = 'Update the calculator safely\nKeep the public API stable.';
  for (const sequence of [2, 3, 4]) {
    const action = exported.records.find((record) => record.sequence === sequence)!;
    action.prompt_id = 'prompt-one';
    action.turn_id = 'turn-one';
    action.prompt_text = null;
  }
  exported.records.find((record) => record.sequence === 2)!.tool_name = 'Command';
  exported.records.find((record) => record.sequence === 2)!.tool_response = {
    aggregatedOutput: 'Inspection completed.',
  };
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
  exported.prompt_understanding = {
    summary: {
      sentences: ['Recorded prompts were reviewed.', 'Recorded changes remain evidence.', 'Unknowns remain unknown.'],
      source: 'model',
      fallback_used: false,
    },
    prompts: [{
      prompt_id: 'prompt-one',
      start_sequence: 2,
      end_sequence: 4,
      text: 'The recorded prompt asked for a calculator update while preserving its API.',
      label: 'model interpretation',
    }],
    total_prompts: 2,
    included_prompts: 2,
    truncated: false,
  };
  return exported;
}

describe('prompt-centric replay navigation', () => {
  it('resolves prompt text across mixed prompt and turn identifiers', () => {
    const exported = promptExport();
    const first = exported.records.find((record) => record.sequence === 1)!;
    first.turn_id = 'turn-one';
    first.prompt_id = 'prompt-one';
    exported.records.find((record) => record.sequence === 2)!.prompt_id = null;
    exported.records.find((record) => record.sequence === 2)!.turn_id = 'turn-one';
    const adapter = new ReplayAdapter(exported, 'synthetic_fixture');

    const group = adapter.getPromptGroups().find((item) => item.id === 'prompt-one');

    expect(group?.promptText).toContain('Update the calculator safely');
    expect(group?.endSequence).toBe(4);
  });

  it('names a truly textless group after its recorded step', () => {
    const exported = promptExport();
    exported.records.forEach((record) => {
      record.prompt_text = null;
    });
    render(<ReplayWorkspace adapter={new ReplayAdapter(exported, 'synthetic_fixture')} />);

    expect(screen.getByTestId('replay-prompt-context').textContent).toContain(
      'Prompt recorded at step 1',
    );
  });

  it('swaps isolated, ordered action timelines when a prompt is selected', () => {
    const adapter = new ReplayAdapter(promptExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} onDemandModelReady={false} />);

    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Action 1 of 3');
    expect(screen.getAllByTestId('timeline-step-tick').map((item) => item.getAttribute('data-sequence')))
      .toEqual(['2', '3', '4']);
    expect(screen.queryByTestId('timeline-folded-step')).toBeNull();

    fireEvent.click(screen.getByTestId('replay-next-btn'));
    expect(adapter.getCurrentSequence()).toBe(3);

    fireEvent.click(screen.getByTestId('replay-prompt-nav-1'));
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toContain('Action 1 of 2');
    expect(screen.getAllByTestId('timeline-step-tick').map((item) => item.getAttribute('data-sequence')))
      .toEqual(['6', '7']);
    expect(adapter.getCurrentSequence()).toBe(6);

    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Step \d+ of 3/);

    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Action \d+ of 2/);
    fireEvent.click(screen.getByTestId('replay-raw-step-toggle'));
    expect(screen.getByTestId('replay-current-seq-badge').textContent).toMatch(/Step \d+ of 3/);
  });

  it('shows an honest prompt-level state when a prompt changed no files', () => {
    const exported = promptExport();
    for (const entry of exported.timeline.filter((item) => item.sequence >= 5)) {
      entry.changed_files = [];
      entry.changed_symbols = [];
    }
    const command = exported.records.find((record) => record.sequence === 6)!;
    command.tool_name = 'Command';
    command.tool_input = { command: 'python -m pytest tests/unit/test_chat.py -q' };
    command.tool_response = { aggregatedOutput: '4 tests passed' };
    const adapter = new ReplayAdapter(exported, 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} />);
    fireEvent.click(screen.getByTestId('replay-prompt-nav-1'));

    expect(screen.getByTestId('replay-prompt-no-files').textContent).toContain(
      'No code to review'
    );
    expect(screen.getByTestId('replay-prompt-no-code-text').textContent).toContain(
      'Run the test suite',
    );
    const evidence = screen.getByTestId('replay-prompt-no-code-evidence');
    expect(evidence.hasAttribute('open')).toBe(false);
    expect(evidence.textContent).toContain('4 tests passed');
    expect(screen.queryByText('No files changed in this step')).toBeNull();
    expect(screen.queryByTestId('replay-file-workbench')).toBeNull();
  });

  it('streams labeled model lines onto prompt cards and keeps baseline facts underneath', () => {
    const adapter = new ReplayAdapter(promptExport(), 'synthetic_fixture');
    render(<ReplayWorkspace adapter={adapter} defaultChaptersOpen={true} />);

    fireEvent.click(screen.getByTestId('replay-prompt-nav-0'));
    fireEvent.click(screen.getByTestId('replay-prompt-context').querySelector('summary')!);
    const interpretation = screen.getByTestId('replay-prompt-interpretation');
    expect(interpretation.textContent).toContain('Model interpretation');
    expect(interpretation.textContent).toContain('preserving its API');
    expect(screen.getByTestId('replay-prompt-context').textContent).toContain(
      'Grouped from recorded prompt evidence'
    );

    fireEvent.click(screen.getByTestId('replay-baseline-toggle'));
    expect(screen.queryByTestId('replay-prompt-interpretation')).toBeNull();
    expect(screen.getByTestId('replay-prompt-context').textContent).toContain(
      'Grouped from recorded prompt evidence'
    );
  });

  it('renders file-cited rule risks and symbolically checked verdicts honestly', () => {
    const exported = promptExport();
    exported.prompt_risk_flags = [{
      prompt_id: 'prompt-one',
      kind: 'test_files_changed',
      label: 'Test files changed',
      files: ['tests/test_calc.py'],
      source: 'deterministic rule',
    }];
    exported.prompt_claim_checks = [{
      prompt_id: 'prompt-one',
      start_sequence: 2,
      end_sequence: 4,
      label: 'Model interpretation + symbolic check',
      claims: {
        schema_version: 'replay-claim-run-1.0',
        final_claims: {
          schema_version: 'replay-claims-1.0',
          claims: [
            {
              id: 'claim-file',
              assertion: {
                predicate: 'file_changed',
                path: 'src/calc.py',
                before_sha256: 'a'.repeat(64),
                after_sha256: 'b'.repeat(64),
                change: 'modified',
              },
              evidence_refs: ['file:src/calc.py:range-after'],
              statement: null,
            },
            {
              id: 'claim-function',
              assertion: {
                predicate: 'python_function_added',
                path: 'src/calc.ts',
                qualified_name: 'calculate',
              },
              evidence_refs: ['ast:src/calc.ts:range'],
              statement: null,
            },
          ],
        },
        final_source: 'first',
        verdicts: [
          {
            claim_id: 'claim-file',
            verdict: 'supported',
            reason_code: 'exact_file_fact',
            reason: 'The atomic file claim matches complete manifests.',
            evidence_refs: ['file:src/calc.py:range-after'],
            evidence_source: 'rebuilt_file',
            checker_version: 'replay-checker-1.0',
          },
          {
            claim_id: 'claim-function',
            verdict: 'unsupported_or_unknown',
            reason_code: 'ast_unavailable',
            reason: 'Python AST evidence is unavailable for this TypeScript file.',
            evidence_refs: ['ast:src/calc.ts:range'],
            evidence_source: 'rebuilt_file',
            checker_version: 'replay-checker-1.0',
          },
        ],
        fallback_used: false,
        repair_attempts: 0,
        backend: 'synthetic',
        model: 'synthetic-3b',
        latency_ms: 1,
      },
    }];
    render(<ReplayWorkspace adapter={new ReplayAdapter(exported, 'synthetic_fixture')} />);

    fireEvent.click(screen.getByTestId('replay-prompt-context').querySelector('summary')!);
    expect(screen.getByTestId('replay-prompt-risks').textContent).toContain(
      'Test files changed: tests/test_calc.py'
    );
    expect(screen.getByTitle('deterministic rule: tests/test_calc.py')).toBeDefined();
    const claims = screen.getByTestId('replay-prompt-claims');
    expect(claims.textContent).toContain('Model interpretation + symbolic check');
    expect(claims.textContent).toContain('Supported');
    expect(claims.textContent).toContain('Unknown');
    expect(claims.textContent).toContain('file:src/calc.py:range-after');
  });

  it('shows a quiet all-clean rule state without implying a model check', () => {
    const exported = promptExport();
    exported.prompt_risk_flags = [];
    exported.prompt_claim_checks = [];
    render(<ReplayWorkspace adapter={new ReplayAdapter(exported, 'synthetic_fixture')} />);

    expect(screen.getByTestId('replay-prompt-risks').textContent).toBe(
      'No rule-based risk flags'
    );
    expect(screen.queryByTestId('replay-prompt-claims')).toBeNull();
  });
});
