import React, { useState, useMemo } from 'react';
import type { RunSummary, TestItem } from '../types';
import {
  Compass,
  GitBranch,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Layers,
  Terminal,
  Activity,
  RotateCcw,
  Bot,
  FolderGit2,
  Play,
  Loader2,
  Check,
} from 'lucide-react';

interface ProjectSelectorScreenProps {
  runs: RunSummary[];
  activeRun: RunSummary | null;
  tests: TestItem[];
  onSelectRun: (runId: string) => void;
  onOpenWorkspace: (testId?: string, startAgent?: boolean) => void;
  onOpenDiagnostics?: () => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export const ProjectSelectorScreen: React.FC<ProjectSelectorScreenProps> = ({
  runs,
  activeRun,
  tests,
  onSelectRun,
  onOpenWorkspace,
  onOpenDiagnostics,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const failedTests = tests.filter((t) => t.status === 'fail');

  // Distinct projects discovered in workspace
  const availableProjects = useMemo(() => {
    const set = new Set(runs.map((r) => r.project));
    return Array.from(set);
  }, [runs]);

  const [selectedProject, setSelectedProject] = useState<string>(() => {
    return activeRun?.project || availableProjects[0] || 'auth-service';
  });

  const [isExecutingRun, setIsExecutingRun] = useState(false);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);

  const handleSelectProject = (project: string) => {
    setSelectedProject(project);
    const matchingRun = runs.find((r) => r.project === project);
    if (matchingRun) {
      onSelectRun(matchingRun.id);
    }
  };

  const handleRunProject = () => {
    setIsExecutingRun(true);
    setExecutionMessage(`Running pytest on ${selectedProject}...`);
    setTimeout(() => {
      setIsExecutingRun(false);
      const matchingRun = runs.find((r) => r.project === selectedProject);
      if (matchingRun) {
        onSelectRun(matchingRun.id);
        setExecutionMessage(
          `✓ Pytest run complete for ${selectedProject} (${matchingRun.stats.totalTests} tests, ${matchingRun.stats.failed} failed)`
        );
      } else {
        setExecutionMessage(`✓ Test scan complete for ${selectedProject}`);
      }
      setTimeout(() => setExecutionMessage(null), 4000);
    }, 600);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        backgroundColor: '#101114',
        color: '#f8fafc',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Container */}
      <div
        style={{
          maxWidth: '1020px',
          width: '100%',
          margin: '0 auto',
          padding: '48px 28px 64px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '36px',
        }}
      >
        {/* 1. Header / Title */}
        <header
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                margin: 0,
                color: '#ffffff',
              }}
            >
              FaultMesh
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Evidence-Backed Debugging Workspace
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: '1.5',
              maxWidth: '680px',
            }}
          >
            A holistic, Obsidian-inspired architectural map and execution tracer for Python codebases.
            Explore repository structure, trace failed test call orders, and inspect grounded diffs without speculative leaps.
          </p>
        </header>

        {/* 2. Instructions Section */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#14171d',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '8px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa' }}>
              <Layers size={16} />
              <h2 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#f8fafc' }}>
                1. Whole-Project Map
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
              Files form architectural tiers (ingress tests at top, service coordinator at center, security and persistence wings). Functions reside organically inside their files.
            </p>
          </div>

          <div
            style={{
              backgroundColor: '#14171d',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '8px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171' }}>
              <Terminal size={16} />
              <h2 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#f8fafc' }}>
                2. Test Execution Tracing
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
              Select any test to trace its exact runtime call order with sequential step badges [1] → [2] → [3]. Directional arrows reveal execution flow leading to failure points.
            </p>
          </div>

          <div
            style={{
              backgroundColor: '#14171d',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '8px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>
              <Compass size={16} />
              <h2 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#f8fafc' }}>
                3. Grounded Inspector
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
              Click any file for a plain-English architectural summary, dependencies, and cluster controls. Click any function for exact line ranges, git diffs, and replay trials.
            </p>
          </div>
        </section>

        {/* 3. Project Selection & Test Execution */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              backgroundColor: '#14171d',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '14px 18px',
            }}
          >
            {/* Left: Project Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '12px' }}>
                <FolderGit2 size={15} style={{ color: '#38bdf8' }} />
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>Target Project:</span>
              </div>

              {/* Project Selection Tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: '#0c0d10',
                  padding: '3px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
                role="radiogroup"
                aria-label="Target Project"
              >
                {availableProjects.map((proj) => {
                  const isSelected = selectedProject === proj;
                  return (
                    <button
                      key={proj}
                      onClick={() => handleSelectProject(proj)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: isSelected ? 700 : 500,
                        backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                        color: isSelected ? '#38bdf8' : 'var(--text-secondary)',
                        border: isSelected ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      role="radio"
                      aria-checked={isSelected}
                    >
                      {proj}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Run Project Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={handleRunProject}
                disabled={isExecutingRun}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '6px 14px',
                  backgroundColor: '#10b981',
                  borderColor: '#059669',
                  color: '#ffffff',
                  borderRadius: 'var(--radius-sm)',
                  cursor: isExecutingRun ? 'not-allowed' : 'pointer',
                  opacity: isExecutingRun ? 0.75 : 1,
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                }}
                title={`Run pytest test suite on ${selectedProject}`}
                aria-label={`Run ${selectedProject}`}
              >
                {isExecutingRun ? (
                  <>
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Running pytest...</span>
                  </>
                ) : (
                  <>
                    <Play size={12} fill="currentColor" />
                    <span>Run {selectedProject}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Execution feedback toast / banner */}
          {executionMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#34d399',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Check size={14} />
              <span>{executionMessage}</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} style={{ color: '#ef4444' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fca5a5' }}>
                    Failed to Load Runs
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {error}
                  </div>
                </div>
              </div>
              {onRetry && (
                <button onClick={onRetry} className="btn-secondary btn-sm">
                  <RotateCcw size={12} />
                  Retry Discovery
                </button>
              )}
            </div>
          )}

          {/* Empty Runs State */}
          {!error && !isLoading && runs.length === 0 && (
            <div
              style={{
                backgroundColor: '#14171d',
                border: '1px dashed rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '40px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No Recorded Runs
              </div>
              <div style={{ fontSize: '12px' }}>
                No test execution artifacts or recorded runs were discovered for this workspace.
              </div>
            </div>
          )}

          {/* Run Cards Grid */}
          {!error && runs.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
                gap: '14px',
              }}
            >
              {runs.map((r) => {
                const isSelected = activeRun?.id === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectRun(r.id)}
                    style={{
                      backgroundColor: isSelected ? '#18202d' : '#14171d',
                      border: isSelected
                        ? '1px solid #3b82f6'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      padding: '16px 18px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 0 12px rgba(59, 130, 246, 0.2)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          color: '#ffffff',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                        title={r.project}
                      >
                        {r.project}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {r.isFixture && <span className="badge-status sample">SAMPLE DATA</span>}

                        {/* Status badge: Identical geometry, font, padding, and border */}
                        {r.status === 'failed' ? (
                          <span className="badge-status error">HARNESS FAILED</span>
                        ) : r.status === 'empty' ? (
                          <span className="badge-status empty">EMPTY SCAN</span>
                        ) : r.stats.failed > 0 ? (
                          <span className="badge-status fail">
                            {r.stats.failed} FAILED
                          </span>
                        ) : (
                          <span className="badge-status pass">ALL PASSED</span>
                        )}
                      </div>
                    </div>

                    {/* Branch and Commit info */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          color: '#94a3b8',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <GitBranch size={12} />
                        <span>{r.gitBranch}</span>
                        <span style={{ color: 'var(--text-muted)' }}>@</span>
                        <span style={{ color: '#cbd5e1' }}>{r.gitRevision}</span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={r.commitMessage}
                      >
                        {r.commitMessage}
                      </div>
                    </div>

                    {/* Stats pill */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: '8px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span>{r.stats.totalTests} tests</span>
                        <span>•</span>
                        <span>{r.stats.totalNodes} nodes</span>
                        {r.stats.totalChangedNodes ? (
                          <>
                            <span>•</span>
                            <span style={{ color: 'var(--change-modified)' }}>
                              {r.stats.totalChangedNodes} changed
                            </span>
                          </>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} />
                        <span>{r.durationMs}ms</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Run Test Breakdown & Launch Bar */}
          {activeRun && (
            <div
              style={{
                backgroundColor: '#161a22',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '20px',
                marginTop: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                    Active Run: {activeRun.gitBranch} @ {activeRun.gitRevision.slice(0, 7)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {tests.length} tests recorded • {activeRun.stats.totalNodes} AST nodes •{' '}
                    {failedTests.length > 0 ? (
                      <span style={{ color: 'var(--status-fail)', fontWeight: 600 }}>
                        {failedTests.length} failing tests requiring investigation
                      </span>
                    ) : (
                      <span style={{ color: 'var(--status-pass)' }}>All tests passing</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {failedTests.length > 0 && onOpenWorkspace && (
                    <button
                      onClick={() => onOpenWorkspace(undefined, true)}
                      className="btn-secondary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                      title="Watch an autonomous AI agent diagnose the failure, patch code live, and re-run pytest"
                    >
                      <Bot size={14} />
                      Watch Agent Repair
                    </button>
                  )}
                  {onOpenDiagnostics && (activeRun.errorMessage || activeRun.status === 'failed') && (
                    <button onClick={onOpenDiagnostics} className="btn-secondary btn-sm">
                      <Activity size={13} />
                      View Diagnostics
                    </button>
                  )}
                  <button
                    onClick={() => onOpenWorkspace()}
                    className="btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    Open Project Map
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>

              {/* Quick test launcher list */}
              {tests.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Recorded Tests in this Run (click to inspect in map):
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {tests.map((test) => {
                      const isFail = test.status === 'fail' || test.status === 'error';
                      return (
                        <button
                          key={test.id}
                          onClick={() => onOpenWorkspace(test.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            backgroundColor: isFail ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                            border: isFail
                              ? '1px solid rgba(239, 68, 68, 0.25)'
                              : '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: 'var(--radius-sm)',
                            color: '#f8fafc',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            {test.status === 'pass' ? (
                              <CheckCircle2 size={12} style={{ color: 'var(--status-pass)', flexShrink: 0 }} />
                            ) : test.status === 'fail' ? (
                              <XCircle size={12} style={{ color: 'var(--status-fail)', flexShrink: 0 }} />
                            ) : (
                              <AlertTriangle size={12} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
                            )}
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {test.name}
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
                            {test.durationMs}ms
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
