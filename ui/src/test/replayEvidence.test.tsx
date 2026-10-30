import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReplayEvidenceInspector } from '../components/replay/ReplayEvidenceInspector';
import type {
  StepNarration,
  StructuredTestEvidence,
} from '../replay/types';

function createMockNarration(): StepNarration {
  return {
    sequence: 1,
    packet: {
      schema_version: 'replay-evidence-packet-1.0',
      session_id: 'session-ev-1',
      checkpoint_id: 'cp-1',
      sequence: 1,
      before_manifest_id: 'man-1',
      after_manifest_id: 'man-2',
      record_complete: true,
      selection_truncated: false,
      redaction_present: false,
      files: [],
      functions: [],
      sources: [],
      evidence_hash: 'abc',
    },
    claims: {
      schema_version: 'replay-claim-run-1.0',
      final_claims: [
        {
          id: 'claim-supported',
          assertion: {
            predicate: 'file_changed',
            path: 'auth.py',
            before_sha256: 'a'.repeat(64),
            after_sha256: 'b'.repeat(64),
            change: 'modified',
          },
          evidence_refs: ['rec-1'],
          statement: 'auth.py changed from hash-a to hash-b',
        },
        {
          id: 'claim-contradicted',
          assertion: {
            predicate: 'file_changed',
            path: 'missing.py',
            before_sha256: null,
            after_sha256: null,
            change: 'added',
          },
          evidence_refs: ['rec-1'],
          statement: 'missing.py was added to project',
        },
        {
          id: 'claim-unknown',
          assertion: {
            predicate: 'command_exit',
            record_id: 'rec-cmd',
            exit_code: 0,
          },
          evidence_refs: ['rec-cmd'],
          statement: 'pytest reported 10 passing tests',
        },
      ],
      final_source: 'first',
      verdicts: [
        {
          claim_id: 'claim-supported',
          verdict: 'supported',
          reason_code: 'exact_file_fact',
          reason: 'Verified against stored bytes.',
          evidence_refs: ['rec-1'],
          checker_version: 'replay-checker-1.0',
        },
        {
          claim_id: 'claim-contradicted',
          verdict: 'contradicted',
          reason_code: 'complete_path_absence',
          reason: 'File missing.py is absent from manifests.',
          evidence_refs: ['rec-1'],
          checker_version: 'replay-checker-1.0',
        },
        {
          claim_id: 'claim-unknown',
          verdict: 'unsupported_or_unknown',
          reason_code: 'structured_test_report_unavailable',
          reason: 'No structured test report available in recording.',
          evidence_refs: ['rec-cmd'],
          checker_version: 'replay-checker-1.0',
        },
      ],
      fallback_used: false,
      repair_attempts: 0,
      backend: 'local-gguf',
      model: 'qwen2.5-coder-7b',
      latency_ms: 95,
    },
    reason: {
      schema_version: 'replay-reason-run-1.0',
      raw_model_output: '{"text":"Fixed validation exception handler","citations":[]}',
      parsed_reason: { text: 'Fixed validation exception handler', citations: [] },
      checked_reason: {
        label: 'likely reason (model inference)',
        text: 'Fixed validation exception handler',
        citations: [
          {
            citation: {
              source_id: 'prompt-1',
              start: 10,
              end: 45,
              quote: 'fix the token expiration check in auth',
            },
            integrity: 'valid_exact_quote',
            reason_code: 'exact_quote_match',
            source_text: 'Please fix the token expiration check in auth immediately.',
            policy_version: 'citation-policy-1.0',
          },
        ],
        citation_status: 'valid',
        entailment_status: 'not_deterministically_assessed',
        verified_intent: false,
      },
      error: null,
      fallback_used: false,
      backend: 'local-gguf',
      model: 'qwen2.5-coder-7b',
      latency_ms: 70,
    },
    summary_audit: {
      schema_version: 'replay-summary-audit-1.0',
      summary_text: 'auth.py was modified and all tests passed.',
      statements: [
        {
          statement: {
            start: 0,
            end: 20,
            exact_text: 'auth.py was modified',
            claim: {
              id: 'claim-supported',
              assertion: {
                predicate: 'file_changed',
                path: 'auth.py',
                before_sha256: null,
                after_sha256: null,
                change: 'modified',
              },
              evidence_refs: ['rec-1'],
              statement: 'auth.py was modified',
            },
          },
          span_valid: true,
          canonical_mapping_valid: true,
          atomic_boundary_valid: true,
          claim_verdict: {
            claim_id: 'claim-supported',
            verdict: 'supported',
            reason_code: 'exact_file_fact',
            reason: 'Verified',
            evidence_refs: ['rec-1'],
            checker_version: 'replay-checker-1.0',
          },
          display_status: 'supported_recorded_fact',
        },
        {
          statement: {
            start: 25,
            end: 42,
            exact_text: 'all tests passed',
            claim: {
              id: 'claim-tests-pass',
              assertion: {
                predicate: 'command_exit',
                record_id: 'rec-cmd',
                exit_code: 0,
              },
              evidence_refs: [],
              statement: 'all tests passed',
            },
          },
          span_valid: true,
          canonical_mapping_valid: false,
          atomic_boundary_valid: true,
          claim_verdict: null,
          display_status: 'not_supported_by_this_recording',
        },
      ],
      supported_claims: [],
      auditor_version: 'replay-summary-auditor-1.0',
      limitations: [],
    },
  };
}

