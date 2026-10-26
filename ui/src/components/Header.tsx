import React from 'react';
import type { RunSummary } from '../types';
import {
  ChevronLeft,
  AlertTriangle,
  Activity,
  Layers,
  GitBranch,
} from 'lucide-react';

interface HeaderProps {
  runs?: RunSummary[];
  activeRun: RunSummary | null;
  onSelectRun?: (runId: string) => void;
  onBackToSelector?: () => void;
  activeView: 'map' | 'diagnostics';
  onSelectView: (view: 'map' | 'diagnostics') => void;
  failedTestCount?: number;
  errorCount?: number;
  diagnosticsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeRun,
  onBackToSelector,
  activeView,
  onSelectView,
  failedTestCount = 0,
  errorCount = 0,
  diagnosticsCount = 0,
}) => {
  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const totalProblemTests = failedTestCount + errorCount;

  return (
    <header
      style={{
        borderBottom: '1px solid var(--border-default)',
        backgroundColor: '#11141a',
        flexShrink: 0,
        // @ts-expect-error WebkitAppRegion
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      {/* Sleek Workspace Navigation Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          paddingLeft: isMacDesktop ? '78px' : '14px',
          gap: '12px',
          minHeight: '40px',
          flexWrap: 'nowrap',
          minWidth: 0,
        }}
      >
        {/* Left: Project Return Button & Run Context (No FM logo, No FaultMesh title, No Run dropdown) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 1,
            minWidth: 0,
            // @ts-expect-error WebkitAppRegion
            WebkitAppRegion: 'no-drag',
          }}
        >
          {/* Back to Projects button */}
          {onBackToSelector && (
            <button
              onClick={onBackToSelector}
              className="btn-ghost btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '3px 8px',
                color: 'var(--text-secondary)',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
              title="Return to Projects and Run Selector"
            >
              <ChevronLeft size={13} />
              <span>Projects</span>
            </button>
          )}

          {/* Active Project & Branch indicator */}
          {activeRun && (
            <div
              onClick={onBackToSelector}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
                cursor: onBackToSelector ? 'pointer' : 'default',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
              }}
              title={onBackToSelector ? 'Click to change project or run' : undefined}
            >
              <span style={{ fontWeight: 600 }}>{activeRun.project}</span>
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <span style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <GitBranch size={11} />
                {activeRun.gitBranch}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>@</span>
              <span style={{ color: 'var(--text-muted)' }}>{activeRun.gitRevision.slice(0, 7)}</span>
            </div>
          )}

          {/* Sample Data / Fixture Badge */}
          {activeRun?.isFixture && (
            <span
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--change-modified)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.03em',
                fontFamily: 'var(--font-mono)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
              title={activeRun.fixtureLabel || 'Read-only fixture data: synthetic sample artifacts'}
            >
              <AlertTriangle size={10} />
              SAMPLE DATA
            </span>
          )}

          {/* Outcome Summary Pill: Never show green COMPLETED when tests failed! */}
          {activeRun && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {activeRun.status === 'failed' ? (
                <span
                  className="badge-status error"
                  title="Run harness aborted during collection"
                >
                  HARNESS FAILED
                </span>
              ) : activeRun.status === 'empty' ? (
                <span
                  style={{
                    backgroundColor: 'var(--bg-raised)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  EMPTY SCAN
                </span>
              ) : totalProblemTests > 0 ? (
                <span
                  className="badge-status fail"
                  title={`${failedTestCount} failed, ${errorCount} error`}
                >
                  {failedTestCount > 0 ? `${failedTestCount} FAILED` : ''}
                  {failedTestCount > 0 && errorCount > 0 ? ' · ' : ''}
                  {errorCount > 0 ? `${errorCount} ERROR` : ''}
                </span>
              ) : (
                <span className="badge-status pass">ALL PASSED</span>
              )}

              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {activeRun.durationMs}ms
              </span>
            </div>
          )}
        </div>

        {/* Right: Workspace Views (Streamlined: Map vs Run Diagnostics, redundant views eliminated) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            // @ts-expect-error WebkitAppRegion
            WebkitAppRegion: 'no-drag',
          }}
        >
          <nav
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-app)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
              border: '1px solid var(--border-default)',
            }}
            aria-label="Workspace Views"
          >
            <button
              onClick={() => onSelectView('map')}
              className={activeView === 'map' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: activeView === 'map' ? 600 : 400,
                backgroundColor: activeView === 'map' ? 'var(--bg-active)' : 'transparent',
              }}
              aria-current={activeView === 'map' ? 'page' : undefined}
            >
              <Layers size={12} />
              Project Map
            </button>

            <button
              onClick={() => onSelectView('diagnostics')}
              className={activeView === 'diagnostics' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: activeView === 'diagnostics' ? 600 : 400,
                backgroundColor: activeView === 'diagnostics' ? 'var(--bg-active)' : 'transparent',
              }}
              aria-current={activeView === 'diagnostics' ? 'page' : undefined}
            >
              <Activity size={12} />
              Run Diagnostics
              {diagnosticsCount > 0 && (
                <span
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    color: 'var(--change-modified)',
                    borderRadius: '10px',
                    padding: '0 4px',
                    fontSize: '9px',
                    fontWeight: 700,
                  }}
                >
                  {diagnosticsCount}
                </span>
              )}
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
