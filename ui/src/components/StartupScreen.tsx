import React from 'react';
import { FolderOpen, ArrowRight } from 'lucide-react';
import type { RunSummary } from '../types';

interface StartupScreenProps {
  onSelectProject: () => void;
  isBusy?: boolean;
  hasBridge: boolean;
  statusNote?: string | null;
  activeRun?: RunSummary | null;
  onReturnToWorkspace?: () => void;
}

export const StartupScreen: React.FC<StartupScreenProps> = ({
  onSelectProject,
  isBusy = false,
  hasBridge,
  statusNote = null,
  activeRun = null,
  onReturnToWorkspace,
}) => {
  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

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
            maxWidth: '460px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '24px',
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
            Live architectural map and execution tracer for Python codebases.
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
