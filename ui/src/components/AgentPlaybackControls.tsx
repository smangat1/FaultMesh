import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Target,
  X,
  Bot,
} from 'lucide-react';
import type { AgentPhase } from '../agent/agentSimulation';

interface AgentPlaybackControlsProps {
  currentStepIndex: number;
  totalSteps: number;
  currentPhase: AgentPhase;
  phaseLabel: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrevStep: () => void;
  onNextStep: () => void;
  onRestart: () => void;
  onJumpToStep: (step: number) => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  isCameraTrackingPaused: boolean;
  onResumeTracking: () => void;
  onClose: () => void;
  isInspectorOpen?: boolean;
}

const PHASE_COLORS: Record<AgentPhase, string> = {
  idle: '#94a3b8',
  diagnosing: '#ef4444',
  tracing: '#38bdf8',
  inspecting: '#f59e0b',
  patching: '#f59e0b',
  verifying: '#a855f7',
  resolved: '#10b981',
};

const PHASE_NAMES = ['Diagnose', 'Trace', 'Inspect', 'Patch', 'Verify', 'Resolved'];

export const AgentPlaybackControls: React.FC<AgentPlaybackControlsProps> = ({
  currentStepIndex,
  totalSteps,
  currentPhase,
  phaseLabel,
  isPlaying,
  onTogglePlay,
  onPrevStep,
  onNextStep,
  onRestart,
  onJumpToStep,
  speed,
  onChangeSpeed,
  isCameraTrackingPaused,
  onResumeTracking,
  onClose,
  isInspectorOpen = false,
}) => {
  const activeColor = PHASE_COLORS[currentPhase] || '#38bdf8';
  const [isNarrow, setIsNarrow] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1200 : false
  );

  React.useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 1200);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const drawerWidth = isNarrow ? 330 : 400;
  const centerShift = isInspectorOpen ? Math.round(drawerWidth / 2) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        left: isInspectorOpen ? `calc(50% - ${centerShift}px)` : '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '5px 12px',
        backgroundColor: 'rgba(15, 23, 42, 0.94)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '8px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(12px)',
        color: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        maxWidth: 'calc(100% - 24px)',
        overflowX: 'auto',
      }}
      role="region"
      aria-label="Agent Playback Controls"
    >
      {/* 1. Simulation Demarcation Pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 7px',
          borderRadius: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          flexShrink: 0,
        }}
        title="This scripted investigation demonstrates FaultMesh navigation and remediation"
      >
        <Bot size={13} style={{ color: activeColor }} />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: '#f8fafc',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span className="agent-pill-label-full">Sample Playback</span>
          <span className="agent-pill-label-short">Demo</span>
        </span>
        <span
          style={{
            fontSize: '9px',
            color: activeColor,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            backgroundColor: `${activeColor}20`,
            padding: '1px 4px',
            borderRadius: '2px',
          }}
        >
          {phaseLabel}
        </span>
      </div>

      {/* 2. Primary Playback Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
        <button
          onClick={onRestart}
          className="btn-ghost btn-sm"
          style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}
          title="Restart investigation demo"
          aria-label="Restart Investigation"
        >
          <RotateCcw size={12} />
        </button>

        <button
          onClick={onPrevStep}
          disabled={currentStepIndex === 0}
          className="btn-ghost btn-sm"
          style={{ padding: '3px 6px', color: currentStepIndex === 0 ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          title="Previous step"
          aria-label="Previous Step"
        >
          <ChevronLeft size={13} />
        </button>

        <button
          onClick={onTogglePlay}
          className="btn-secondary btn-sm"
          style={{
            padding: '3px 8px',
            fontWeight: 600,
            fontSize: '11px',
            backgroundColor: isPlaying ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-raised)',
            borderColor: isPlaying ? 'rgba(56, 189, 248, 0.4)' : 'var(--border-default)',
            color: isPlaying ? '#38bdf8' : 'var(--text-primary)',
          }}
          title={isPlaying ? 'Pause investigation playback' : 'Play investigation playback'}
          aria-label={isPlaying ? 'Pause Investigation' : 'Play Investigation'}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          <span className="agent-btn-label">{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        <button
          onClick={onNextStep}
          disabled={currentStepIndex === totalSteps - 1}
          className="btn-ghost btn-sm"
          style={{
            padding: '3px 6px',
            color: currentStepIndex === totalSteps - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
          }}
          title="Next step"
          aria-label="Next Step"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* 3. 6 Progressive Step Dots / Phase Pills */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          padding: '2px 6px',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          borderRadius: '5px',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          flexShrink: 0,
        }}
      >
        {PHASE_NAMES.map((name, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isCompleted = idx < currentStepIndex;
          return (
            <button
              key={name}
              onClick={() => onJumpToStep(idx)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: isCurrent ? 700 : 500,
                border: 'none',
                backgroundColor: isCurrent ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                color: isCurrent
                  ? activeColor
                  : isCompleted
                  ? 'var(--text-secondary)'
                  : 'var(--text-muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title={`Jump to step ${idx + 1}: ${name}`}
              aria-label={`Step ${idx + 1}: ${name}`}
            >
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: isCurrent
                    ? activeColor
                    : isCompleted
                    ? 'rgba(255, 255, 255, 0.4)'
                    : 'rgba(255, 255, 255, 0.15)',
                }}
              />
              <span className="agent-step-name-full">{name}</span>
              <span className="agent-step-name-short">{isCurrent ? name : (idx + 1)}</span>
            </button>
          );
        })}
      </div>

      {/* 4. Speed Multipliers */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          borderRadius: '4px',
          padding: '1px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        {[0.5, 1, 2].map((s) => (
          <button
            key={s}
            onClick={() => onChangeSpeed(s)}
            style={{
              padding: '2px 6px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: speed === s ? 700 : 500,
              backgroundColor: speed === s ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
              color: speed === s ? '#ffffff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
            title={`Set playback speed to ${s}x`}
            aria-label={`${s}x speed`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* 5. Camera Tracking Override / Resume Pill */}
      {isCameraTrackingPaused && (
        <button
          onClick={onResumeTracking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 600,
            backgroundColor: 'rgba(56, 189, 248, 0.2)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            cursor: 'pointer',
            flexShrink: 0,
            animation: 'agentBreathingPulse 2s infinite',
          }}
          title="Manual pan detected. Click to center and follow investigation camera"
          aria-label="Resume Camera Tracking"
        >
          <Target size={11} />
          <span>Follow Camera</span>
        </button>
      )}

      {/* 6. Close / Exit Button */}
      <button
        onClick={onClose}
        className="btn-ghost btn-sm"
        style={{ padding: '3px 6px', color: 'var(--text-muted)', marginLeft: '2px', flexShrink: 0 }}
        title="Exit agent playback mode"
        aria-label="Exit Agent Playback"
      >
        <X size={13} />
      </button>
    </div>
  );
};
