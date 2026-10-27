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
  GitCommit,
  RotateCcw,
} from 'lucide-react';
import { formatDurationMs } from '../utils/format';

interface TestDetailsPaneProps {
  test: TestItem | null;
  allNodes: CodeNode[];
  onNavigateToEvidenceMap?: (testId: string) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
}

export const TestDetailsPane: React.FC<TestDetailsPaneProps> = ({
  test,
  allNodes,
  onNavigateToEvidenceMap,
  selectedNodeId,
  onSelectNode,
}) => {
  const [activeCodeTab, setActiveCodeTab] = useState<'diff' | 'source'>('diff');
  const [expandedTraceback, setExpandedTraceback] = useState<boolean>(true);
  const [expandedFileGroup, setExpandedFileGroup] = useState<Record<string, boolean>>({
    'auth/tokens.py': true,
    'auth/service.py': true,
    'auth/crypto.py': true,
  });

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
        <FileCode size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
        <div style={{ fontSize: '13px', fontWeight: 600 }}>No Test Selected</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>
          Choose a test from the left rail to inspect failure evidence, recorded replay, and exercised code.
        </div>
      </div>
    );
  }

  // Get nodes exercised by this test
  const exercisedNodes = allNodes.filter((n) =>
    test.exercisedNodeIds.includes(n.id)
  );

  // Identify modified or added code exercised by this test
  const changedExercised = exercisedNodes.filter(
    (n) => n.changeStatus === 'modified' || n.changeStatus === 'added'
  );

  // Active inspected node: default to first changed node, or currently selected node
  const inspectedNode =
    allNodes.find((n) => n.id === selectedNodeId) ||
    changedExercised[0] ||
    exercisedNodes[0] ||
    null;

  // Group exercised nodes by file
  const nodesByFile: Record<string, CodeNode[]> = {};
  exercisedNodes.forEach((node) => {
    if (!nodesByFile[node.file]) nodesByFile[node.file] = [];
    nodesByFile[node.file].push(node);
  });

  // Replay comparison summary
  const replayTotal = test.rerunHistory.length;
  const sameFailureCount = test.rerunHistory.filter((r) => r.sameFailureRecurred).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-app)',
        minWidth: 0,
      }}
    >
      {/* Test Identification Header */}
      <div
        style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '6px',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span className={`badge-status ${test.status}`}>
              {test.status === 'pass' && <CheckCircle2 size={12} />}
              {test.status === 'fail' && <XCircle size={12} />}
              {test.status === 'error' && <AlertOctagon size={12} />}
              {test.status === 'skipped' && <SkipForward size={12} />}
              {test.status.toUpperCase()}
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
              <Clock size={11} /> {formatDurationMs(test.durationMs)}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {exercisedNodes.length} code nodes covered
            </span>
          </div>

          {onNavigateToEvidenceMap && (
            <button
              onClick={() => onNavigateToEvidenceMap(test.id)}
              className="btn-secondary btn-sm"
              title="Switch to bounded visual evidence map for this test"
              style={{ flexShrink: 0 }}
            >
              <Layers size={12} />
              Open in Evidence Map
            </button>
          )}
        </div>

        <h2
          style={{
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
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

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Promoted Failure / Error Message */}
        {test.failureMessage && (
          <div
            style={{
              backgroundColor: 'var(--status-fail-bg)',
              border: '1px solid var(--status-fail-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--status-fail)',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              <XCircle size={13} />
              Failure Message
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                lineHeight: '1.5',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {test.failureMessage}
            </div>

            {/* Python Traceback Disclosure */}
            {test.traceback && (
              <div style={{ marginTop: '10px', borderTop: '1px solid rgba(239, 68, 68, 0.2)', paddingTop: '8px' }}>
                <button
                  onClick={() => setExpandedTraceback(!expandedTraceback)}
                  className="btn-ghost btn-sm"
                  style={{
                    padding: '2px 0',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  aria-expanded={expandedTraceback}
                >
                  {expandedTraceback ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Python Traceback ({test.traceback.split('\n').length} lines)
                </button>

                {expandedTraceback && (
                  <pre
                    style={{
                      marginTop: '6px',
                      backgroundColor: 'var(--bg-code)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      lineHeight: '1.5',
                      overflowX: 'auto',
                      color: '#e2e8f0',
                      whiteSpace: 'pre',
                    }}
                  >
                    {test.traceback}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Recorded Replay Comparison (Honest count-based language) */}
        {test.rerunHistory.length > 0 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RotateCcw size={12} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Recorded Replay Comparison ({replayTotal} trials)
                </span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: sameFailureCount === replayTotal ? 'var(--status-fail)' : 'var(--text-secondary)',
                }}
              >
                Same failure in {sameFailureCount} of {replayTotal} recorded replays
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {test.rerunHistory.map((rerun) => (
                <div
                  key={rerun.rerunIndex}
                  style={{
                    backgroundColor: 'var(--bg-raised)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Trial #{rerun.rerunIndex}
                    </span>
                    <span className={`badge-status ${rerun.status}`}>
                      {rerun.status.toUpperCase()}
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
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                    {formatDurationMs(rerun.durationMs)}
                  </span>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: '8px',
                fontSize: '10px',
                color: 'var(--text-muted)',
              }}
            >
              Replay execution unavailable (static evidence viewer). Showing recorded trial history.
            </div>
          </div>
        )}

        {/* Promoted Changed Code Inspector */}
        {inspectedNode && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
            }}
          >
            {/* Header of Code Inspector */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-default)',
                backgroundColor: 'var(--bg-raised)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span className={`badge-change ${inspectedNode.changeStatus}`}>
                  {inspectedNode.changeStatus}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                >
                  {inspectedNode.name}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {inspectedNode.file}:{inspectedNode.lineStart}-{inspectedNode.lineEnd}
                </span>
              </div>

              {/* Diff vs Source Tabs */}
              <div
                style={{
                  display: 'flex',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px',
                  border: '1px solid var(--border-default)',
                }}
              >
                {inspectedNode.gitDiff && (
                  <button
                    onClick={() => setActiveCodeTab('diff')}
                    className={activeCodeTab === 'diff' ? 'btn-secondary' : 'btn-ghost'}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      backgroundColor: activeCodeTab === 'diff' ? 'var(--bg-active)' : 'transparent',
                    }}
                  >
                    <GitCommit size={11} />
                    Git Diff
                  </button>
                )}
                <button
                  onClick={() => setActiveCodeTab('source')}
                  className={activeCodeTab === 'source' ? 'btn-secondary' : 'btn-ghost'}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    backgroundColor: activeCodeTab === 'source' ? 'var(--bg-active)' : 'transparent',
                  }}
                >
                  <Code2 size={11} />
                  Source (L{inspectedNode.lineStart}-{inspectedNode.lineEnd})
                </button>
              </div>
            </div>

            {/* Code Body */}
            <div style={{ padding: '12px' }}>
              {activeCodeTab === 'diff' && inspectedNode.gitDiff ? (
                <DiffViewer diff={inspectedNode.gitDiff} />
              ) : (
                <DiffViewer
                  source={inspectedNode.sourceSnippet}
                  lineStart={inspectedNode.lineStart}
                />
              )}
            </div>
          </div>
        )}

        {/* Covered Code List (Grouped by File) */}
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Exercised Code ({exercisedNodes.length} symbols in {Object.keys(nodesByFile).length} files)</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Select a symbol to inspect code & diff
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(nodesByFile).map(([file, nodes]) => {
              const isGroupOpen = expandedFileGroup[file] ?? true;
              return (
                <div
                  key={file}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  <button
                    onClick={() =>
                      setExpandedFileGroup((prev) => ({
                        ...prev,
                        [file]: !isGroupOpen,
                      }))
                    }
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      backgroundColor: 'var(--bg-raised)',
                      border: 'none',
                      borderBottom: isGroupOpen ? '1px solid var(--border-subtle)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    aria-expanded={isGroupOpen}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isGroupOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600 }}>
                        {file}
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {nodes.length} symbols
                    </span>
                  </button>

                  {isGroupOpen && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {nodes.map((node) => {
                        const isCurrent = inspectedNode?.id === node.id;
                        return (
                          <li key={node.id}>
                            <button
                              onClick={() => onSelectNode?.(node.id)}
                              style={{
                                width: '100%',
                                padding: '6px 12px 6px 24px',
                                border: 'none',
                                borderBottom: '1px solid var(--border-subtle)',
                                backgroundColor: isCurrent ? 'var(--bg-active)' : 'transparent',
                                borderLeft: isCurrent ? '3px solid var(--accent)' : '3px solid transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                              aria-selected={isCurrent}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Code2 size={12} style={{ color: 'var(--text-muted)' }} />
                                <span
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '12px',
                                    fontWeight: isCurrent ? 600 : 400,
                                    color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  }}
                                >
                                  {node.name}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  L{node.lineStart}-{node.lineEnd}
                                </span>
                              </div>

                              <span className={`badge-change ${node.changeStatus}`}>
                                {node.changeStatus}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Honest Causality Notice */}
        <div className="notice-honest">
          <Info size={14} style={{ color: 'var(--change-modified)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Observed coverage, not proof of cause:</strong>{' '}
            {changedExercised.length > 0 ? (
              <>
                This test exercised changed code: <strong>{changedExercised.map((n) => n.name).join(', ')}</strong>.
                FaultMesh confirms execution occurred during this test run, but does not assert that the change caused the failure without independent proof.
              </>
            ) : (
              'Traces represent observed execution coverage. Topological reachability does not imply defect cause.'
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
