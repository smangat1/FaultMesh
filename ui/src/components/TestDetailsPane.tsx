import React, { useState } from 'react';
import type { TestItem, CodeNode } from '../types';
import { DiffViewer } from './DiffViewer';
import {
  Clock,
  Layers,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode,
  Info,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  SkipForward,
} from 'lucide-react';

interface TestDetailsPaneProps {
  test: TestItem | null;
  allNodes: CodeNode[];
  onNavigateToGraphWithTest?: (testId: string) => void;
  onSelectNodeInGraph?: (nodeId: string) => void;
}

export const TestDetailsPane: React.FC<TestDetailsPaneProps> = ({
  test,
  allNodes,
  onNavigateToGraphWithTest,
}) => {
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  if (!test) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          padding: '40px',
          textAlign: 'center',
        }}
      >
        <FileCode size={36} style={{ marginBottom: '12px', opacity: 0.5 }} />
        <div style={{ fontSize: '14px', fontWeight: 600 }}>No Test Selected</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>
          Select a test from the list to inspect its failure traceback, rerun history,
          and exercised code paths.
        </div>
      </div>
    );
  }

  // Get nodes exercised by this test
  const exercisedNodes = allNodes.filter((n) =>
    test.exercisedNodeIds.includes(n.id)
  );
  const modifiedExercised = exercisedNodes.filter(
    (n) => n.changeStatus === 'modified' || n.changeStatus === 'added'
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`badge-status ${test.status}`}>
              {test.status === 'pass' && <CheckCircle2 size={12} />}
              {test.status === 'fail' && <XCircle size={12} />}
              {test.status === 'error' && <AlertOctagon size={12} />}
              {test.status === 'skipped' && <SkipForward size={12} />}
              {test.status}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Clock size={12} /> {test.durationMs}ms
            </span>
          </div>

          {onNavigateToGraphWithTest && (
            <button
              onClick={() => onNavigateToGraphWithTest(test.id)}
              className="btn btn-sm btn-primary"
              title="Show execution flow in Cytoscape graph"
            >
              <Layers size={13} />
              View Execution Path in Graph
            </button>
          )}
        </div>

        <h2
          style={{
            fontSize: '15px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          {test.name}
        </h2>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            marginTop: '2px',
          }}
        >
          {test.file}
        </div>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Honest Causality Disclaimer */}
        <div className="notice-box honest-cause">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Info size={15} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Observed, not proven cause:</strong>{' '}
              {modifiedExercised.length > 0 ? (
                <>
                  This test exercised modified code: <strong>{modifiedExercised.map((m) => m.name).join(', ')}</strong>.
                  FaultMesh confirms it executed during this test, but does not claim it caused the failure without independent verification.
                </>
              ) : (
                'Execution traces represent observed runtime paths. They do not imply defect causation.'
              )}
            </div>
          </div>
        </div>

        {/* Failure Message */}
        {test.failureMessage && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--status-fail)',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <XCircle size={13} /> Failure Message
            </div>
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '4px',
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {test.failureMessage}
            </div>
          </div>
        )}

        {/* Python Traceback */}
        {test.traceback && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                marginBottom: '6px',
              }}
            >
              Python Traceback
            </div>
            <div
              style={{
                backgroundColor: '#0a0f1d',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: '1.5',
                overflowX: 'auto',
                color: '#e2e8f0',
                whiteSpace: 'pre',
              }}
            >
              {test.traceback}
            </div>
          </div>
        )}

        {/* Rerun History & Stability Check */}
        {test.rerunHistory.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Rerun Stability History ({test.rerunHistory.length} trials)</span>
              {test.rerunHistory.every((r) => r.sameFailureRecurred) && (
                <span
                  style={{
                    color: 'var(--status-fail)',
                    fontSize: '10px',
                    fontWeight: 700,
                    backgroundColor: 'var(--status-fail-bg)',
                    padding: '2px 6px',
                    borderRadius: '3px',
                  }}
                >
                  Deterministic Failure (100% stable)
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {test.rerunHistory.map((rerun) => (
                <div
                  key={rerun.rerunIndex}
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 600 }}>Trial #{rerun.rerunIndex}</span>
                    <span className={`badge-status ${rerun.status}`}>
                      {rerun.status}
                    </span>
                    {rerun.failureFingerprint && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--accent)',
                          fontSize: '10px',
                        }}
                      >
                        [{rerun.failureFingerprint}]
                      </span>
                    )}
                    {rerun.message && (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {rerun.message}
                      </span>
                    )}
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {rerun.durationMs}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Exercised Code Nodes */}
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Code Exercised by this Test ({exercisedNodes.length})</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Click node to preview source / diff
            </span>
          </div>

          {exercisedNodes.length === 0 ? (
            <div
              style={{
                padding: '12px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '4px',
                color: 'var(--text-muted)',
                fontSize: '12px',
              }}
            >
              No AST nodes were recorded as traversed for this test execution.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {exercisedNodes.map((node) => {
                const isExpanded = expandedNodeId === node.id;
                return (
                  <div
                    key={node.id}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    <div
                      data-testid={`exercised-node-${node.name}`}
                      onClick={() => setExpandedNodeId(isExpanded ? null : node.id)}
                      style={{
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        backgroundColor: isExpanded
                          ? 'var(--bg-tertiary)'
                          : 'var(--bg-surface)',
                        transition: 'background-color 0.1s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <Code2 size={13} style={{ color: 'var(--text-muted)' }} />
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {node.name}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {node.file}:{node.lineStart}-{node.lineEnd}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`badge-change ${node.changeStatus}`}>
                          {node.changeStatus}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)' }}>
                        {node.gitDiff && (
                          <div style={{ marginBottom: '10px' }}>
                            <div
                              style={{
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                color: 'var(--change-modified)',
                                fontWeight: 700,
                                marginBottom: '4px',
                              }}
                            >
                              Git Diff (HEAD vs Base)
                            </div>
                            <DiffViewer diff={node.gitDiff} />
                          </div>
                        )}

                        <div>
                          <div
                            style={{
                              fontSize: '10px',
                              textTransform: 'uppercase',
                              color: 'var(--text-muted)',
                              fontWeight: 700,
                              marginBottom: '4px',
                            }}
                          >
                            Source Snippet
                          </div>
                          <DiffViewer source={node.sourceSnippet} lineStart={node.lineStart} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unresolved References for Test */}
        {test.unresolvedReferences && test.unresolvedReferences.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--change-modified)',
                marginBottom: '6px',
              }}
            >
              Unresolved References Touched
            </div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
              }}
            >
              {test.unresolvedReferences.join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
