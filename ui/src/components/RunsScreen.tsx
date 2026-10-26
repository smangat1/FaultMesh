import React from 'react';
import type { RunSummary, GraphData } from '../types';
import {
  CheckCircle2,
  XCircle,
  AlertOctagon,
  SkipForward,
  GitCommit,
  GitBranch,
  Clock,
  ShieldAlert,
  Info,
  Code2,
  Layers,
  ArrowRight,
  Terminal,
} from 'lucide-react';

interface RunsScreenProps {
  runs: RunSummary[];
  activeRun: RunSummary | null;
  graphData: GraphData;
  onSelectRun: (runId: string) => void;
  onNavigateToTests: () => void;
  onNavigateToGraph: () => void;
}

export const RunsScreen: React.FC<RunsScreenProps> = ({
  runs,
  activeRun,
  graphData,
  onSelectRun,
  onNavigateToTests,
  onNavigateToGraph,
}) => {
  if (!activeRun) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        No run selected.
      </div>
    );
  }

  const { stats } = activeRun;
  const total = stats.totalTests;
  const passRate = total > 0 ? Math.round((stats.passed / total) * 100) : 0;

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Run Selection & Overview Banner */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left: Available Runs List */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              color: 'var(--text-muted)',
              marginBottom: '12px',
            }}
          >
            Recorded Runs ({runs.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {runs.map((r) => {
              const isSelected = r.id === activeRun.id;
              return (
                <div
                  key={r.id}
                  onClick={() => onSelectRun(r.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '5px',
                    backgroundColor: isSelected
                      ? 'var(--bg-tertiary)'
                      : 'var(--bg-surface)',
                    border: isSelected
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>
                      {r.project}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        textTransform: 'uppercase',
                        backgroundColor:
                          r.status === 'completed'
                            ? 'var(--status-pass-bg)'
                            : r.status === 'failed'
                            ? 'var(--status-fail-bg)'
                            : 'var(--bg-tertiary)',
                        color:
                          r.status === 'completed'
                            ? 'var(--status-pass)'
                            : r.status === 'failed'
                            ? 'var(--status-fail)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {r.gitBranch} @ {r.gitRevision}
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{new Date(r.startedAt).toLocaleTimeString()}</span>
                    <span>{r.durationMs}ms</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Active Run Deep Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Card */}
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h1 style={{ fontSize: '18px', fontWeight: 700 }}>
                    {activeRun.project}
                  </h1>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      backgroundColor:
                        activeRun.status === 'completed'
                          ? 'var(--status-pass-bg)'
                          : activeRun.status === 'failed'
                          ? 'var(--status-fail-bg)'
                          : 'var(--bg-tertiary)',
                      color:
                        activeRun.status === 'completed'
                          ? 'var(--status-pass)'
                          : activeRun.status === 'failed'
                          ? 'var(--status-fail)'
                          : 'var(--text-muted)',
                    }}
                  >
                    {activeRun.status}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                  }}
                >
                  {activeRun.commitMessage}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={onNavigateToTests}
                  className="btn btn-primary"
                  title="View test failures and tracebacks"
                >
                  Explore Tests ({stats.totalTests})
                  <ArrowRight size={14} />
                </button>
                <button
                  onClick={onNavigateToGraph}
                  className="btn"
                  title="View visual execution and AST graph"
                >
                  <Layers size={14} />
                  Graph View
                </button>
              </div>
            </div>

            {/* Run Meta Details */}
            <div
              style={{
                display: 'flex',
                gap: '20px',
                padding: '12px 14px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '5px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                marginBottom: '20px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <GitBranch size={13} /> branch: <strong>{activeRun.gitBranch}</strong>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <GitCommit size={13} /> commit: <strong>{activeRun.gitRevision}</strong>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={13} /> duration: <strong>{activeRun.durationMs}ms</strong>
              </span>
              <span>
                started: {new Date(activeRun.startedAt).toLocaleString()}
              </span>
            </div>

            {/* Status Breakdown Bar & Metric Badges */}
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <span>Test Execution Results</span>
                <span>{passRate}% Passing</span>
              </div>

              {/* Stacked bar */}
              <div
                style={{
                  height: '10px',
                  borderRadius: '5px',
                  backgroundColor: 'var(--bg-tertiary)',
                  display: 'flex',
                  overflow: 'hidden',
                  marginBottom: '16px',
                }}
              >
                {total > 0 ? (
                  <>
                    <div
                      style={{
                        width: `${(stats.passed / total) * 100}%`,
                        backgroundColor: 'var(--status-pass)',
                      }}
                      title={`Passed: ${stats.passed}`}
                    />
                    <div
                      style={{
                        width: `${(stats.failed / total) * 100}%`,
                        backgroundColor: 'var(--status-fail)',
                      }}
                      title={`Failed: ${stats.failed}`}
                    />
                    <div
                      style={{
                        width: `${(stats.errored / total) * 100}%`,
                        backgroundColor: 'var(--status-error)',
                      }}
                      title={`Errored: ${stats.errored}`}
                    />
                    <div
                      style={{
                        width: `${(stats.skipped / total) * 100}%`,
                        backgroundColor: 'var(--status-skipped)',
                      }}
                      title={`Skipped: ${stats.skipped}`}
                    />
                  </>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-tertiary)',
                    }}
                  />
                )}
              </div>

              {/* Stat Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '5px',
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--status-pass)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={13} /> PASSED
                  </div>
                  <div
                    style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}
                  >
                    {stats.passed}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '5px',
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--status-fail)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    <XCircle size={13} /> FAILED
                  </div>
                  <div
                    style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}
                  >
                    {stats.failed}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '5px',
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--status-error)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    <AlertOctagon size={13} /> ERRORED
                  </div>
                  <div
                    style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}
                  >
                    {stats.errored}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '5px',
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--status-skipped)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    <SkipForward size={13} /> SKIPPED
                  </div>
                  <div
                    style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}
                  >
                    {stats.skipped}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '5px',
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--change-modified)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    <Code2 size={13} /> MODIFIED NODES
                  </div>
                  <div
                    style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}
                  >
                    {stats.modifiedNodes} / {stats.totalNodes}
                  </div>
                </div>
              </div>
            </div>

            {/* Honest Causality Notice */}
            <div className="notice-box honest-cause" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Info size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Observed, not proven cause:</strong> FaultMesh visualizes code nodes
                  and runtime call traces that were actually executed during pytest runs. A
                  function being modified in Git and executed during a test failure is an
                  observed correlation; it is not independent proof that the change caused the failure.
                </div>
              </div>
            </div>

            {/* Error or Empty Scan Honest States */}
            {activeRun.status === 'failed' && activeRun.errorMessage && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--status-fail)',
                  borderRadius: '5px',
                  padding: '14px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--status-fail)',
                    fontWeight: 700,
                    fontSize: '13px',
                    marginBottom: '8px',
                  }}
                >
                  <ShieldAlert size={16} /> Test Runner Error (Collection Phase)
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    backgroundColor: 'var(--bg-primary)',
                    padding: '10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {activeRun.errorMessage}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '8px',
                  }}
                >
                  Remediation: Install the required harness package or verify your pytest
                  dependencies before rerunning.
                </div>
              </div>
            )}

            {activeRun.status === 'empty' && (
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px dashed var(--border-color)',
                  borderRadius: '5px',
                  padding: '20px',
                  textAlign: 'center',
                  marginBottom: '16px',
                }}
              >
                <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                  Empty Scan State
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto' }}>
                  No pytest test cases were detected in the target repository using pattern test_*.py or *_test.py.
                  Static AST analysis discovered 0 executable test nodes.
                </div>
              </div>
            )}

            {/* Limitations & Verification Boundaries */}
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  marginBottom: '8px',
                }}
              >
                Instrument Limitations & Scope
              </div>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {activeRun.limitations.map((lim, idx) => (
                  <li
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        userSelect: 'none',
                        lineHeight: '1.4',
                      }}
                    >
                      •
                    </span>
                    <span>{lim}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* AST Diagnostics: Unresolved references & parse errors */}
          {(graphData.unresolvedReferences.length > 0 ||
            graphData.parseErrors.length > 0) && (
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '16px 20px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Terminal size={14} /> Static Analysis Diagnostics
              </div>

              {graphData.unresolvedReferences.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--change-modified)',
                      marginBottom: '6px',
                    }}
                  >
                    Unresolved References ({graphData.unresolvedReferences.length})
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                    }}
                  >
                    {graphData.unresolvedReferences.map((ref, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          {ref.symbol}
                        </span>{' '}
                        in <span style={{ color: 'var(--text-primary)' }}>{ref.referencedFrom}</span>: {ref.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {graphData.parseErrors.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--status-fail)',
                      marginBottom: '6px',
                    }}
                  >
                    AST Parse Errors ({graphData.parseErrors.length})
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                    }}
                  >
                    {graphData.parseErrors.map((err, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.08)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          color: 'var(--status-fail)',
                        }}
                      >
                        {err.file}:{err.line} - {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
