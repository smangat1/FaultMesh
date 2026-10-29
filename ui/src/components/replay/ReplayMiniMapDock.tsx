import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GraphData, TestItem } from '../../types';
import { GraphView } from '../GraphView';
import {
  Layers,
  Maximize2,
  Minimize2,
  X,
  Info,
  Move,
} from 'lucide-react';

export type MiniMapSizeState = 'small' | 'medium' | 'full';

interface PersistedMiniMapState {
  isOpen: boolean;
  sizeState: MiniMapSizeState;
  customWidth?: number;
  customHeight?: number;
}

const STORAGE_KEY = 'faultmesh:replay:minimap:state';

export interface ReplayMiniMapDockProps {
  isOpen: boolean;
  onClose: () => void;
  graphData?: GraphData | null;
  tests?: TestItem[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  selectedFile?: string | null;
  onSelectFile?: (file: string | null) => void;
}

export const ReplayMiniMapDock: React.FC<ReplayMiniMapDockProps> = ({
  isOpen,
  onClose,
  graphData,
  tests,
  selectedNodeId,
  onSelectNode,
  selectedFile,
  onSelectFile,
}) => {
  // Load persisted size state from localStorage if available
  const [sizeState, setSizeState] = useState<MiniMapSizeState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedMiniMapState;
        if (parsed.sizeState && ['small', 'medium', 'full'].includes(parsed.sizeState)) {
          return parsed.sizeState;
        }
      }
    } catch {
      // Ignore localStorage errors (e.g. security or private browsing)
    }
    return 'small';
  });

  const [customDimensions, setCustomDimensions] = useState<{ width: number; height: number } | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedMiniMapState;
        if (parsed.customWidth && parsed.customHeight) {
          return { width: parsed.customWidth, height: parsed.customHeight };
        }
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // Persist state updates to localStorage
  useEffect(() => {
    try {
      const payload: PersistedMiniMapState = {
        isOpen,
        sizeState,
        customWidth: customDimensions?.width,
        customHeight: customDimensions?.height,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore
    }
  }, [isOpen, sizeState, customDimensions]);

  // Size cycle button: small -> medium -> full -> small
  const handleCycleSize = useCallback(() => {
    setSizeState((prev) => {
      if (prev === 'small') return 'medium';
      if (prev === 'medium') return 'full';
      return 'small';
    });
    // Reset custom dimensions when cycling presets
    setCustomDimensions(null);
  }, []);

  // Free resize drag handlers
  const handleResizeStart = useCallback(
    (clientX: number, clientY: number) => {
      const dock = dockRef.current;
      if (!dock) return;
      const rect = dock.getBoundingClientRect();
      dragStartRef.current = {
        startX: typeof clientX === 'number' && !isNaN(clientX) ? clientX : 0,
        startY: typeof clientY === 'number' && !isNaN(clientY) ? clientY : 0,
        startW: rect.width || (sizeState === 'medium' ? 400 : 240),
        startH: rect.height || (sizeState === 'medium' ? 260 : 160),
      };
      setIsDraggingResize(true);
    },
    [sizeState]
  );

  useEffect(() => {
    if (!isDraggingResize) return;

    const handleMove = (e: MouseEvent | PointerEvent) => {
      if (!dragStartRef.current) return;
      const clientX = typeof e.clientX === 'number' && !isNaN(e.clientX) ? e.clientX : dragStartRef.current.startX;
      const clientY = typeof e.clientY === 'number' && !isNaN(e.clientY) ? e.clientY : dragStartRef.current.startY;
      const startW = typeof dragStartRef.current.startW === 'number' && !isNaN(dragStartRef.current.startW) ? dragStartRef.current.startW : 240;
      const startH = typeof dragStartRef.current.startH === 'number' && !isNaN(dragStartRef.current.startH) ? dragStartRef.current.startH : 160;
      const deltaX = dragStartRef.current.startX - clientX;
      const deltaY = dragStartRef.current.startY - clientY;
      const newW = Math.max(200, Math.min(900, Math.round(startW + deltaX)));
      const newH = Math.max(140, Math.min(650, Math.round(startH + deltaY)));
      setCustomDimensions({ width: newW, height: newH });
    };

    const handleUp = () => {
      setIsDraggingResize(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingResize]);

  // Handle keyboard arrow resize in 20px steps
  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    if (sizeState === 'full') return;
    const step = 20;
    const curW = customDimensions?.width ?? (sizeState === 'medium' ? 400 : 240);
    const curH = customDimensions?.height ?? (sizeState === 'medium' ? 260 : 160);

    let nextW = curW;
    let nextH = curH;

    if (e.key === 'ArrowLeft') {
      // Anchored at bottom-right; moving handle left widens the dock
      nextW = Math.min(900, Math.max(200, curW + step));
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'ArrowRight') {
      // Moving handle right narrows the dock
      nextW = Math.min(900, Math.max(200, curW - step));
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'ArrowUp') {
      // Anchored at bottom-right; moving handle up increases dock height
      nextH = Math.min(650, Math.max(140, curH + step));
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'ArrowDown') {
      // Moving handle down decreases dock height
      nextH = Math.min(650, Math.max(140, curH - step));
      e.preventDefault();
      e.stopPropagation();
    } else {
      return;
    }

    setCustomDimensions({ width: nextW, height: nextH });
  };

  // Replay exports carry no graph edges; honest empty state is shown when no edges or nodes exist
  const hasStructureData = Boolean(
    graphData &&
    graphData.nodes &&
    graphData.nodes.length > 0 &&
    graphData.edges &&
    graphData.edges.length > 0
  );

  if (!isOpen) {
    return null;
  }

  // Dimension determination
  let currentWidth: number | string = 240;
  let currentHeight: number | string = 160;

  if (sizeState === 'full') {
    currentWidth = '100%';
    currentHeight = '100%';
  } else if (customDimensions) {
    currentWidth = customDimensions.width;
    currentHeight = customDimensions.height;
  } else if (sizeState === 'medium') {
    currentWidth = 400;
    currentHeight = 260;
  } else {
    currentWidth = 240;
    currentHeight = 160;
  }

  return (
    <div
      ref={dockRef}
      style={{
        position: 'absolute',
        bottom: sizeState === 'full' ? 0 : '16px',
        right: sizeState === 'full' ? 0 : '16px',
        top: sizeState === 'full' ? 0 : undefined,
        left: sizeState === 'full' ? 0 : undefined,
        width: currentWidth,
        height: currentHeight,
        zIndex: 50,
        backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
        border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.08))',
        borderRadius: sizeState === 'full' ? 0 : 'var(--replay-radius-card, 10px)',
        boxShadow: sizeState === 'full' ? 'none' : '0 10px 30px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: isDraggingResize ? 'none' : 'width 180ms ease, height 180ms ease',
      }}
      data-testid="replay-minimap-dock"
      aria-label="Project Structure Mini Map"
    >
      {/* Mini Map Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
          userSelect: 'none',
          flexShrink: 0,
        }}
        data-testid="replay-minimap-header"
      >
        {/* Left: Drag/Keyboard resize handle + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {sizeState !== 'full' && (
            <div
              tabIndex={0}
              role="slider"
              aria-label="Resize project map dock"
              aria-valuenow={customDimensions?.width ?? (sizeState === 'medium' ? 400 : 240)}
              aria-valuemin={200}
              aria-valuemax={900}
              onKeyDown={handleResizeKeyDown}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleResizeStart(e.clientX, e.clientY);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleResizeStart(e.clientX, e.clientY);
              }}
              style={{
                cursor: 'nwse-resize',
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--replay-text-faint, #4d576a)',
                padding: '2px',
                borderRadius: '4px',
                outline: 'none',
              }}
              className="replay-minimap-resize-handle"
              title="Drag or use arrow keys to resize mini map freely"
              data-testid="replay-minimap-resize-handle"
            >
              <Move size={11} />
            </div>
          )}
          <Layers size={13} style={{ color: 'var(--replay-accent, #4a7bb0)' }} />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--replay-text-primary, #e6edf8)',
            }}
          >
            Project Map
          </span>
        </div>

        {/* Right: Size Cycle & Close Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={handleCycleSize}
            className="btn-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              padding: 0,
              borderRadius: 'var(--replay-radius-control, 7px)',
              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              backgroundColor: 'transparent',
              color: 'var(--replay-text-muted, #8b97ad)',
              cursor: 'pointer',
            }}
            title={
              sizeState === 'small'
                ? 'Expand to medium dock (~400x260)'
                : sizeState === 'medium'
                ? 'Expand to full panel'
                : 'Minimize to small preview (~240x160)'
            }
            aria-label="Cycle mini map size"
            data-testid="replay-minimap-cycle-size"
          >
            {sizeState === 'full' ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>

          <button
            onClick={onClose}
            className="btn-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              padding: 0,
              borderRadius: 'var(--replay-radius-control, 7px)',
              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              backgroundColor: 'transparent',
              color: 'var(--replay-text-muted, #8b97ad)',
              cursor: 'pointer',
            }}
            title="Close mini map (M or Esc)"
            aria-label="Close mini map"
            data-testid="replay-minimap-close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Mini Map Main Body */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          backgroundColor: 'var(--replay-bg-canvas, #07090e)',
          position: 'relative',
        }}
        data-testid="replay-minimap-content"
      >
        {!hasStructureData ? (
          /* Honest Empty State: Strictly Rule 2 compliant - never fake nodes */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '80px',
              padding: '16px',
              textAlign: 'center',
              gap: '8px',
            }}
            data-testid="replay-minimap-empty-state"
          >
            <Info size={18} style={{ color: 'var(--replay-text-muted, #8b97ad)' }} />
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--replay-text-primary, #e6edf8)',
              }}
            >
              This recording contains no project-structure data
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--replay-text-muted, #8b97ad)',
                lineHeight: 1.4,
                maxWidth: '280px',
              }}
            >
              No dependency graph or AST relationship edges were recorded for this session.
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <GraphView
              graphData={graphData!}
              tests={tests || []}
              selectedTestId={null}
              selectedNodeId={selectedNodeId || null}
              onSelectNode={onSelectNode}
              selectedFile={selectedFile || null}
              onSelectFile={onSelectFile}
              isAgentMode={false}
              viewMode="structure"
            />
          </div>
        )}
      </div>
    </div>
  );
};
