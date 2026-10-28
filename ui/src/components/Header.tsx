import React, { useRef } from 'react';
import type { RunSummary } from '../types';
import {
  ChevronLeft,
  AlertTriangle,
  Activity,
  Layers,
  GitBranch,
  FolderOpen,
  RotateCcw,
  FileText,
  FileDiff,
} from 'lucide-react';
import { formatDurationMs } from '../utils/format';

export type WorkspaceActiveView = 'map' | 'diagnostics' | 'replay' | 'files' | 'changes';

interface HeaderProps {
  runs?: RunSummary[];
  activeRun: RunSummary | null;
  onSelectRun?: (runId: string) => void;
  onBackToSelector?: () => void;
  onBackToEntrance?: () => void;
  activeView: WorkspaceActiveView;
  onSelectView: (view: WorkspaceActiveView) => void;
  failedTestCount?: number;
  errorCount?: number;
  diagnosticsCount?: number;
  onOpenFiles?: (files: FileList | File[]) => void;
  liveWatchingStatus?: string;
}

export const Header: React.FC<HeaderProps> = ({
  runs = [],
  activeRun,
  onSelectRun,
  onBackToSelector,
  onBackToEntrance,
  activeView,
  onSelectView,
  failedTestCount = 0,
  errorCount = 0,
  diagnosticsCount = 0,
  onOpenFiles,
  liveWatchingStatus,
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
          gap: '10px',
          minHeight: '40px',
          flexWrap: 'wrap',
          rowGap: '6px',
          columnGap: '10px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Left: Project Return Button & Run Context */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            flexWrap: 'wrap',
            rowGap: '4px',
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

          {/* Back to Modes (Entrance Screen) in Live Watch */}
          {activeRun && activeRun.isLive && onBackToEntrance && (
            <button
              onClick={onBackToEntrance}
              data-testid="header-back-to-modes"
              className="btn-ghost btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '3px 8px',
                color: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
              title="Return to mode selection (Entrance Screen)"
              aria-label="Back to modes"
            >
              <ChevronLeft size={13} />
              <span>Modes</span>
            </button>
          )}

          {/* Active Project & Branch indicator */}
          {activeRun && !activeRun.isLive && (
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

          {/* Minimal Project Name indicator in Live Watch */}
          {activeRun && activeRun.isLive && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
                padding: '2px 6px',
              }}
            >
              <span style={{ fontWeight: 600 }}>{activeRun.project}</span>
              {liveWatchingStatus && (
                <span
                  data-testid="header-watching-status"
                  style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                    padding: '1px 6px',
                  }}
                >
                  {liveWatchingStatus}
                </span>
              )}
            </div>
          )}

          {/* Sample Data / Fixture Badge */}
          {activeRun?.isFixture && !activeRun.isLive && (
            <span
              className="badge-status sample"
              title={activeRun.fixtureLabel || 'Read-only fixture data: synthetic sample artifacts'}
            >
              <AlertTriangle size={10} />
              SAMPLE DATA
            </span>
          )}

          {activeRun?.isLive && (
            <span
              className={`badge-status ${activeRun.liveStatus === 'live' ? 'pass' : 'empty'}`}
              title={activeRun.liveStatus === 'live'
                ? 'Live watched-project structure; tests are not rerun'
                : 'Stopped; displaying the last known watched-project map'}
            >
              {activeRun.liveStatus === 'live'
                ? `LIVE: ${activeRun.project}`
                : 'STOPPED · LAST KNOWN'}
            </span>
          )}

          {/* Persistent Compact Imported Label */}
          {activeRun?.isRealImport && !activeRun.isLive && (
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={`V3 static structure export: ${activeRun.contentSha256 || activeRun.id} • ${activeRun.project} @ ${activeRun.gitRevision.slice(0, 7)} - static structure${activeRun.v2RunCount ? ` / ${activeRun.v2RunCount} run${activeRun.v2RunCount > 1 ? 's' : ''}` : ''}`}
            >
              Imported{activeRun.v2RunCount && activeRun.v2RunCount > 1 ? ` (${activeRun.v2RunCount} runs)` : ''}
            </span>
          )}

          {/* Multiple Runs Switcher - hidden in live watch */}
          {runs.length > 1 && onSelectRun && activeRun && !activeRun.isLive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <select
                value={activeRun.id}
                onChange={(e) => onSelectRun(e.target.value)}
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#38bdf8',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  outline: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                aria-label="Switch active test run"
                title="Switch active test run evidence"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id.slice(0, 14)} ({r.fixtureLabel || r.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Outcome Summary Pill: Derived explicitly from RunOutcome - hidden in live watch */}
          {activeRun && !activeRun.isLive && (() => {
            const outcome = activeRun.runOutcome || (activeRun.harnessStatus as any);
            const isStructureOnly = activeRun.isRealImport && (activeRun.v2RunCount === 0 || !outcome);

            const isHarnessFailed =
              outcome === 'COLLECTION_ERROR' ||
              outcome === 'INFRASTRUCTURE_ERROR' ||
              outcome === 'MALFORMED_REPORT' ||
              (!outcome && activeRun.status === 'failed');

            const isTimeout = outcome === 'TIMEOUT';
            const isCancelled = outcome === 'CANCELLED';
            const isNoTests = outcome === 'NO_TESTS';

            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                  flexWrap: 'nowrap',
                }}
              >
                {/* 1. Structure only: when no V2 run was imported */}
                {isStructureOnly ? (
                  <span
                    className="badge-status empty"
                    title="Static structure export (no test runs imported)"
                  >
                    STRUCTURE ONLY
                  </span>
                ) : isNoTests ? (
                  /* 2. NO_TESTS: when a test run occurred but collected 0 tests */
                  <span
                    className="badge-status empty"
                    title="No tests collected during test run"
                  >
                    NO TESTS COLLECTED
                  </span>
                ) : isHarnessFailed ? (
                  /* 3. Harness Failure: COLLECTION_ERROR, INFRASTRUCTURE_ERROR, MALFORMED_REPORT */
                  <span
                    className="badge-status error"
                    title={activeRun.errorMessage || `Test harness failed: ${outcome || 'COLLECTION_ERROR'}`}
                  >
                    HARNESS FAILED
                  </span>
                ) : (
                  /* 4. Runs that executed tests or timed out / cancelled */
                  <>
                    {/* Failed / Error tests count */}
                    {totalProblemTests > 0 && (
                      <span
                        className="badge-status fail"
                        title={`${failedTestCount} failed, ${errorCount} error`}
                      >
                        {failedTestCount > 0 ? `${failedTestCount} FAILED` : ''}
                        {failedTestCount > 0 && errorCount > 0 ? ' · ' : ''}
                        {errorCount > 0 ? `${errorCount} ERROR` : ''}
                      </span>
                    )}

                    {/* Timeout Pill (may be shown alongside FAILED count; never hidden, never green) */}
                    {isTimeout && (
                      <span
                        className="badge-status error"
                        title={activeRun.errorMessage || "Test execution timed out"}
                      >
                        TIMED OUT
                      </span>
                    )}

                    {/* Cancelled Pill (may be shown alongside FAILED count; never hidden, never green) */}
                    {isCancelled && (
                      <span
                        className="badge-status error"
                        title={activeRun.errorMessage || "Test execution was cancelled"}
                      >
                        CANCELLED
                      </span>
                    )}

                    {/* Only show ALL PASSED when outcome is strictly PASSED and 0 failed/errored tests */}
                    {outcome === 'PASSED' && totalProblemTests === 0 && activeRun.stats.totalTests > 0 && (
                      <span className="badge-status pass" title="All tests passed">
                        ALL PASSED
                      </span>
                    )}

                    {/* Fallback if outcome === 'FAILED' but problem tests count is 0 */}
                    {outcome === 'FAILED' && totalProblemTests === 0 && (
                      <span className="badge-status fail" title="Run outcome: FAILED">
                        FAILED
                      </span>
                    )}

                    {/* Fixture empty scan fallback */}
                    {!outcome && activeRun.stats.totalTests === 0 && (
                      <span className="badge-status empty" title="No tests discovered in run">
                        EMPTY SCAN
                      </span>
                    )}

                    {/* Fixture all-passed fallback only when completed with tests and 0 problems and no outcome set */}
                    {!outcome && activeRun.status === 'completed' && totalProblemTests === 0 && activeRun.stats.totalTests > 0 && (
                      <span className="badge-status pass" title="All tests passed">
                        ALL PASSED
                      </span>
                    )}
                  </>
                )}

                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {formatDurationMs(activeRun.durationMs)}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Right: Workspace Views & Open JSON action */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            flexWrap: 'wrap',
            rowGap: '4px',
            // @ts-expect-error WebkitAppRegion
            WebkitAppRegion: 'no-drag',
          }}
        >
          {/* Open JSON Export Button - hidden in live watch */}
          {onOpenFiles && !activeRun?.isLive && (
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
          {activeRun?.isLive ? (
            <nav
              style={{
                display: 'flex',
                backgroundColor: 'var(--bg-app)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px',
                border: '1px solid var(--border-default)',
              }}
              aria-label="Live Workspace Views"
            >
              <button
                onClick={() => onSelectView('map')}
                className={activeView === 'map' ? 'btn-secondary' : 'btn-ghost'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: activeView === 'map' ? 600 : 400,
                  backgroundColor: activeView === 'map' ? 'var(--bg-active)' : 'transparent',
                }}
                aria-current={activeView === 'map' ? 'page' : undefined}
                aria-label="Map view"
              >
                <Layers size={12} />
                Map
              </button>

              <button
                onClick={() => onSelectView('files')}
                className={activeView === 'files' ? 'btn-secondary' : 'btn-ghost'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: activeView === 'files' ? 600 : 400,
                  backgroundColor: activeView === 'files' ? 'var(--bg-active)' : 'transparent',
                }}
                aria-current={activeView === 'files' ? 'page' : undefined}
                aria-label="Files view"
              >
                <FileText size={12} />
                Files
              </button>

              <button
                onClick={() => onSelectView('changes')}
                className={activeView === 'changes' ? 'btn-secondary' : 'btn-ghost'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: activeView === 'changes' ? 600 : 400,
                  backgroundColor: activeView === 'changes' ? 'var(--bg-active)' : 'transparent',
                }}
                aria-current={activeView === 'changes' ? 'page' : undefined}
                aria-label="Changes view"
              >
                <FileDiff size={12} />
                Changes
              </button>
            </nav>
          ) : (
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

              {(activeRun?.replayProvenance || runs.some((r) => r.replayProvenance)) && (
                <button
                  onClick={() => onSelectView('replay')}
                  className={activeView === 'replay' ? 'btn-secondary' : 'btn-ghost'}
                  style={{
                    padding: '3px 10px',
                    fontSize: '11px',
                    fontWeight: activeView === 'replay' ? 600 : 400,
                    backgroundColor: activeView === 'replay' ? 'var(--bg-active)' : 'transparent',
                  }}
                  aria-current={activeView === 'replay' ? 'page' : undefined}
                >
                  <RotateCcw size={12} />
                  Replay Comparison
                </button>
              )}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};
