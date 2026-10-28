import React, { useState } from 'react';
import { FolderOpen, ArrowRight, Terminal, Copy, Check } from 'lucide-react';
import type { RunSummary } from '../types';

interface StartupScreenProps {
  onSelectProject: () => void;
  isBusy?: boolean;
  hasBridge: boolean;
  statusNote?: string | null;
  activeRun?: RunSummary | null;
  onReturnToWorkspace?: () => void;
  onOpenRecording?: () => void;
}

export const StartupScreen: React.FC<StartupScreenProps> = ({
  onSelectProject,
  isBusy = false,
  hasBridge,
  statusNote = null,
  activeRun = null,
  onReturnToWorkspace,
  onOpenRecording,
}) => {
  const [copied, setCopied] = useState(false);

  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const exampleCopyCmd = 'cp -r examples/vscode_playground ~/Desktop/faultmesh-playground';

  const handleCopyCmd = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(exampleCopyCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: '#101114',
        color: '#f8fafc',
        fontFamily: 'var(--font-sans)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {/* Draggable Titlebar Region for Desktop Window Movement & Resizing */}
      <div
        data-testid="startup-titlebar"
        style={{
          height: '42px',
          width: '100%',
          flexShrink: 0,
          // @ts-expect-error WebkitAppRegion
          WebkitAppRegion: 'drag',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: isMacDesktop ? '78px' : '16px',
          paddingRight: '16px',
          boxSizing: 'border-box',
        }}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '560px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                margin: 0,
                color: '#ffffff',
              }}
            >
              FaultMesh
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: '1.5',
              }}
            >
              FaultMesh works with Python projects only (it reads your .py files).
            </p>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: 'var(--text-muted)',
                lineHeight: '1.4',
              }}
            >
              Live architectural map and execution tracer for Python codebases. Choose the folder containing your Python code.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
            }}
          >
            <button
              onClick={onSelectProject}
              disabled={!hasBridge || isBusy}
              className="btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                cursor: !hasBridge || isBusy ? 'not-allowed' : 'pointer',
                minWidth: '170px',
              }}
              aria-label="Select project"
            >
              <FolderOpen size={16} />
              <span>{isBusy ? 'Opening…' : 'Select project'}</span>
            </button>

            {onOpenRecording && (
              <button
                onClick={onOpenRecording}
                className="btn-ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 'var(--radius-sm)',
                }}
                aria-label="Open recording"
              >
                <span>Open recording (.json)</span>
              </button>
            )}

            {!hasBridge && (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  lineHeight: '1.4',
                }}
              >
                Desktop app required to watch local projects
              </div>
            )}

            {activeRun && onReturnToWorkspace && (
              <button
                onClick={onReturnToWorkspace}
                className="btn-ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  marginTop: '4px',
                  cursor: 'pointer',
                }}
                aria-label="Return to workspace"
              >
                <span>Return to workspace ({activeRun.project})</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>

          {/* 3-Step Try An Example Card */}
          <div
            data-testid="startup-example-card"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
              width: '100%',
              textAlign: 'left',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#f8fafc',
              }}
            >
              <Terminal size={14} color="#38bdf8" />
              <span>No project yet? Try the included example</span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '11px',
                color: 'var(--text-secondary)',
                lineHeight: '1.45',
              }}
            >
              Try FaultMesh with the bundled playground repository in three simple steps:
            </p>
            <ol
              style={{
                margin: 0,
                paddingLeft: '18px',
                fontSize: '11px',
                color: 'var(--text-secondary)',
                lineHeight: '1.5',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <li>
                <span>Make a throwaway copy in your terminal:</span>
                <div
                  style={{
                    backgroundColor: '#0a0d14',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9.5px',
                    color: '#38bdf8',
                    marginTop: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <code style={{ overflowX: 'auto', whiteSpace: 'nowrap', fontSize: '9.5px' }}>
                    {exampleCopyCmd}
                  </code>
                  <button
                    onClick={handleCopyCmd}
                    className="btn-ghost btn-sm"
                    style={{
                      padding: '2px 5px',
                      fontSize: '10px',
                      color: copied ? '#34d399' : 'var(--text-muted)',
                      flexShrink: 0,
                      cursor: 'pointer',
                    }}
                    title="Copy to clipboard"
                    aria-label="Copy command"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </li>
              <li>
                Click <strong>Select project</strong> above and choose the copied folder (<code>faultmesh-playground</code>).
              </li>
              <li>
                Open and save any edit to a <code>.py</code> file in your editor to see changes appear live.
              </li>
            </ol>
          </div>

          {statusNote && (
            <div
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 14px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {statusNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
