import React from 'react';
import type { RunSummary } from '../types';
import {
  FileText,
  Network,
  AlertTriangle,
  Monitor,
  Activity,
} from 'lucide-react';

interface HeaderProps {
  runs: RunSummary[];
  activeRun: RunSummary | null;
  onSelectRun: (runId: string) => void;
  activeView: 'investigation' | 'evidence_map' | 'diagnostics';
  onSelectView: (view: 'investigation' | 'evidence_map' | 'diagnostics') => void;
  failedTestCount?: number;
  errorCount?: number;
  diagnosticsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  runs,
  activeRun,
  onSelectRun,
  activeView,
  onSelectView,
  failedTestCount = 0,
  errorCount = 0,
  diagnosticsCount = 0,
}) => {
  const isDesktop =
    typeof window !== 'undefined' &&
    (Boolean((window as unknown as { process?: { type?: string } }).process?.type) ||
      navigator.userAgent.includes('Electron'));

  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const totalProblemTests = failedTestCount + errorCount;

  return (
    <header
      style={{
        borderBottom: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
        flexShrink: 0,
        // @ts-expect-error WebkitAppRegion
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      {/* Main Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          paddingLeft: isMacDesktop ? '78px' : '14px',
          gap: '12px',
          minHeight: '44px',
          flexWrap: 'nowrap',
          minWidth: 0,
        }}
      >
        {/* Brand & Run Context */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--accent)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '11px',
              }}
            >
              FM
            </div>
            <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '-0.01em' }}>
              FaultMesh
            </span>
            {isDesktop && (
              <span
                style={{
                  fontSize: '10px',
                  backgroundColor: 'var(--bg-raised)',
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Monitor size={10} />
                desktop
              </span>
            )}
          </div>

          <div
            style={{
              height: '16px',
              width: '1px',
              backgroundColor: 'var(--border-default)',
              flexShrink: 0,
            }}
          />

          {/* Run Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1 }}>
            <label
              htmlFor="run-selector"
              style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}
            >
              Run:
            </label>
            <select
              id="run-selector"
              value={activeRun?.id || ''}
              onChange={(e) => onSelectRun(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                maxWidth: '180px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              aria-label="Select Recorded Run"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.project} ({r.gitBranch} @ {r.gitRevision})
                </option>
              ))}
            </select>
          </div>

          {/* Sample Data / Fixture Indicator */}
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

        {/* View Modes */}
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
              onClick={() => onSelectView('investigation')}
              className={activeView === 'investigation' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                padding: '3px 9px',
                fontSize: '11px',
                fontWeight: activeView === 'investigation' ? 600 : 400,
                backgroundColor: activeView === 'investigation' ? 'var(--bg-active)' : 'transparent',
              }}
              aria-current={activeView === 'investigation' ? 'page' : undefined}
            >
              <FileText size={12} />
              Investigation
            </button>

            <button
              onClick={() => onSelectView('evidence_map')}
              className={activeView === 'evidence_map' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                padding: '3px 9px',
                fontSize: '11px',
                fontWeight: activeView === 'evidence_map' ? 600 : 400,
                backgroundColor: activeView === 'evidence_map' ? 'var(--bg-active)' : 'transparent',
              }}
              aria-current={activeView === 'evidence_map' ? 'page' : undefined}
            >
              <Network size={12} />
              Evidence Map
            </button>

            <button
              onClick={() => onSelectView('diagnostics')}
              className={activeView === 'diagnostics' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                padding: '3px 9px',
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