function createMockTests(): StructuredTestEvidence[] {
  return [
    {
      schema_version: 'replay-store-1.0',
      id: 'test-ev-1',
      session_id: 'session-ev-1',
      observed_at: '2026-10-28T16:05:00Z',
      state: 'fail',
      suite_scope: 'tests/test_auth.py',
      source: 'structured_pytest',
      command_record_id: 'rec-cmd-1',
      command_exit_code: 1,
      associated_manifest_id: 'man-1',
      association: 'content_identity',
      counts: { passed: 4, failed: 1, errors: 0, skipped: 0 },
      tests: [
        {
          node_id: 'tests/test_auth.py::test_expired_token',
          state: 'fail',
          duration_ms: 18,
          error_text: 'TokenExpiredError: Token expired at 160000',
        },
      ],
      output_missing: false,
      partial: false,
    },
    {
      schema_version: 'replay-store-1.0',
      id: 'test-ev-2',
      session_id: 'session-ev-1',
      observed_at: '2026-10-28T16:08:00Z',
      state: 'pass',
      suite_scope: 'tests/test_unverified.py',
      source: 'structured_pytest',
      command_record_id: 'rec-cmd-2',
      command_exit_code: 0,
      associated_manifest_id: null,
      association: 'nearby_in_time_state_unverified',
      counts: { passed: 2, failed: 0, errors: 0, skipped: 0 },
      tests: [],
      output_missing: false,
      partial: false,
    },
  ];
}

describe('ReplayEvidenceInspector (Phase C2)', () => {
  it('renders atomic claims with distinct 3-way verdicts without greenwashing', () => {
    const narration = createMockNarration();
    render(
      <ReplayEvidenceInspector
        narration={narration}
        tests={[]}
        limitations={['No arbitrary shell access']}
        isNarrationOn={true}
      />
    );

    // 1. Supported claim: small neutral label
    expect(screen.getByTestId('replay-claim-item-claim-supported')).toBeDefined();
    expect(screen.getByTestId('replay-claim-verdict-supported').textContent).toContain('checked against recording');

    // 2. Contradicted claim: strikethrough and contradicted verdict
    const contradictedItem = screen.getByTestId('replay-claim-item-claim-contradicted');
    expect(contradictedItem).toBeDefined();
    expect(screen.getByTestId('replay-claim-verdict-contradicted').textContent).toContain('contradicted');
    expect(contradictedItem.querySelector('span[style*="line-through"]')).toBeDefined();

    // 3. Unsupported / unknown claim: explicit yellow plain-language label
    expect(screen.getByTestId('replay-claim-item-claim-unknown')).toBeDefined();
    expect(screen.getByTestId('replay-claim-verdict-unsupported_or_unknown').textContent).toContain('could not check');
  });

  it('renders likely reason with mandatory model inference label and citation status', () => {
    const narration = createMockNarration();
    render(
      <ReplayEvidenceInspector
        narration={narration}
        tests={[]}
        limitations={[]}
        isNarrationOn={true}
      />
    );

    // Mandatory model inference label
    expect(screen.getByTestId('replay-likely-reason-label').textContent).toContain('likely reason (model inference)');
    expect(screen.getByText('Fixed validation exception handler')).toBeDefined();

    // Source quote checked badge
    expect(screen.getByTestId('replay-citation-integrity-label').textContent).toContain('Source quote checked');
    expect(screen.getByText(/"fix the token expiration check in auth"/)).toBeDefined();

    // Disclaimer
    expect(screen.getByText('Entailment: not deterministically assessed')).toBeDefined();
    expect(screen.getByText('verified intent: false')).toBeDefined();
  });

  it('renders nearby tests with state-match vs unverified-state distinctions', () => {
    const tests = createMockTests();
    render(
      <ReplayEvidenceInspector
        narration={null}
        tests={tests}
        limitations={[]}
        isNarrationOn={false}
      />
    );

    // Switch to tests tab
    fireEvent.click(screen.getByTestId('replay-tab-tests'));

    // Test card 1: State matched (hash-verified)
    expect(screen.getByTestId('replay-test-card-test-ev-1')).toBeDefined();
    expect(screen.getByText('State matched (man-1)')).toBeDefined();
    expect(screen.getByText('passed: 4')).toBeDefined();
    expect(screen.getByText('failed: 1')).toBeDefined();

    // Test card 2: nearby in time, code state unverified
    expect(screen.getByTestId('replay-test-card-test-ev-2')).toBeDefined();
    expect(screen.getByText('nearby in time, code state unverified')).toBeDefined();

    // Chronological disclaimer is always present
    expect(screen.getAllByText('Pass/fail is chronological; not verified to be caused or fixed by this edit.').length).toBe(2);
  });

  it('renders summary audit with honest status labels', () => {
    const narration = createMockNarration();
    render(
      <ReplayEvidenceInspector
        narration={narration}
        tests={[]}
        limitations={[]}
        isNarrationOn={true}
      />
    );

    // Switch to summary audit tab
    fireEvent.click(screen.getByTestId('replay-tab-summary'));

    expect(screen.getByText('auth.py was modified and all tests passed.')).toBeDefined();
    expect(screen.getByTestId('replay-summary-statement-0').textContent).toContain('supported');
    expect(screen.getByTestId('replay-summary-statement-1').textContent).toContain('not supported by recording');
  });

  it('renders limits tab with explicit "evaluation pending" badge', () => {
    render(
      <ReplayEvidenceInspector
        narration={null}
        tests={[]}
        limitations={['Private recordings are never uploaded.']}
        isNarrationOn={false}
      />
    );

    fireEvent.click(screen.getByTestId('replay-tab-limitations'));
    expect(screen.getByTestId('replay-eval-status-box').textContent).toContain('evaluation pending');
    expect(screen.getByText('• Private recordings are never uploaded.')).toBeDefined();
  });
});
