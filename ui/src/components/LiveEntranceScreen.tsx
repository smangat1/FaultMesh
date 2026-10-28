import React from 'react';
import { Layers, FileText, FileDiff, ArrowRight, ChevronLeft, AlertTriangle, FolderOpen } from 'lucide-react';

export interface LiveEntranceScreenProps {
  projectName?: string | null;
  filesCount: number;
  nodesCount: number;
  changedFilesCount: number;
  lastSavedText?: string | null;
  liveStatus?: 'live' | 'stopped';
  onSelectMode: (mode: 'map' | 'files' | 'changes') => void;
  onBackToSelector?: () => void;
  onSelectAnotherProject?: () => void;
}

export const LiveEntranceScreen: React.FC<LiveEntranceScreenProps> = ({
  projectName = 'Watched Project',
  filesCount,
  nodesCount,
  changedFilesCount,
  lastSavedText = 'just now',
  liveStatus = 'live',
  onSelectMode,
  onBackToSelector,
  onSelectAnotherProject,
}) => {
  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const isLive = liveStatus === 'live';

  return (
    <div
      data-testid="live-entrance-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: '#101114',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top Header Region (Draggable on Desktop) */}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            paddingLeft: isMacDesktop ? '78px' : '16px',
            minHeight: '42px',
            boxSizing: 'border-box',
            gap: '12px',
          }}
        >
          {/* Left: Back to Projects & Active Project Context */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              // @ts-expect-error WebkitAppRegion
              WebkitAppRegion: 'no-drag',
            }}
          >
            {onBackToSelector && (
              <button
                onClick={onBackToSelector}
                data-testid="entrance-back-to-projects"
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
                title="Return to Projects selector"
                aria-label="Return to Projects"
              >
                <ChevronLeft size={13} />
                <span>Projects</span>
              </button>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
              }}
            >
              <span style={{ fontWeight: 600 }}>{projectName}</span>
              <span
                className={`badge-status ${isLive ? 'pass' : 'empty'}`}
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                }}
              >
                {isLive ? `LIVE: ${projectName}` : 'STOPPED · LAST KNOWN'}
              </span>
            </div>
          </div>

          {/* Right: Spectate Status context note */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              // @ts-expect-error WebkitAppRegion
              WebkitAppRegion: 'no-drag',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: filesCount === 0 ? '#ef4444' : isLive ? '#22c55e' : '#64748b',
                display: 'inline-block',
              }}
            />
            <span>
              {filesCount === 0
                ? '0 Python files found'
                : isLive
                ? `Watching ${filesCount} Python ${filesCount === 1 ? 'file' : 'files'} (saved changes update live)`
                : 'Spectate stopped'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
          boxSizing: 'border-box',
          minHeight: 0,
        }}
      >
        <div
          style={{
            maxWidth: '960px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '32px',
          }}
        >
          {/* Calm Header Section */}
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: 0,
                color: '#ffffff',
              }}
            >
              Project Workspace
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                margin: 0,
                lineHeight: '1.4',
              }}
            >
              {filesCount === 0
                ? 'FaultMesh requires a folder containing Python code (.py files).'
                : 'Select a mode to inspect live project structure, browse files, or review changes on disk.'}
            </p>
          </div>

          {/* If 0 Python files found: Honest Clear Message & Pick Another Folder */}
          {filesCount === 0 ? (
            <div
              data-testid="no-python-files-banner"
              style={{
                maxWidth: '520px',
                width: '100%',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '12px',
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '14px',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#f87171',
                }}
              >
                <AlertTriangle size={22} />
              </div>

              <div>
                <h2
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: '#f8fafc',
                    margin: '0 0 6px 0',
                  }}
                >
                  No Python files found
                </h2>
                <p
                  style={{
                    fontSize: '13px',
                    color: '#cbd5e1',
                    margin: 0,
                    lineHeight: '1.5',
                  }}
                >
                  No Python files found in this folder. Pick the folder that contains your .py code.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '8px',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                {onSelectAnotherProject && (
                  <button
                    onClick={onSelectAnotherProject}
                    data-testid="entrance-pick-another-folder"
                    className="btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 18px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    aria-label="Pick another folder"
                  >
                    <FolderOpen size={15} />
                    <span>Pick another folder</span>
                  </button>
                )}
                {onBackToSelector && (
                  <button
                    onClick={onBackToSelector}
                    className="btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                    aria-label="Return to Start"
                  >
                    <span>Return to Start</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Three Large Widget Cards */
            <div
              className="entrance-cards-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '20px',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* Card 1: Map */}
              <button
                onClick={() => onSelectMode('map')}
                data-testid="entrance-card-map"
                className="entrance-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '24px 20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  minHeight: '180px',
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                aria-label="Enter Map mode"
              >
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(56, 189, 248, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#38bdf8',
                      }}
                    >
                      <Layers size={22} />
                    </div>
                    <div
                      className="entrance-card-arrow"
                      style={{
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'transform 0.15s ease, color 0.15s ease',
                      }}
                    >
                      <ArrowRight size={16} />
                    </div>
                  </div>

                  <div>
                    <h2
                      style={{
                        fontSize: '17px',
                        fontWeight: 600,
                        color: '#f8fafc',
                        margin: '0 0 6px 0',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Map
                    </h2>
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        margin: 0,
                        lineHeight: '1.45',
                      }}
                    >
                      Interactive structural map of your files and dependencies.
                    </p>
                  </div>
                </div>

                {/* Live Status Pill */}
                <div
                  style={{
                    marginTop: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '14px',
                    padding: '3px 10px',
                  }}
                >
                  <span>{filesCount} Python {filesCount === 1 ? 'file' : 'files'}, {nodesCount} nodes</span>
                </div>
              </button>

              {/* Card 2: Files */}
              <button
                onClick={() => onSelectMode('files')}
                data-testid="entrance-card-files"
                className="entrance-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '24px 20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  minHeight: '180px',
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                aria-label="Enter Files mode"
              >
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(52, 211, 153, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#34d399',
                      }}
                    >
                      <FileText size={22} />
                    </div>
                    <div
                      className="entrance-card-arrow"
                      style={{
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'transform 0.15s ease, color 0.15s ease',
                      }}
                    >
                      <ArrowRight size={16} />
                    </div>
                  </div>

                  <div>
                    <h2
                      style={{
                        fontSize: '17px',
                        fontWeight: 600,
                        color: '#f8fafc',
                        margin: '0 0 6px 0',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Files
                    </h2>
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        margin: 0,
                        lineHeight: '1.45',
                      }}
                    >
                      Explore project files, symbol counts, and line lengths.
                    </p>
                  </div>
                </div>

                {/* Live Status Pill */}
                <div
                  style={{
                    marginTop: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: '#34d399',
                    backgroundColor: 'rgba(52, 211, 153, 0.08)',
                    border: '1px solid rgba(52, 211, 153, 0.2)',
                    borderRadius: '14px',
                    padding: '3px 10px',
                  }}
                >
                  <span>{filesCount} Python {filesCount === 1 ? 'file' : 'files'}, last saved {lastSavedText}</span>
                </div>
              </button>

              {/* Card 3: Changes */}
              <button
                onClick={() => onSelectMode('changes')}
                data-testid="entrance-card-changes"
                className="entrance-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '24px 20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  minHeight: '180px',
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                aria-label="Enter Changes mode"
              >
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(251, 191, 36, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fbbf24',
                      }}
                    >
                      <FileDiff size={22} />
                    </div>
                    <div
                      className="entrance-card-arrow"
                      style={{
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'transform 0.15s ease, color 0.15s ease',
                      }}
                    >
                      <ArrowRight size={16} />
                    </div>
                  </div>

                  <div>
                    <h2
                      style={{
                        fontSize: '17px',
                        fontWeight: 600,
                        color: '#f8fafc',
                        margin: '0 0 6px 0',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Changes
                    </h2>
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        margin: 0,
                        lineHeight: '1.45',
                      }}
                    >
                      Review files modified on disk and inspect line-by-line diffs.
                    </p>
                  </div>
                </div>

                {/* Live Status Pill */}
                <div
                  style={{
                    marginTop: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: changedFilesCount > 0 ? '#fbbf24' : 'var(--text-secondary)',
                    backgroundColor: changedFilesCount > 0 ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                    border: changedFilesCount > 0 ? '1px solid rgba(251, 191, 36, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '3px 10px',
                  }}
                >
                  <span>{changedFilesCount} {changedFilesCount === 1 ? 'file' : 'files'} changed on disk</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
