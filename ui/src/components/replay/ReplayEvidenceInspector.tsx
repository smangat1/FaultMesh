import React, { useState } from 'react';
import type {
  StepNarration,
  StructuredTestEvidence,
  ClaimVerdict,
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
}

export const ReplayEvidenceInspector: React.FC<ReplayEvidenceInspectorProps> = ({
  narration,
  tests,
  limitations,
  isNarrationOn,
}) => {
  const [activeTab, setActiveTab] = useState<'claims' | 'tests' | 'summary' | 'limitations'>('claims');
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  const claimRun = narration?.claims || null;
  const reasonRun = narration?.reason || null;
  const summaryAudit = narration?.summary_audit || null;

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
        backgroundColor: '#13151b',
        borderLeft: '1px solid #232730',
        width: '360px',
        flexShrink: 0,
        overflow: 'hidden',
        color: '#f8fafc',
      }}
      data-testid="replay-evidence-inspector-pane"
    >
      {/* Inspector Tabs */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#161920',
          borderBottom: '1px solid #232730',
          padding: '4px',
          gap: '2px',
          flexShrink: 0,
        }}
      >
        {isNarrationOn && (
          <button
            onClick={() => setActiveTab('claims')}
            style={{
              flex: 1,
              padding: '6px 4px',
              fontSize: '11px',
              fontWeight: activeTab === 'claims' ? 600 : 400,
              backgroundColor: activeTab === 'claims' ? '#232730' : 'transparent',
              color: activeTab === 'claims' ? '#f8fafc' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
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
            flex: 1,
            padding: '6px 4px',
            fontSize: '11px',
            fontWeight: activeTab === 'tests' ? 600 : 400,
            backgroundColor: activeTab === 'tests' ? '#232730' : 'transparent',
            color: activeTab === 'tests' ? '#f8fafc' : 'var(--text-muted)',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
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
              flex: 1,
              padding: '6px 4px',
              fontSize: '11px',
              fontWeight: activeTab === 'summary' ? 600 : 400,
              backgroundColor: activeTab === 'summary' ? '#232730' : 'transparent',
              color: activeTab === 'summary' ? '#f8fafc' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
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
            backgroundColor: activeTab === 'limitations' ? '#232730' : 'transparent',
            color: activeTab === 'limitations' ? '#f8fafc' : 'var(--text-muted)',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
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
          minHeight: 0,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Tab 1: Claims & Likely Reason */}
        {activeTab === 'claims' && isNarrationOn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Likely Reason Section */}
            {reasonRun && (
              <div
                style={{
                  backgroundColor: '#181b22',
                  border: '1px solid #282d38',
                  borderRadius: '6px',
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
                      borderRadius: '3px',
                      backgroundColor: 'rgba(168, 85, 247, 0.15)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      color: '#c084fc',
                    }}
                    data-testid="replay-likely-reason-label"
                  >
                    likely reason (model inference)
                  </span>

                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {reasonRun.model || 'model'}
                  </span>
                </div>

                {reasonRun.checked_reason ? (
                  <>
                    <p style={{ margin: 0, fontSize: '12px', color: '#f8fafc', lineHeight: '1.5' }}>
                      {reasonRun.checked_reason.text}
                    </p>

                    {/* Citations */}
                    {reasonRun.checked_reason.citations.length > 0 && (
                      <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                          CITATIONS
                        </span>
                        {reasonRun.checked_reason.citations.map((c, idx) => (
                          <div
                            key={idx}
                            style={{
                              fontSize: '10px',
                              padding: '4px 8px',
                              borderRadius: '3px',
                              backgroundColor: 'rgba(255, 255, 255, 0.03)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#94a3b8' }}>
                                source:{c.citation.source_id} [{c.citation.start}..{c.citation.end}]
                              </span>
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 4px',
                                  borderRadius: '2px',
                                  backgroundColor:
                                    c.integrity === 'verified'
                                      ? 'rgba(56, 189, 248, 0.15)'
                                      : 'rgba(245, 158, 11, 0.15)',
                                  color: c.integrity === 'verified' ? '#38bdf8' : '#fbbf24',
                                }}
                                data-testid="replay-citation-integrity-label"
                              >
                                {c.integrity === 'verified' ? 'Source quote checked' : c.integrity}
                              </span>
                            </div>
                            <div style={{ color: '#cbd5e1', fontStyle: 'italic' }}>
                              "{c.citation.quote}"
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
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
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {reasonRun.error || 'Model did not generate a valid reason proposal.'}
                  </div>
                )}
              </div>
            )}

            {/* Atomic Checked Claims */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  CHECKED CLAIMS ({claimRun?.final_claims.length || 0})
                </span>
                {claimRun && (
                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    source: {claimRun.final_source}
                  </span>
                )}
              </div>

              {(!claimRun || claimRun.final_claims.length === 0) && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '12px 0' }}>
                  No atomic claims recorded for this step.
                </div>
              )}

              {claimRun?.final_claims.map((claim) => {
                const verdict = verdictsByClaimId.get(claim.id);
                const isContradicted = verdict?.verdict === 'contradicted';
                const isSupported = verdict?.verdict === 'supported';
                const isExpanded = expandedClaimId === claim.id;

                return (
                  <div
                    key={claim.id}
                    style={{
                      backgroundColor: '#181b22',
                      border: '1px solid #282d38',
                      borderRadius: '5px',
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
                          color: isContradicted ? '#94a3b8' : '#f8fafc',
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
                          borderRadius: '3px',
                          flexShrink: 0,
                          backgroundColor: isSupported
                            ? 'rgba(56, 189, 248, 0.15)'
                            : isContradicted
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                          border: isSupported
                            ? '1px solid rgba(56, 189, 248, 0.3)'
                            : isContradicted
                            ? '1px solid rgba(239, 68, 68, 0.3)'
                            : '1px solid rgba(148, 163, 184, 0.25)',
                          color: isSupported
                            ? '#38bdf8'
                            : isContradicted
                            ? '#f87171'
                            : '#94a3b8',
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
                          color: isContradicted ? '#fca5a5' : 'var(--text-muted)',
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
                            color: '#38bdf8',
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
                          backgroundColor: '#111318',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: '#cbd5e1',
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
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                RECORDED TESTS
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {tests.length} observation{tests.length !== 1 ? 's' : ''}
              </span>
            </div>

            {tests.length === 0 ? (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  padding: '16px',
                  backgroundColor: '#181b22',
                  borderRadius: '6px',
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
                const isMatched = testItem.association === 'content_identity' || testItem.association === 'validated_interval';

                return (
                  <div
                    key={testItem.id}
                    style={{
                      backgroundColor: '#181b22',
                      border: '1px solid #282d38',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                    data-testid={`replay-test-card-${testItem.id}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
                        {testItem.suite_scope}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '3px',
                          backgroundColor: isFail
                            ? 'rgba(239, 68, 68, 0.15)'
                            : isPass
                            ? 'rgba(34, 197, 94, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                          border: isFail
                            ? '1px solid rgba(239, 68, 68, 0.3)'
                            : isPass
                            ? '1px solid rgba(34, 197, 94, 0.3)'
                            : '1px solid rgba(148, 163, 184, 0.25)',
                          color: isFail ? '#f87171' : isPass ? '#4ade80' : '#94a3b8',
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
                          borderRadius: '3px',
                          backgroundColor: isMatched ? 'rgba(56, 189, 248, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          color: isMatched ? '#38bdf8' : '#fbbf24',
                          border: isMatched ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(245, 158, 11, 0.25)',
                        }}
                        data-testid="replay-state-match-badge"
                      >
                        {isMatched
                          ? `State matched (${testItem.associated_manifest_id?.slice(0, 10)})`
                          : 'nearby in time, code state unverified'}
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
                          backgroundColor: '#111318',
                          borderRadius: '4px',
                        }}
                      >
                        <span style={{ color: '#4ade80' }}>passed: {testItem.counts.passed ?? 0}</span>
                        <span style={{ color: '#f87171' }}>failed: {testItem.counts.failed ?? 0}</span>
                        <span style={{ color: '#fbbf24' }}>errors: {testItem.counts.errors ?? 0}</span>
                        <span style={{ color: '#94a3b8' }}>skipped: {testItem.counts.skipped ?? 0}</span>
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
                              backgroundColor: '#111318',
                              borderRadius: '3px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: ind.state === 'fail' ? '#f87171' : '#4ade80' }}>
                              <span>{ind.node_id}</span>
                              <span>{ind.state}</span>
                            </div>
                            {ind.error_text && (
                              <div style={{ marginTop: '2px', color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
                                {ind.error_text}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
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
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              SUMMARY AUDIT
            </span>

            <div
              style={{
                padding: '10px',
                backgroundColor: '#181b22',
                borderRadius: '5px',
                border: '1px solid #282d38',
                fontSize: '12px',
                lineHeight: '1.5',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '10px' }}>
                ORIGINAL AGENT SUMMARY
              </div>
              <p style={{ margin: 0, color: '#f8fafc' }}>{summaryAudit.summary_text}</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}>
                AUDITED STATEMENTS ({summaryAudit.statements.length})
              </span>

              {summaryAudit.statements.map((s, idx) => {
                const isContradicted = s.display_status === 'contradicted';
                const isSupported = s.display_status === 'supported';

                return (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 10px',
                      backgroundColor: '#181b22',
                      border: '1px solid #282d38',
                      borderRadius: '4px',
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
                          color: isContradicted ? '#94a3b8' : '#f8fafc',
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
                          borderRadius: '2px',
                          backgroundColor: isSupported
                            ? 'rgba(56, 189, 248, 0.15)'
                            : isContradicted
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                          color: isSupported
                            ? '#38bdf8'
                            : isContradicted
                            ? '#f87171'
                            : '#94a3b8',
                        }}
                      >
                        {s.display_status}
                      </span>
                    </div>

                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
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
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                EVALUATION GATE STATUS
              </span>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '5px',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  fontSize: '11px',
                  color: '#fbbf24',
                }}
                data-testid="replay-eval-status-box"
              >
                <strong>Evaluation status:</strong> evaluation pending
                <div style={{ marginTop: '4px', fontSize: '10px', color: '#fde68a' }}>
                  Gates are evaluated against frozen evaluation assets. No hardcoded success or fit claims.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                RECORDING LIMITATIONS ({limitations.length})
              </span>
              {limitations.map((lim, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    backgroundColor: '#181b22',
                    border: '1px solid #282d38',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
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
