import React from 'react';
import type { RunSummary, GraphData } from '../types';
import {
  AlertTriangle,
  GitBranch,
  Clock,
  Activity,
  FileCode,
  ShieldAlert,
} from 'lucide-react';
import { formatDurationMs } from '../utils/format';

interface RunDiagnosticsPaneProps {
  activeRun: RunSummary | null;
  graphData: GraphData;
}

export const RunDiagnosticsPane: React.FC<RunDiagnosticsPaneProps> = ({
  activeRun,
  graphData,
}) => {
  if (!activeRun) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        No run selected.
      </div>
    );
  }

  const isFailed = activeRun.status === 'failed';
  const isEmpty = activeRun.status === 'empty';

  return (
    <div
      style={{
        padding: '24px',
        maxWidth: '960px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {/* Title & Metadata */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {activeRun.project}
          </span>
          <span className={`badge-status ${isFailed ? 'error' : isEmpty ? 'skipped' : 'pass'}`}>
            {activeRun.status.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            marginTop: '4px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <GitBranch size={13} /> {activeRun.gitBranch} @ <span>{activeRun.gitRevision}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={13} /> {formatDurationMs(activeRun.durationMs)} duration
          </span>
          <span>Commit: "{activeRun.commitMessage}"</span>
        </div>
      </div>

      {/* Harness Failure Message (if collection phase failed) */}
      {activeRun.errorMessage && (
        <div
          style={{
            backgroundColor: 'var(--status-error-bg)',
            border: '1px solid var(--status-error-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--status-error)',
              marginBottom: '6px',
            }}
          >
            <ShieldAlert size={14} />
            Test Runner Error (Collection Phase)
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-primary)',
              lineHeight: '1.5',
            }}
          >
            {activeRun.errorMessage}
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            Remediation: Verify required test dependencies and mock harnesses are configured for this target revision.
          </div>
        </div>
      )}

      {/* Empty State Diagnostic */}
      {isEmpty && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <FileCode size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Empty Scan State</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto' }}>
            No pytest test cases were detected in the target repository using pattern `test_*.py` or `*_test.py`.
            Static AST analysis discovered 0 executable test nodes.
          </p>
        </div>
      )}

      {/* Stats Summary Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '10px',
        }}
      >
        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Tests</div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
            {activeRun.stats.totalTests}
          </div>
        </div>

        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '11px', color: 'var(--status-fail)', textTransform: 'uppercase' }}>Failed Tests</div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)', color: 'var(--status-fail)' }}>
            {activeRun.stats.failed}
          </div>
        </div>

        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '11px', color: 'var(--status-pass)', textTransform: 'uppercase' }}>Passed Tests</div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)', color: 'var(--status-pass)' }}>
            {activeRun.stats.passed}
          </div>
        </div>

        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '11px', color: 'var(--change-modified)', textTransform: 'uppercase' }}>Modified Symbols</div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)', color: 'var(--change-modified)' }}>
            {activeRun.stats.modifiedNodes}
          </div>
        </div>

        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Graph Nodes</div>
          <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
            {activeRun.stats.totalNodes}
          </div>
        </div>
      </div>

      {/* Scope & Limitations */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Instrument Scope & Boundaries
        </div>
        <ul style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          {activeRun.limitations.map((limit, idx) => (
            <li key={idx}>{limit}</li>
          ))}
        </ul>
      </div>

      {/* Static Analysis Diagnostics */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={13} />
          Static AST Diagnostics
        </div>

        {graphData.unresolvedReferences.length === 0 && graphData.parseErrors.length === 0 ? (
          <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: '12px' }}>
            No unresolved references or parse errors detected for this revision.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {graphData.unresolvedReferences.map((ref, idx) => (
              <div
                key={`unres_${idx}`}
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span className="badge-change modified">Unresolved Reference</span>
                  <code style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{ref.symbol}</code>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>at {ref.referencedFrom}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{ref.reason}</div>
              </div>
            ))}

            {graphData.parseErrors.map((err, idx) => (
              <div
                key={`parse_${idx}`}
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--status-error-bg)',
                  border: '1px solid var(--status-error-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span className="badge-status error">Parse Error</span>
                  <code style={{ color: 'var(--text-primary)' }}>{err.file}:{err.line}</code>
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: '11px' }}>{err.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Honest Causality Note */}
      <div className="notice-honest">
        <AlertTriangle size={14} style={{ color: 'var(--change-modified)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong>Observed, not proven cause:</strong> FaultMesh visualizes code nodes and runtime call traces that were actually executed during pytest runs. A function being modified in Git and executed during a test failure is an observed correlation; it is not independent proof that the change caused the failure.
        </div>
      </div>
    </div>
  );
};
