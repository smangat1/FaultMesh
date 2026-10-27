import React, { useRef } from 'react';
import type { RunSummary } from '../types';
import {
  ChevronLeft,
  AlertTriangle,
  Activity,
  Layers,
  GitBranch,
  FolderOpen,
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
  onOpenFiles?: (files: FileList | File[]) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeRun,
  onBackToSelector,
  activeView,
  onSelectView,
  failedTestCount = 0,
  errorCount = 0,
  diagnosticsCount = 0,
  onOpenFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const totalProblemTests = failedTestCount + errorCount;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onOpenFiles?.(e.target.files);
      // Reset input so same file can be re-opened if desired
      e.target.value = '';
    }
  };

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
              className="badge-status sample"
              title={activeRun.fixtureLabel || 'Read-only fixture data: synthetic sample artifacts'}
            >
              <AlertTriangle size={10} />
              SAMPLE DATA
            </span>
          )}

          {/* Persistent Small Imported Label */}
          {activeRun?.isRealImport && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                padding: '2px 7px',
                borderRadius: 'var(--radius-sm)',
              }}
              title={`V3 static structure export: ${activeRun.contentSha256 || activeRun.id}`}
            >
              Imported: {activeRun.project} @ {activeRun.gitRevision.slice(0, 7)} - static structure
              {activeRun.v2RunCount && activeRun.v2RunCount > 0
                ? ` / ${activeRun.v2RunCount} run${activeRun.v2RunCount > 1 ? 's' : ''}`
                : ''}
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
                <span className="badge-status empty">
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

        {/* Right: Workspace Views & Open JSON action */}
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
          {/* Open JSON Export Button */}
          {onOpenFiles && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                multiple
                style={{ display: 'none' }}
                aria-label="Open JSON file input"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-ghost btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  padding: '3px 8px',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
                title="Open local V3 static structure or V2 test run evidence JSON export"
                aria-label="Open JSON Export"
              >
                <FolderOpen size={12} />
                <span>Open JSON</span>
              </button>
            </>
          )}
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
