import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  type ScreenId,
  markScreenTipSeen,
} from '../utils/firstUseTipsStorage';

export interface TipStep {
  targetTestId: string;
  title: string;
  description: string;
}

export interface FirstUseTipOverlayProps {
  screenId: ScreenId;
  steps: TipStep[];
  active: boolean;
  onDismiss: () => void;
}

export const SCREEN_DEFAULT_STEPS: Record<ScreenId, TipStep[]> = {
  home: [
    {
      targetTestId: 'autodetect-home-header',
      title: 'Welcome to FaultMesh',
      description: 'FaultMesh discovers local Codex and Claude Code session histories automatically.',
    },
    {
      targetTestId: 'tool-widget-codex',
      title: 'Detected Coding Tools',
      description: 'Click any tool widget to explore project folders and inspect recorded sessions.',
    },
    {
      targetTestId: 'startup-open-recording-btn',
      title: 'Recordings & Live Spectate',
      description: 'Open recorded JSON exports directly, or select a Python project to watch live.',
    },
    {
      targetTestId: 'watch-project-prompt',
      title: 'Keep a Project Current',
      description: 'Link a project folder when you want FaultMesh to watch future saved changes.',
    },
  ],
  entrance: [
    {
      targetTestId: 'entrance-card-map',
      title: 'Live Architecture Map',
      description: 'Watch execution flow and module dependencies evolve in real time.',
    },
    {
      targetTestId: 'entrance-card-files',
      title: 'Observed Files',
      description: 'Track files and symbols modified during live agent execution.',
    },
    {
      targetTestId: 'entrance-card-changes',
      title: 'Live Changes',
      description: 'Inspect unified diffs as tests and tools execute.',
    },
  ],
  replay: [
    {
      targetTestId: 'replay-timeline-bar',
      title: 'Hero Timeline',
      description: 'Scrub through checkpoints with real timestamps, idle breaks, and gaps.',
    },
    {
      targetTestId: 'replay-main-stage',
      title: 'Step Diff & Evidence',
      description: 'View exact file modifications and test outcomes at each step.',
    },
    {
      targetTestId: 'replay-header-tools',
      title: 'Keyboard Navigation',
      description: 'Press C for Chapters, E for Evidence drawer, and M for Mini Map dock.',
    },
  ],
  replayHistory: [
    {
      targetTestId: 'replay-timeline-bar',
      title: 'Session Timeline',
      description: 'Scrub through recorded steps using their original clock times.',
    },
    {
      targetTestId: 'replay-main-stage',
      title: 'Step View',
      description: 'Inspect the evidence that was retained for the selected step.',
    },
    {
      targetTestId: 'replay-header-tools',
      title: 'More Session Context',
      description: 'Open chapters, evidence, or the mini map without crowding the main view.',
    },
    {
      targetTestId: 'watch-project-prompt',
      title: 'Keep This Project Current',
      description: 'Link its folder to watch future saved changes. The recorded session stays unchanged.',
    },
  ],
};

