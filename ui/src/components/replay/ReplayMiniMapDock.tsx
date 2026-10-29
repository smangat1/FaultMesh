import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { TimelineEntry, SnapshotManifest, ChangedSymbolView } from '../../replay/types';
import {
  Layers,
  Maximize2,
  Minimize2,
  X,
  Info,
  FileCode,
  Move,
  Code,
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
  entry: TimelineEntry | null;
  manifests: SnapshotManifest[];
  isOpen: boolean;
  onClose: () => void;
  onSelectFile?: (filePath: string) => void;
  selectedFile?: string | null;
}

export const ReplayMiniMapDock: React.FC<ReplayMiniMapDockProps> = ({
  entry,
  manifests,
  isOpen,
  onClose,
  onSelectFile,
  selectedFile,
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

  // Derive files and symbols for the active checkpoint
  const manifestId = entry?.after_manifest_id || entry?.before_manifest_id;
  const manifest = manifests.find((m) => m.id === manifestId);
  const files = manifest?.files || [];
  const changedSymbols: ChangedSymbolView[] = entry?.changed_symbols || [];
  const changedFiles = entry?.changed_files || [];

  // Honest Check: If recording carries no project structure data (0 files in manifest and 0 symbols)
  const hasStructureData = files.length > 0 || changedSymbols.length > 0 || changedFiles.length > 0;

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
        position: sizeState === 'full' ? 'absolute' : 'absolute',
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
        {/* Left: Drag grip (when floating) + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {sizeState !== 'full' && (
            <div
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
                padding: '1px',
              }}
              title="Drag to resize mini map freely"
              data-testid="replay-minimap-resize-handle"
              aria-label="Resize mini map"
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
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--replay-text-muted, #8b97ad)',
            }}
          >
            ({files.length} {files.length === 1 ? 'file' : 'files'})
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
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px',
          backgroundColor: 'var(--replay-bg-canvas, #07090e)',
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
              padding: '12px',
              textAlign: 'center',
              gap: '6px',
            }}
            data-testid="replay-minimap-empty-state"
          >
            <Info size={16} style={{ color: 'var(--replay-text-muted, #8b97ad)' }} />
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--replay-text-primary, #e6edf8)',
              }}
            >
              This recording contains no project-structure data
            </div>
            <div
              style={{
                fontSize: '10px',
                color: 'var(--replay-text-muted, #8b97ad)',
                lineHeight: 1.4,
              }}
            >
              No file manifests or AST symbols were recorded for this checkpoint.
            </div>
          </div>
        ) : (
          /* Real Project Structure Nodes */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {files.map((file) => {
              const changed = changedFiles.find((cf) => cf.path === file.path);
              const isSelected = selectedFile === file.path;
              const fileSymbols = changedSymbols.filter((s) => s.path === file.path);

              return (
                <div
                  key={file.path}
                  onClick={() => onSelectFile?.(file.path)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--replay-radius-control, 7px)',
                    backgroundColor: isSelected
                      ? 'var(--replay-bg-surface-3, #1c2436)'
                      : 'var(--replay-bg-surface-1, #0d111a)',
                    border: isSelected
                      ? '1px solid var(--replay-border-focus, rgba(96, 140, 200, 0.45))'
                      : '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                    cursor: onSelectFile ? 'pointer' : 'default',
                    transition: 'all var(--replay-transition-quick, 160ms ease)',
                  }}
                  data-testid={`replay-minimap-file-${file.path}`}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                      <FileCode size={12} style={{ color: 'var(--replay-accent, #4a7bb0)', flexShrink: 0 }} />
                      <span
                        style={{
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: '11px',
                          color: isSelected ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-primary, #e6edf8)',
                          fontWeight: isSelected ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {file.path}
                      </span>
                    </div>

                    {changed && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono, monospace)',
                          padding: '1px 5px',
                          borderRadius: 'var(--replay-radius-control, 7px)',
                          backgroundColor:
                            changed.change === 'modified'
                              ? 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))'
                              : changed.change === 'added'
                              ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                              : 'var(--replay-status-danger-bg, rgba(156, 68, 68, 0.12))',
                          color:
                            changed.change === 'modified'
                              ? 'var(--replay-text-muted, #8b97ad)'
                              : changed.change === 'added'
                              ? 'var(--replay-status-complete, #4a7bb0)'
                              : 'var(--replay-status-danger, #9c4444)',
                          border:
                            changed.change === 'modified'
                              ? '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))'
                              : changed.change === 'added'
                              ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                              : '1px solid var(--replay-status-danger-border, rgba(156, 68, 68, 0.30))',
                          flexShrink: 0,
                        }}
                      >
                        {changed.change.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Recorded Symbols under this file */}
                  {fileSymbols.length > 0 && (
                    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '14px' }}>
                      {fileSymbols.map((sym) => (
                        <div
                          key={`${sym.path}::${sym.qualified_name}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono, monospace)',
                            color: 'var(--replay-text-muted, #8b97ad)',
                          }}
                        >
                          <Code size={10} style={{ color: 'var(--replay-text-faint, #4d576a)' }} />
                          <span>{sym.qualified_name}</span>
                          <span style={{ fontSize: '9px', color: 'var(--replay-text-faint, #4d576a)' }}>
                            ({sym.kind})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
