import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { validateReplayExport } from '../replay/validators';
import { ReplayAdapter } from '../adapter/replayAdapter';
import { ReplayWorkspace } from '../components/replay/ReplayWorkspace';
import type { ReplayExportDocument } from '../replay/types';

describe('Replay Backend Contract Regression Tests (Real Export Artifacts)', () => {
  it('loads real backend-generated V2 export with verified honesty contracts', () => {
    const fixturePath = path.resolve(__dirname, '../../../tests/fixtures/replay/fixture_replay_v2_enriched.json');
    const rawJson = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = JSON.parse(rawJson);

    // 1. Passes schema and integrity validation
    const valResult = validateReplayExport(parsed);
    expect(valResult.success).toBe(true);
    expect(valResult.version).toBe('replay-export-2.0');

    // 2. Wrap in ReplayAdapter
    const adapter = new ReplayAdapter(valResult.data as ReplayExportDocument, valResult.origin);
    const { unmount } = render(<ReplayWorkspace adapter={adapter} />);

    // Model-interpretation chapters labeled "model interpretation"
    const modelChapter = screen.getByTestId('replay-chapter-item-chapter:model-replay-4');
    expect(modelChapter).toBeDefined();
    expect(modelChapter.textContent).toContain('model interpretation');

    // Click next checkpoint to view sequence 2 where narration is attached
    const nextBtn = screen.getByTestId('replay-next-btn');
    fireEvent.click(nextBtn); // now sequence 2

    // Switch to Claims & Reason tab
    const claimsTab = screen.getByTestId('replay-tab-claims');
    fireEvent.click(claimsTab);

    // valid_exact_quote citation shows 'Source quote checked'
    const sourceQuoteChecked = screen.getByText('Source quote checked');
    expect(sourceQuoteChecked).toBeDefined();
    expect(screen.getByText(/Handle negative inputs in calculate function/)).toBeDefined();

    // Switch to Summary Audit tab
    const summaryTab = screen.getByTestId('replay-tab-summary');
    fireEvent.click(summaryTab);

    // Supported fact badged: "supported fact"
    const supportedFact = screen.getByTestId('replay-summary-statement-0');
    expect(supportedFact.textContent).toContain('File calc.py changed from None to None (modified).');
    expect(supportedFact.textContent).toContain('supported fact');

    // Contradicted summary statement struck through with line-through style and "contradicted" badge
    const contradictedFact = screen.getByTestId('replay-summary-statement-1');
    expect(contradictedFact.textContent).toContain('missing_util.py was added to repository.');
    expect(contradictedFact.textContent).toContain('contradicted');
    const struckText = contradictedFact.querySelector('span[style*="line-through"]');
    expect(struckText).not.toBeNull();
    expect(struckText?.textContent).toContain('missing_util.py was added to repository.');

    // Advance to checkpoint sequence 4 where structured tests are attached
    fireEvent.click(nextBtn); // seq 3
    fireEvent.click(nextBtn); // seq 4

    // Switch to Tests tab
    const testsTab = screen.getByTestId('replay-tab-tests');
    fireEvent.click(testsTab);

    // Assert both content_identity AND controlled_no_write show State matched
    const contentIdentityCard = screen.getByTestId('replay-test-card-test-evidence-failed');
    expect(contentIdentityCard.textContent).toContain('State matched');

    const controlledCard = screen.getByTestId('replay-test-card-test-evidence-pass-controlled');
    expect(controlledCard.textContent).toContain('State matched');

    unmount();
  });

  it('loads real backend-generated V1 active-session export without errors and renders honest empty state', async () => {
    const fixturePath = path.resolve(__dirname, '../../../tests/fixtures/replay/fixture_replay_v1_nomodel.json');
    const rawJson = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = JSON.parse(rawJson);

    // Real active-session export: session.status === 'active'
    expect(parsed.session.status).toBe('active');
    expect(parsed.session.stopped_at).toBeNull();

    const valResult = validateReplayExport(parsed);
    expect(valResult.success).toBe(true);
    expect(valResult.version).toBe('replay-export-1.0');

    const adapter = new ReplayAdapter(valResult.data as ReplayExportDocument, valResult.origin);
    const runs = await adapter.getRuns();
    const summary = runs[0];
    expect(summary.replaySessionStatus).toBe('active');

    render(<ReplayWorkspace adapter={adapter} />);

    // Plain replay chrome avoids status jargon while retaining technical details on demand.
    expect(screen.getByTestId('replay-step-plain-label')).toBeDefined();
    expect(screen.getByTestId('replay-step-details').hasAttribute('open')).toBe(false);

    // Honest empty center state when no file diff is selected
    expect(screen.getByTestId('replay-empty-diff')).toBeDefined();
    expect(screen.getByText('Checkpoint #1 Overview')).toBeDefined();
    expect(screen.getByText(/Model-generated chapters, atomic claims, and likely-reason inferences are not present/)).toBeDefined();
  });
});