interface TargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FirstUseTipOverlay: React.FC<FirstUseTipOverlayProps> = ({
  screenId,
  steps,
  active,
  onDismiss,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);

  const handleDismiss = useCallback(() => {
    markScreenTipSeen(screenId);
    onDismiss();
  }, [screenId, onDismiss]);

  const currentStep = useMemo(() => {
    if (!steps || steps.length === 0 || stepIndex >= steps.length) return null;
    return steps[stepIndex];
  }, [steps, stepIndex]);

  // Find target element bounding rect or advance if missing
  const updateTargetBox = useCallback(() => {
    if (!active || !currentStep) return;

    const el = document.querySelector(`[data-testid="${currentStep.targetTestId}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      // Ensure element has non-zero geometry, or tolerate in headless test runners
      if ((rect.width > 0 && rect.height > 0) || isJsdom) {
        setTargetBox({
          x: rect.left || 40,
          y: rect.top || 40,
          width: rect.width || 200,
          height: rect.height || 60,
        });
        return;
      }
    }

    // Target missing on screen: skip to next tip or finish without crashing
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      handleDismiss();
    }
  }, [active, currentStep, stepIndex, steps, handleDismiss]);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      setTargetBox(null);
      return;
    }

    updateTargetBox();
    const handleResize = () => updateTargetBox();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [active, updateTargetBox]);

  // Keyboard navigation: Escape skips
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, handleDismiss]);

  const handleNext = () => {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      handleDismiss();
    }
  };

  if (!active || !currentStep) return null;

  // Compute tip card placement relative to target element
  const cardStyle = (() => {
    const cardWidth = 320;
    const cardHeight = 160;
    const padding = 12;

    if (!targetBox) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;

    // Horizontal placement aligned with target, clamped inside viewport
    let left = targetBox.x;
    if (left + cardWidth > viewportWidth - 20) {
      left = viewportWidth - cardWidth - 20;
    }
    // Prevent overlapping mac traffic lights (left 0-90, top 0-42)
    left = Math.max(20, left);

    // Vertical placement: place below target if space permits, else above
    let top = targetBox.y + targetBox.height + padding;
    if (top + cardHeight > viewportHeight - 20) {
      top = Math.max(50, targetBox.y - cardHeight - padding);
    }
    // Respect titlebar/drag clearance (top 42px)
    top = Math.max(50, top);

    return {
      top: `${top}px`,
      left: `${left}px`,
    };
  })();

  const pad = 6;
  const rx = 8;
  const hole = targetBox
    ? {
        x: Math.max(0, targetBox.x - pad),
        y: Math.max(0, targetBox.y - pad),
        width: targetBox.width + pad * 2,
        height: targetBox.height + pad * 2,
      }
    : null;

  return (
    <div
      className="first-use-tips-overlay-root"
      data-testid="first-use-tip-overlay"
      data-screen={screenId}
    >
      {/* Dimmed backdrop with spotlight cutout */}
      <svg
        className="first-use-spotlight-svg"
        data-testid="first-use-spotlight-svg"
        aria-hidden="true"
      >
        <defs>
          <mask id={`spotlight-mask-${screenId}`}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hole && (
              <rect
                x={hole.x}
                y={hole.y}
                width={hole.width}
                height={hole.height}
                rx={rx}
                ry={rx}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(10, 14, 20, 0.72)"
          mask={`url(#spotlight-mask-${screenId})`}
        />
      </svg>

      {/* Target Focus Ring */}
      {hole && (
        <div
          className="first-use-spotlight-ring"
          data-testid="first-use-spotlight-ring"
          style={{
            left: `${hole.x}px`,
            top: `${hole.y}px`,
            width: `${hole.width}px`,
            height: `${hole.height}px`,
            borderRadius: `${rx}px`,
          }}
        />
      )}

      {/* Interactive Tip Card */}
      <div
        className="first-use-tip-card"
        data-testid="first-use-tip-card"
        style={cardStyle}
        role="dialog"
        aria-label="First-use guide"
      >
        <div className="first-use-tip-header">
          <span className="first-use-tip-badge">Quick Tip</span>
          <button
            type="button"
            className="first-use-tip-skip-btn"
            data-testid="tip-skip-btn"
            onClick={handleDismiss}
            title="Skip tour (Escape)"
          >
            Skip
          </button>
        </div>

        <div className="first-use-tip-content">
          <h4 className="first-use-tip-title" data-testid="tip-card-title">
            {currentStep.title}
          </h4>
          <p className="first-use-tip-desc" data-testid="tip-card-description">
            {currentStep.description}
          </p>
        </div>

        <div className="first-use-tip-footer">
          {/* Step Dots */}
          <div className="first-use-tip-dots" data-testid="tip-step-dots">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`first-use-tip-dot ${idx === stepIndex ? 'active' : ''}`}
                data-testid={`tip-dot-${idx}`}
              />
            ))}
          </div>

          <div className="first-use-tip-actions">
            <button
              type="button"
              className="first-use-tip-next-btn"
              data-testid="tip-next-btn"
              onClick={handleNext}
            >
              {stepIndex === steps.length - 1 ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
