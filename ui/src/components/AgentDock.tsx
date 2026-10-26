import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Bot,
  ChevronUp,
  ChevronDown,
  X,
  Sparkles,
  Code2,
  Activity,
} from 'lucide-react';
import type { AgentSimulationStep, AgentLogEntry } from '../agent/agentSimulation';

interface AgentDockProps {
  currentStep: AgentSimulationStep;
  totalSteps: number;
  isPlaying: boolean;
  speed: number;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onReset: () => void;
  onSetSpeed: (speed: number) => void;
  onClose: () => void;
  logs: AgentLogEntry[];
}

export const AgentDock: React.FC<AgentDockProps> = ({
  currentStep,
  totalSteps,
  isPlaying,
  speed,
  onTogglePlay,
  onStepForward,
  onReset,
  onSetSpeed,
  onClose,
  logs,
}) => {
  const [isLogExpanded, setIsLogExpanded] = useState(false);

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'diagnosing':
        return '#ef4444';
      case 'tracing':
        return '#38bdf8';
      case 'inspecting':
        return '#60a5fa';
      case 'patching':
        return '#f59e0b';
      case 'verifying':
        return '#a855f7';
      case 'resolved':
        return '#10b981';
      default:
        return '#94a3b8';
    }
  };

  const phaseColor = getPhaseColor(currentStep.phase);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '18px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        pointerEvents: 'auto',
      }}
    >
      {/* Expandable Agent Thought Streamer Drawer */}
      {isLogExpanded && (
        <div
          style={{
            width: '640px',
            maxHeight: '230px',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            backdropFilter: 'blur(12px)',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#161e2e',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Bot size={13} style={{ color: phaseColor }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>
                Agent Real-Time Thought Stream ({logs.length} events)
              </span>
            </div>
            <button
              onClick={() => setIsLogExpanded(false)}
              className="btn-ghost"
              style={{ padding: '2px', color: 'var(--text-muted)' }}
            >
              <ChevronDown size={13} />
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
          >
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  lineHeight: 1.45,
                  padding: '4px 6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: `2px solid ${log.badge?.color || '#38bdf8'}`,
                }}
              >
                <span style={{ color: '#64748b', fontSize: '10px', flexShrink: 0 }}>
                  {log.timestamp}
                </span>
                {log.badge && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      color: log.badge.color,
                      backgroundColor: log.badge.bg,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      flexShrink: 0,
                    }}
                  >
                    {log.badge.text}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{log.title}</div>
                  <div style={{ color: '#94a3b8', fontSize: '10px' }}>{log.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Floating Dock Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          borderRadius: '24px',
          padding: '6px 14px',
          backdropFilter: 'blur(12px)',
          color: '#f8fafc',
        }}
      >
        {/* Agent Bot Indicator & Pulse */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              position: 'relative',
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: `${phaseColor}25`,
              border: `1.5px solid ${phaseColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {currentStep.phase === 'resolved' ? (
              <Sparkles size={13} style={{ color: phaseColor }} />
            ) : currentStep.phase === 'patching' ? (
              <Code2 size={13} style={{ color: phaseColor }} />
            ) : (
              <Bot
                size={13}
                style={{
                  color: phaseColor,
                  animation: isPlaying ? 'agentSpinSlow 8s linear infinite' : 'none',
                }}
              />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: phaseColor,
                  backgroundColor: `${phaseColor}20`,
                  padding: '1px 5px',
                  borderRadius: '3px',
                }}
              >
                {currentStep.phaseLabel}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>
                Step {currentStep.stepIndex + 1}/{totalSteps}
              </span>
            </div>
            <span
              style={{
                fontSize: '10px',
                color: '#94a3b8',
                maxWidth: '240px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={currentStep.headline}
            >
              {currentStep.headline}
            </span>
          </div>
        </div>

        <div style={{ width: '1px', height: '22px', backgroundColor: 'rgba(255, 255, 255, 0.12)' }} />

        {/* Playback Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={onTogglePlay}
            className="btn-secondary btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '50%',
              backgroundColor: isPlaying ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)',
              color: isPlaying ? '#0f172a' : '#f8fafc',
              border: 'none',
              cursor: 'pointer',
            }}
            title={isPlaying ? 'Pause simulation' : 'Play autonomous agent simulation'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: '1px' }} />}
          </button>

          <button
            onClick={onStepForward}
            className="btn-ghost btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
            title="Step forward to next phase"
            aria-label="Step Forward"
          >
            <SkipForward size={13} />
          </button>

          <button
            onClick={onReset}
            className="btn-ghost btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
            title="Reset simulation to beginning"
            aria-label="Reset Simulation"
          >
            <RotateCcw size={12} />
          </button>
        </div>

        <div style={{ width: '1px', height: '22px', backgroundColor: 'rgba(255, 255, 255, 0.12)' }} />

        {/* Speed Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {[0.5, 1, 2].map((s) => (
            <button
              key={s}
              onClick={() => onSetSpeed(s)}
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '3px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: speed === s ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: speed === s ? '#38bdf8' : '#94a3b8',
              }}
              title={`${s}x execution playback speed`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div style={{ width: '1px', height: '22px', backgroundColor: 'rgba(255, 255, 255, 0.12)' }} />

        {/* Toggle Thought Stream Drawer */}
        <button
          onClick={() => setIsLogExpanded(!isLogExpanded)}
          className="btn-ghost btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            padding: '3px 7px',
            color: isLogExpanded ? '#38bdf8' : '#94a3b8',
            cursor: 'pointer',
          }}
          title="Toggle agent thought and execution logs"
          aria-label="Toggle Agent Thought Stream"
        >
          <Activity size={12} />
          <span>Thoughts ({logs.length})</span>
          {isLogExpanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="btn-ghost btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            padding: 0,
            color: '#64748b',
            cursor: 'pointer',
            marginLeft: '2px',
          }}
          title="Exit agent simulation mode"
          aria-label="Exit Agent Mode"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
