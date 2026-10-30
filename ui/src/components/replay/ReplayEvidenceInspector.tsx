import React, { useState } from 'react';
import type {
  StepNarration,
  StructuredTestEvidence,
  ClaimVerdict,
  TypedClaim,
  ReplayRecord,
} from '../../replay/types';
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface ReplayEvidenceInspectorProps {
  narration: StepNarration | null;
  tests: StructuredTestEvidence[];
  limitations: string[];
  isNarrationOn: boolean;
  record?: ReplayRecord | null;
}

export const ReplayEvidenceInspector: React.FC<ReplayEvidenceInspectorProps> = ({
  narration,
  tests,
  limitations,
  isNarrationOn,
  record,
}) => {
  const [activeTab, setActiveTab] = useState<'claims' | 'tests' | 'summary' | 'limitations'>('claims');
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  const claimRun = narration?.claims || null;
  const reasonRun = narration?.reason || null;
  const summaryAudit = narration?.summary_audit || null;
  const visibleTabCount = 2 + (isNarrationOn ? 1 : 0) + (isNarrationOn && summaryAudit ? 1 : 0);

  const rawClaims = claimRun?.final_claims;
  const finalClaims: TypedClaim[] = Array.isArray(rawClaims)
    ? (rawClaims as TypedClaim[])
    : (rawClaims && Array.isArray((rawClaims as any).claims))
    ? ((rawClaims as any).claims as TypedClaim[])
    : [];

  const verdictsByClaimId = new Map<string, ClaimVerdict>();
  if (claimRun) {
    for (const v of claimRun.verdicts) {
      verdictsByClaimId.set(v.claim_id, v);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
        borderLeft: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
        width: '100%',
        minWidth: 0,
        flexShrink: 0,
        overflow: 'hidden',
        color: 'var(--replay-text-primary, #e6edf8)',
      }}
      data-testid="replay-evidence-inspector-pane"
    >
      {/* Inspector Tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${visibleTabCount}, minmax(0, 1fr))`,
          backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          padding: '4px',
          gap: '2px',
          flexShrink: 0,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {isNarrationOn && (
          <button
            onClick={() => setActiveTab('claims')}
            style={{
              minWidth: 0,
              padding: '6px 4px',
              fontSize: '11px',
              fontWeight: activeTab === 'claims' ? 600 : 400,
              backgroundColor: activeTab === 'claims' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
              color: activeTab === 'claims' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
              border: 'none',
              borderRadius: 'var(--replay-radius-control, 7px)',
              cursor: 'pointer',
              transition: 'background-color var(--replay-transition-quick, 160ms ease)',
            }}
            aria-label="View checked claims and inference"
            data-testid="replay-tab-claims"
          >
            Claims & Reason
          </button>
        )}

        <button
          onClick={() => setActiveTab('tests')}
          style={{
            minWidth: 0,
            padding: '6px 4px',
            fontSize: '11px',
            fontWeight: activeTab === 'tests' ? 600 : 400,
            backgroundColor: activeTab === 'tests' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
            color: activeTab === 'tests' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
            border: 'none',
            borderRadius: 'var(--replay-radius-control, 7px)',
            cursor: 'pointer',
            transition: 'background-color var(--replay-transition-quick, 160ms ease)',
          }}
          aria-label="View nearby tests"
          data-testid="replay-tab-tests"
        >
          Nearby Tests ({tests.length})
        </button>

        {isNarrationOn && summaryAudit && (
          <button
            onClick={() => setActiveTab('summary')}
            style={{
              minWidth: 0,
              padding: '6px 4px',
              fontSize: '11px',
              fontWeight: activeTab === 'summary' ? 600 : 400,
              backgroundColor: activeTab === 'summary' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
              color: activeTab === 'summary' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
              border: 'none',
              borderRadius: 'var(--replay-radius-control, 7px)',
              cursor: 'pointer',
              transition: 'background-color var(--replay-transition-quick, 160ms ease)',
            }}
            aria-label="View summary audit"
            data-testid="replay-tab-summary"
          >
            Summary Audit
          </button>
        )}

        <button
          onClick={() => setActiveTab('limitations')}
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            fontWeight: activeTab === 'limitations' ? 600 : 400,
            backgroundColor: activeTab === 'limitations' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
            color: activeTab === 'limitations' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
            border: 'none',
            borderRadius: 'var(--replay-radius-control, 7px)',
            cursor: 'pointer',
            transition: 'background-color var(--replay-transition-quick, 160ms ease)',
          }}
          aria-label="View limitations"
          data-testid="replay-tab-limitations"
        >
          Limits
        </button>
      </div>

      {/* Inspector Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          minHeight: 0,
          minWidth: 0,
          padding: '12px 14px 12px 16px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowWrap: 'anywhere',
        }}
      >
        {record?.provenance === 'history_import' && (
          <div
            data-testid="replay-history-evidence-summary"
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
              fontSize: '10px',
              color: 'var(--replay-text-muted, #8b97ad)',
            }}
          >
            Recorded history evidence
            {record.tool_name ? ` · ${record.tool_name}` : ''}
            {record.file_state === 'unknown' ? ' · file state unknown' : ''}
          </div>
        )}
        {/* Tab 1: Claims & Likely Reason */}
        {activeTab === 'claims' && isNarrationOn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Likely Reason Section */}
            {reasonRun && (
              <div
                style={{
                  backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                  border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                  borderRadius: 'var(--replay-radius-card, 10px)',
                  boxShadow: 'var(--replay-shadow-subtle)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
                data-testid="replay-likely-reason-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 'var(--replay-radius-control, 7px)',
                      backgroundColor: 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                      border: '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                      color: 'var(--replay-text-muted, #8b97ad)',
                    }}
                    data-testid="replay-likely-reason-label"
                  >
                    likely reason (model inference)
                  </span>

                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--replay-text-faint, #4d576a)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {reasonRun.model || 'model'}
                  </span>
                </div>

                {reasonRun.checked_reason ? (
                  <>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--replay-text-primary, #e6edf8)', lineHeight: '1.5' }}>
                      {reasonRun.checked_reason.text}
                    </p>

                    {/* Citations */}
                    {reasonRun.checked_reason.citations.length > 0 && (
                      <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--replay-text-muted, #8b97ad)', fontWeight: 600 }}>
                          CITATIONS
                        </span>
                        {reasonRun.checked_reason.citations.map((c, idx) => (
                          <div
                            key={idx}
                            style={{
                              fontSize: '10px',
                              padding: '4px 8px',
                              borderRadius: 'var(--replay-radius-control, 7px)',
                              backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
                              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--replay-text-muted, #8b97ad)' }}>
                                source:{c.citation.source_id} [{c.citation.start}..{c.citation.end}]
                              </span>
                              {(() => {
                                const isValidQuote = c.integrity === 'valid_exact_quote' || c.integrity === ('verified' as any);
                                return (
                                  <span
                                    style={{
                                      fontSize: '9px',
                                      padding: '1px 5px',
                                      borderRadius: 'var(--replay-radius-control, 7px)',
                                      backgroundColor:
                                        isValidQuote
                                          ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                                          : 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))',
                                      color: isValidQuote ? 'var(--replay-status-complete, #4a7bb0)' : 'var(--replay-status-warning, #946c32)',
                                      border:
                                        isValidQuote
                                          ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                                          : '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
                                    }}
                                    data-testid="replay-citation-integrity-label"
                                  >
                                    {isValidQuote ? 'Source quote checked' : c.integrity}
                                  </span>
                                );
                              })()}
                            </div>
                            <div style={{ color: 'var(--replay-text-primary, #e6edf8)', fontStyle: 'italic' }}>
                              "{c.citation.quote}"
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: '10px',
                        color: 'var(--replay-text-faint, #4d576a)',
                        borderTop: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                        paddingTop: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Entailment: not deterministically assessed</span>
                      <span title="The checker verified source quote integrity only; it does not certify agent intent.">
                        verified intent: false
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--replay-text-muted, #8b97ad)' }}>
                    {reasonRun.error || 'Model did not generate a valid reason proposal.'}
                  </div>
                )}
              </div>
            )}

            {/* Atomic Checked Claims */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
                  CHECKED CLAIMS ({finalClaims.length})
                </span>
                {claimRun && (
                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--replay-text-faint, #4d576a)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    source: {claimRun.final_source}
                  </span>
                )}
              </div>

              {(!claimRun || finalClaims.length === 0) && (
                <div style={{ fontSize: '11px', color: 'var(--replay-text-muted, #8b97ad)', padding: '12px 0' }}>
                  No atomic claims recorded for this step.
                </div>
              )}

              {finalClaims.map((claim) => {
                const verdict = verdictsByClaimId.get(claim.id);
                const isContradicted = verdict?.verdict === 'contradicted';
                const isSupported = verdict?.verdict === 'supported';
                const isExpanded = expandedClaimId === claim.id;

                return (
                  <div
                    key={claim.id}
                    style={{
                      backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                      border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                      borderRadius: 'var(--replay-radius-card, 10px)',
                      boxShadow: 'var(--replay-shadow-subtle)',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                    data-testid={`replay-claim-item-${claim.id}`}
                  >
                    {/* Raw claim statement */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          color: isContradicted ? 'var(--replay-text-faint, #4d576a)' : 'var(--replay-text-primary, #e6edf8)',
                          textDecoration: isContradicted ? 'line-through' : 'none',
                          lineHeight: '1.4',
                          flex: 1,
                        }}
                      >
                        {claim.statement || JSON.stringify(claim.assertion)}
                      </span>

                      {/* 3-way verdict badge (never color-alone; explicit plain labels) */}
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          flexShrink: 0,
                          backgroundColor: isSupported
                            ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                            : isContradicted
                            ? 'var(--replay-status-danger-bg, rgba(156, 68, 68, 0.12))'
                            : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                          border: isSupported
                            ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                            : isContradicted
                            ? '1px solid var(--replay-status-danger-border, rgba(156, 68, 68, 0.30))'
                            : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                          color: isSupported
                            ? 'var(--replay-status-complete, #4a7bb0)'
                            : isContradicted
                            ? 'var(--replay-status-danger, #9c4444)'
                            : 'var(--replay-text-muted, #8b97ad)',
                        }}
                        data-testid={`replay-claim-verdict-${verdict?.verdict || 'unknown'}`}
                      >
                        {isSupported
                          ? 'checked against recording'
                          : isContradicted
                          ? 'contradicted'
                          : 'unsupported / unknown'}
                      </span>
                    </div>

                    {/* Verdict Reason & Counterevidence */}
                    {verdict && (
                      <div
                        style={{
                          fontSize: '10px',
                          color: isContradicted ? 'var(--replay-status-danger, #9c4444)' : 'var(--replay-text-muted, #8b97ad)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <span>
                          reason: {verdict.reason_code} — {verdict.reason}
                        </span>
                        <button
                          onClick={() => setExpandedClaimId(isExpanded ? null : claim.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--replay-accent, #4a7bb0)',
                            fontSize: '9px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                          }}
                        >
                          {isExpanded ? 'Less' : 'Evidence'}
                          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </button>
                      </div>
                    )}

                    {/* Expanded claim evidence details */}
                    {isExpanded && verdict && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '6px 8px',
                          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
                          border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--replay-text-primary, #e6edf8)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                        data-testid={`replay-claim-expanded-${claim.id}`}
                      >
                        <div>Predicate: {claim.assertion.predicate}</div>
                        <div>Evidence refs: {verdict.evidence_refs.join(', ')}</div>
                        <div>Checker: {verdict.checker_version}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Tests Before / After / Nearby */}
        {activeTab === 'tests' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
                RECORDED TESTS
              </span>
              <span style={{ fontSize: '10px', color: 'var(--replay-text-faint, #4d576a)' }}>
                {tests.length} observation{tests.length !== 1 ? 's' : ''}
              </span>
            </div>

            {tests.length === 0 ? (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--replay-text-muted, #8b97ad)',
                  padding: '16px',
                  backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                  border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                  borderRadius: 'var(--replay-radius-card, 10px)',
                  textAlign: 'center',
                }}
                data-testid="replay-no-tests-label"
              >
                No test evidence recorded at this checkpoint (not observed).
              </div>
            ) : (
              tests.map((testItem) => {
                const isFail = testItem.state === 'fail' || testItem.state === 'error';
                const isPass = testItem.state === 'pass';
                const isMatched =
                  testItem.association === 'content_identity' ||
                  testItem.association === 'controlled_no_write' ||
                  testItem.association === ('validated_interval' as any);

                const stateMatchLabel = isMatched
                  ? `State matched (${testItem.associated_manifest_id?.slice(0, 10)})`
                  : testItem.association === 'nearby_in_time_state_unverified'
                  ? 'nearby in time, code state unverified'
                  : testItem.association === 'none'
                  ? 'unassociated'
                  : String(testItem.association);

                return (
                  <div
                    key={testItem.id}
                    style={{
                      backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                      border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                      borderRadius: 'var(--replay-radius-card, 10px)',
                      boxShadow: 'var(--replay-shadow-subtle)',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                    data-testid={`replay-test-card-${testItem.id}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--replay-text-primary, #e6edf8)' }}>
                        {testItem.suite_scope}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          backgroundColor: isFail
                            ? 'var(--replay-status-danger-bg, rgba(156, 68, 68, 0.12))'
                            : isPass
                            ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                            : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                          border: isFail
                            ? '1px solid var(--replay-status-danger-border, rgba(156, 68, 68, 0.30))'
                            : isPass
                            ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                            : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                          color: isFail ? 'var(--replay-status-danger, #9c4444)' : isPass ? 'var(--replay-status-complete, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
                        }}
                        data-testid="replay-test-state-badge"
                      >
                        {testItem.state.toUpperCase()}
                      </span>
                    </div>

                    {/* State match label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          backgroundColor: isMatched ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))' : 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))',
                          color: isMatched ? 'var(--replay-status-complete, #4a7bb0)' : 'var(--replay-status-warning, #946c32)',
                          border: isMatched ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))' : '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
                        }}
                        data-testid="replay-state-match-badge"
                      >
                        {stateMatchLabel}
                      </span>
                    </div>

                    {/* Structured Counts if present */}
                    {testItem.counts && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono, monospace)',
                          padding: '4px 8px',
                          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
                          border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                        }}
                      >
                        <span style={{ color: 'var(--replay-status-complete, #4a7bb0)' }}>passed: {testItem.counts.passed ?? 0}</span>
                        <span style={{ color: 'var(--replay-status-danger, #9c4444)' }}>failed: {testItem.counts.failed ?? 0}</span>
                        <span style={{ color: 'var(--replay-status-warning, #946c32)' }}>errors: {testItem.counts.errors ?? 0}</span>
                        <span style={{ color: 'var(--replay-text-faint, #4d576a)' }}>skipped: {testItem.counts.skipped ?? 0}</span>
                      </div>
                    )}

                    {/* Individual test nodes */}
                    {testItem.tests && testItem.tests.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {testItem.tests.map((ind) => (
                          <div
                            key={ind.node_id}
                            style={{
                              fontSize: '10px',
                              fontFamily: 'var(--font-mono, monospace)',
                              padding: '4px 6px',
                              backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
                              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                              borderRadius: 'var(--replay-radius-control, 7px)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: ind.state === 'fail' ? 'var(--replay-status-danger, #9c4444)' : 'var(--replay-status-complete, #4a7bb0)' }}>
                              <span>{ind.node_id}</span>
                              <span>{ind.state}</span>
                            </div>
                            {ind.error_text && (
                              <div style={{ marginTop: '2px', color: 'var(--replay-status-danger, #9c4444)', whiteSpace: 'pre-wrap' }}>
                                {ind.error_text}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: '9px', color: 'var(--replay-text-faint, #4d576a)', fontStyle: 'italic' }}>
                      Pass/fail is chronological; not verified to be caused or fixed by this edit.
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 3: Summary Audit */}
        {activeTab === 'summary' && summaryAudit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="replay-summary-audit-pane">
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
              SUMMARY AUDIT
            </span>

            <div
              style={{
                padding: '10px',
                backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                borderRadius: 'var(--replay-radius-card, 10px)',
                border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                boxShadow: 'var(--replay-shadow-subtle)',
                fontSize: '12px',
                lineHeight: '1.5',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--replay-text-muted, #8b97ad)', fontSize: '10px' }}>
                ORIGINAL AGENT SUMMARY
              </div>
              <p style={{ margin: 0, color: 'var(--replay-text-primary, #e6edf8)' }}>{summaryAudit.summary_text}</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
                AUDITED STATEMENTS ({summaryAudit.statements.length})
              </span>

              {summaryAudit.statements.map((s, idx) => {
                const isSupported =
                  s.display_status === 'supported_recorded_fact' ||
                  s.display_status === ('supported' as any);
                const isContradicted =
                  s.display_status === 'contradicted_by_complete_recording' ||
                  s.display_status === ('contradicted' as any);
                const isNotSupported =
                  s.display_status === 'not_supported_by_this_recording';

                const displayStatusLabel = isSupported
                  ? 'supported fact'
                  : isContradicted
                  ? 'contradicted'
                  : isNotSupported
                  ? 'not supported by recording'
                  : String(s.display_status);

                return (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 10px',
                      backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                      border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                      borderRadius: 'var(--replay-radius-card, 10px)',
                      boxShadow: 'var(--replay-shadow-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                    data-testid={`replay-summary-statement-${idx}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          color: isContradicted ? 'var(--replay-text-faint, #4d576a)' : 'var(--replay-text-primary, #e6edf8)',
                          textDecoration: isContradicted ? 'line-through' : 'none',
                          flex: 1,
                        }}
                      >
                        "{s.statement.exact_text}"
                      </span>

                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          backgroundColor: isSupported
                            ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                            : isContradicted
                            ? 'var(--replay-status-danger-bg, rgba(156, 68, 68, 0.12))'
                            : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                          border: isSupported
                            ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                            : isContradicted
                            ? '1px solid var(--replay-status-danger-border, rgba(156, 68, 68, 0.30))'
                            : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                          color: isSupported
                            ? 'var(--replay-status-complete, #4a7bb0)'
                            : isContradicted
                            ? 'var(--replay-status-danger, #9c4444)'
                            : 'var(--replay-text-muted, #8b97ad)',
                        }}
                        data-testid={`replay-summary-statement-badge-${s.display_status}`}
                      >
                        {displayStatusLabel}
                      </span>
                    </div>

                    <div style={{ fontSize: '9px', color: 'var(--replay-text-faint, #4d576a)' }}>
                      Predicate: {s.statement.claim.assertion.predicate} • Atomic boundary: {s.atomic_boundary_valid ? 'valid' : 'invalid'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 4: Limitations & Evaluation Gate */}
        {activeTab === 'limitations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
                EVALUATION GATE STATUS
              </span>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--replay-radius-card, 10px)',
                  backgroundColor: 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))',
                  border: '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
                  fontSize: '11px',
                  color: 'var(--replay-status-warning, #946c32)',
                }}
                data-testid="replay-eval-status-box"
              >
                <strong>Evaluation status:</strong> evaluation pending
                <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--replay-text-muted, #8b97ad)' }}>
                  Gates are evaluated against frozen evaluation assets. No hardcoded success or fit claims.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--replay-text-muted, #8b97ad)' }}>
                RECORDING LIMITATIONS ({limitations.length})
              </span>
              {limitations.map((lim, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--replay-radius-control, 7px)',
                    backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                    border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                    fontSize: '11px',
                    color: 'var(--replay-text-muted, #8b97ad)',
                    lineHeight: '1.4',
                  }}
                >
                  • {lim}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
