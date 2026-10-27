import React from 'react';
import type { RunSummary } from '../types';
import type { FaultMeshAdapter } from '../adapter';
import { ImportedAdapter } from '../adapter/importedAdapter';
import type { V2RunEvidenceExport } from '../import';
import {
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Fingerprint,
  Shield,
  Layers,
} from 'lucide-react';
import { formatDurationMs } from '../utils/format';

interface ReplayComparisonViewProps {
  activeRun: RunSummary | null;
  runs: RunSummary[];
  adapter: FaultMeshAdapter;
  onSelectRun?: (runId: string) => void;
  onSelectTest?: (testId: string | null) => void;
}

export const ReplayComparisonView: React.FC<ReplayComparisonViewProps> = ({
  activeRun,
  runs,
  adapter,
  onSelectRun,
}) => {
  if (!activeRun) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        No run selected.
      </div>
    );
  }

  // Look for replay provenance on the active run, or find a child replay run in runs
  const replayProv =
    activeRun.replayProvenance ||
    runs.find((r) => r.replayProvenance?.parent_run_id === activeRun.id)?.replayProvenance;

  const parentRunId = replayProv?.parent_run_id;
  const parentSummary = parentRunId ? runs.find((r) => r.id === parentRunId) : null;

  // Retrieve raw V2 export documents if available on ImportedAdapter
  let parentDoc: V2RunEvidenceExport | null = null;
  let replayDoc: V2RunEvidenceExport | null = null;

  if (adapter instanceof ImportedAdapter) {
    const v2Runs = adapter.getV2Runs();
    if (parentRunId) {
      parentDoc = v2Runs.find((r) => r.run.id === parentRunId) || null;
    }
    const replayRunId = activeRun.replayProvenance ? activeRun.id : runs.find((r) => r.replayProvenance)?.id;
    if (replayRunId) {
      replayDoc = v2Runs.find((r) => r.run.id === replayRunId) || null;
    }
  }

  // Extract tests and failure outputs
  const replayTest = replayDoc?.tests.find((t) => t.node_id === replayProv?.parent_test_id) || replayDoc?.tests[0];
  const parentTest = parentDoc?.tests.find((t) => t.node_id === replayProv?.parent_test_id) || parentDoc?.tests.find((t) => t.outcome === 'FAILED');

  const replayFingerprint = replayTest?.failure_fingerprint || null;
  const parentFingerprint = replayProv?.original_failure_fingerprint || parentTest?.failure_fingerprint || null;
  const fingerprintsMatch = Boolean(replayFingerprint && parentFingerprint && replayFingerprint === parentFingerprint);

  // Symbol sets
  const parentSymbols = new Set(parentTest?.observation?.symbols?.map((s) => `${s.path}::${s.qualified_name}`) || []);
  const replaySymbols = new Set(replayTest?.observation?.symbols?.map((s) => `${s.path}::${s.qualified_name}`) || []);

  const commonSymbols = Array.from(parentSymbols).filter((s) => replaySymbols.has(s));
  const parentOnlySymbols = Array.from(parentSymbols).filter((s) => !replaySymbols.has(s));
  const replayOnlySymbols = Array.from(replaySymbols).filter((s) => !parentSymbols.has(s));

  const comparison = replayProv?.comparison || 'SAME_FAILURE';

  return (
    <div
      style={{
        padding: '24px',
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        overflowY: 'auto',
        height: '100%',
        color: 'var(--text-primary)',
      }}
    >
      {/* Title & Provenance Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
                Recorded Replay Run Comparison
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor:
                    comparison === 'SAME_FAILURE'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : comparison === 'PASSED_ON_REPLAY'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(147, 51, 234, 0.15)',
                  color:
                    comparison === 'SAME_FAILURE'
                      ? '#fca5a5'
                      : comparison === 'PASSED_ON_REPLAY'
                      ? '#6ee7b7'
                      : '#d8b4fe',
                  border:
                    comparison === 'SAME_FAILURE'
                      ? '1px solid rgba(239, 68, 68, 0.35)'
                      : comparison === 'PASSED_ON_REPLAY'
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(147, 51, 234, 0.35)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {comparison}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
              Comparison of isolated container runs on matching source revision. Never speculates causality.
            </p>
          </div>

          {/* Run Switcher Shortcuts */}
          {parentSummary && onSelectRun && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={() => onSelectRun(parentSummary.id)}
                className={activeRun.id === parentSummary.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                View Parent Run ({parentSummary.id.slice(0, 8)})
              </button>
              {activeRun.replayProvenance && (
                <button
                  onClick={() => onSelectRun(activeRun.id)}
                  className={activeRun.id !== parentSummary.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                >
                  View Replay Run ({activeRun.id.slice(0, 8)})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Provenance Details Pill */}
        <div
          style={{
            backgroundColor: '#111622',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Target Test: </span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>
              {replayProv?.parent_test_id || 'N/A'}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Parent Run: </span>
            <span style={{ color: '#94a3b8' }}>{parentRunId || 'N/A'}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Replay Run: </span>
            <span style={{ color: '#38bdf8' }}>{replayDoc?.run.id || activeRun.id}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Comparison Outcome: </span>
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>{comparison}</span>
          </div>
        </div>
      </div>

      {/* Side-by-Side Run Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Parent Run Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Parent Run
              </span>
              <span className={`badge-status ${parentSummary?.status === 'failed' || parentDoc?.run.outcome === 'FAILED' ? 'fail' : 'pass'}`}>
                {parentDoc?.run.outcome || parentSummary?.status.toUpperCase() || 'FAILED'}
              </span>
            </div>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {parentRunId || 'Not Loaded'}
            </span>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GitBranch size={12} />
              <span>
                Revision:{' '}
                {parentDoc?.source_snapshot?.revision?.slice(0, 7) ||
                  parentDoc?.run.target?.revision?.slice(0, 7) ||
                  activeRun.gitRevision.slice(0, 7)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={12} />
              <span>Duration: {formatDurationMs(parentDoc?.run.duration_ms ?? parentSummary?.durationMs ?? 0)}</span>
            </div>
            <div>
              <span>Tests: {parentDoc?.tests.length ?? parentSummary?.stats.totalTests ?? 'N/A'} total</span>
            </div>
          </div>

          {!parentDoc && (
            <div
              style={{
                backgroundColor: 'rgba(100, 116, 139, 0.1)',
                border: '1px dashed rgba(100, 116, 139, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              Parent run JSON export not loaded; displaying recorded parent fingerprint and comparison outcome.
            </div>
          )}
        </div>

        {/* Replay Run Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#38bdf8' }}>
                Replay Run
              </span>
              <span className={`badge-status ${replayDoc?.run.outcome === 'FAILED' ? 'fail' : 'pass'}`}>
                {replayDoc?.run.outcome || 'FAILED'}
              </span>
            </div>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {replayDoc?.run.id || activeRun.id}
            </span>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GitBranch size={12} />
              <span>
                Revision:{' '}
                {replayDoc?.source_snapshot?.revision?.slice(0, 7) ||
                  replayDoc?.run.target?.revision?.slice(0, 7) ||
                  activeRun.gitRevision.slice(0, 7)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={12} />
              <span>Duration: {formatDurationMs(replayDoc?.run.duration_ms ?? activeRun.durationMs)}</span>
            </div>
            <div>
              <span>Tests: {replayDoc?.tests.length ?? 1} total (focused replay)</span>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              fontSize: '11px',
              color: '#7dd3fc',
            }}
          >
            Targeted re-execution of single failure in clean container.
          </div>
        </div>
      </div>

      {/* Failure Fingerprints Comparison Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
            <Fingerprint size={14} color="#38bdf8" />
            Failure Fingerprint Comparison (SHA-256)
          </div>
          {fingerprintsMatch ? (
            <span style={{ fontSize: '11px', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
              <CheckCircle2 size={13} />
              Identical Fingerprint Recurred
            </span>
          ) : (
            <span style={{ fontSize: '11px', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
              <AlertTriangle size={13} />
              Fingerprints Differ or Unresolved
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#0d1117', borderRadius: 'var(--radius-sm)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Parent Run Fingerprint:</span>
            <code style={{ color: '#94a3b8' }}>{parentFingerprint || 'Not provided'}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#0d1117', borderRadius: 'var(--radius-sm)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Replay Run Fingerprint:</span>
            <code style={{ color: '#38bdf8' }}>{replayFingerprint || 'Not provided'}</code>
          </div>
        </div>
      </div>

      {/* Side-by-Side Failure Text Output */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '16px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <XCircle size={14} color="#ef4444" />
          Raw Bounded Failure Text Output Side-by-Side
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Parent Failure Text */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Parent Failure Output ({parentRunId || 'recorded'})
            </div>
            <pre
              style={{
                backgroundColor: '#0a0d14',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: '1.4',
                maxHeight: '320px',
                overflow: 'auto',
                color: '#f8fafc',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {parentTest?.failure_text || (parentRunId ? 'No failure recorded for parent run' : 'Parent export not loaded')}
            </pre>
          </div>

          {/* Replay Failure Text */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8', marginBottom: '6px' }}>
              Replay Failure Output ({replayDoc?.run.id || activeRun.id})
            </div>
            <pre
              style={{
                backgroundColor: '#0a0d14',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: '1.4',
                maxHeight: '320px',
                overflow: 'auto',
                color: '#f8fafc',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {replayTest?.failure_text || 'No failure text in replay export'}
            </pre>
          </div>
        </div>
      </div>

      {/* Observed Executed Symbol Sets Comparison */}
      {(parentSymbols.size > 0 || replaySymbols.size > 0) && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={14} color="#38bdf8" />
            Observed Executed Symbol Sets Comparison
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '12px',
            }}
          >
            {/* Common Symbols */}
            <div style={{ padding: '10px 12px', backgroundColor: '#0e1726', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8', marginBottom: '6px' }}>
                Executed in Both Runs ({commonSymbols.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {commonSymbols.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>

            {/* Parent Only */}
            {parentOnlySymbols.length > 0 && (
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Parent Only ({parentOnlySymbols.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {parentOnlySymbols.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Replay Only */}
            {replayOnlySymbols.length > 0 && (
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>
                  Replay Only ({replayOnlySymbols.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#fbbf24' }}>
                  {replayOnlySymbols.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rule 3 Demarcation: Honest Provenance Note */}
      <div className="notice-honest">
        <Shield size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong>Strict Replay Provenance:</strong> This comparison reflects deterministic re-execution of a failed pytest test case in a clean container against the recorded source snapshot. A matching fingerprint proves recurrence of that exact failure; it does not claim to diagnose root cause, verify a fix, or make assertions beyond the recorded execution boundaries.
        </div>
      </div>
    </div>
  );
};
