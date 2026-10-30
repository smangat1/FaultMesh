import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReplayAdapter } from '../../adapter/replayAdapter';
import type { GraphData } from '../../types';
import { ReplayTimeline } from './ReplayTimeline';
import { ReplayDiffViewer } from './ReplayDiffViewer';
import { ReplayEvidenceInspector } from './ReplayEvidenceInspector';
import { ReplayTimelineBar } from './ReplayTimelineBar';
import { ReplayMiniMapDock } from './ReplayMiniMapDock';
import type { TimeModelOptions } from '../../replay/timeModel';
import { formatClockTime, formatRecordedAt } from '../../replay/timeModel';
import { plainReplayStepLabel } from '../../replay/stepLabel';
import { FirstUseTipOverlay, SCREEN_DEFAULT_STEPS } from '../FirstUseTipOverlay';
import { isScreenTipSeen } from '../../utils/firstUseTipsStorage';
import { WatchProjectPrompt } from '../WatchProjectPrompt';
import type { ProjectChoice } from '../../spectate/types';
import {
  dismissSessionWatchPrompt,
  isSessionProjectLinked,
  isSessionWatchPromptDismissed,
  storeSessionProjectLink,
} from '../../utils/replayProjectLinksStorage';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  BookOpen,
  ShieldCheck,
  X,
} from 'lucide-react';

export interface ReplayWorkspaceProps {
  adapter: ReplayAdapter;
  graphData?: GraphData | null;
  timelineOptions?: TimeModelOptions;
  defaultChaptersOpen?: boolean;
  defaultEvidenceOpen?: boolean;
  defaultMiniMapOpen?: boolean;
  importedSessionId?: string | null;
  hasSpectateBridge?: boolean;
  watchProjectBusy?: boolean;
  onWatchProject?: () => Promise<ProjectChoice | null>;
  onLinkSessionProject?: (sessionId: string, projectHandle: string) => Promise<void>;
}

export const ReplayWorkspace: React.FC<ReplayWorkspaceProps> = ({
  adapter,
  graphData,
  timelineOptions,
  defaultChaptersOpen = false,
  defaultEvidenceOpen = false,
  defaultMiniMapOpen,
  importedSessionId = null,
  hasSpectateBridge = false,
  watchProjectBusy = false,
  onWatchProject,
  onLinkSessionProject,
}) => {
  const timeline = useMemo(() => adapter.getTimeline(), [adapter]);
  const [currentSeq, setCurrentSeq] = useState<number>(() => adapter.getCurrentSequence());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [isNarrationOn, setIsNarrationOn] = useState<boolean>(true);
  const [isBaselineMode, setIsBaselineMode] = useState<boolean>(false);
  const tipScreenId = importedSessionId ? 'replayHistory' : 'replay';
  const [showTips, setShowTips] = useState<boolean>(() => !isScreenTipSeen(tipScreenId));
  const [showWatchPrompt, setShowWatchPrompt] = useState<boolean>(() => Boolean(
    importedSessionId
    && !isSessionProjectLinked(importedSessionId)
    && !isSessionWatchPromptDismissed(importedSessionId)
  ));

  // On-demand panel visibility states (Rule 2 + Visual Direction: closed by default)
  const [isChaptersOpen, setIsChaptersOpen] = useState<boolean>(defaultChaptersOpen);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState<boolean>(defaultEvidenceOpen);
  const [isMiniMapOpen, setIsMiniMapOpen] = useState<boolean>(() => {
    if (defaultMiniMapOpen !== undefined) return defaultMiniMapOpen;
    try {
      const saved = localStorage.getItem('faultmesh:replay:minimap:state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.isOpen === 'boolean') return parsed.isOpen;
      }
    } catch {
      // Ignore
    }
    return false;
  });

  const currentEntry = adapter.getTimelineEntry(currentSeq) || timeline[0] || null;
  const currentRecord = adapter.getRecordForSequence(currentSeq);
  const session = adapter.getSession();
  const origin = adapter.getOrigin();
  const limitations = adapter.getLimitations();
  const completenessInfo = adapter.getCompletenessSummary();
  const granularity = adapter.detectCaptureGranularity();
  const hasModelChapters = adapter.isModelNarrationAvailable();

  const stepLabels = useMemo(() => new Map(
    timeline.map((entry) => [
      entry.sequence,
      plainReplayStepLabel(adapter.getRecordForSequence(entry.sequence), entry),
    ])
  ), [adapter, timeline]);

  useEffect(() => {
    if (!importedSessionId) return;
    setShowTips(!isScreenTipSeen('replayHistory'));
    setShowWatchPrompt(
      !isSessionProjectLinked(importedSessionId)
      && !isSessionWatchPromptDismissed(importedSessionId)
    );
  }, [importedSessionId]);

  const handleDismissWatchPrompt = useCallback(() => {
    if (importedSessionId) dismissSessionWatchPrompt(importedSessionId);
    setShowWatchPrompt(false);
  }, [importedSessionId]);

  const handleWatchProject = useCallback(async () => {
    if (!importedSessionId || !onWatchProject) return;
    const project = await onWatchProject();
    if (!project) return;
    await onLinkSessionProject?.(importedSessionId, project.handle);
    storeSessionProjectLink(importedSessionId, project);
    setShowWatchPrompt(false);
  }, [importedSessionId, onLinkSessionProject, onWatchProject]);

  const chapters = useMemo(() => {
    return isBaselineMode ? adapter.getBaselineChapters() : adapter.getChapters();
  }, [adapter, isBaselineMode]);

  const narration = useMemo(() => {
    return adapter.getNarration(currentSeq);
  }, [adapter, currentSeq]);

  const testsForCurrentSeq = useMemo(() => {
    return adapter.getTestsForSequence(currentSeq);
  }, [adapter, currentSeq]);

  const allTests = useMemo(() => {
    return adapter.getAllTests ? adapter.getAllTests() : [];
  }, [adapter]);

  // Set sequence and update adapter
  const handleSelectSequence = useCallback(
    (seq: number) => {
      const entry = timeline.find((t) => t.sequence === seq);
      if (entry) {
        setCurrentSeq(seq);
        adapter.setCurrentSequence(seq);
        if (entry.changed_files.length > 0) {
          setSelectedFile(entry.changed_files[0].path);
        } else {
          setSelectedFile(null);
        }
      }
    },
    [adapter, timeline]
  );

  // Navigate previous / next checkpoint
  const handlePrevCheckpoint = useCallback(() => {
    const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex > 0) {
      handleSelectSequence(timeline[currentIndex - 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, timeline]);

  const handleNextCheckpoint = useCallback(() => {
    const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex >= 0 && currentIndex < timeline.length - 1) {
      handleSelectSequence(timeline[currentIndex + 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, timeline]);

  // Keyboard navigation: Left/Right arrows or j/k, C (chapters), E (evidence), M (mini-map), Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      // Ignore keydown events whose target or activeElement is inside the mini map dock
      const target = e.target as HTMLElement | null;
      if (
        (target && typeof target.closest === 'function' && target.closest('[data-testid="replay-minimap-dock"]')) ||
        (document.activeElement &&
          typeof document.activeElement.closest === 'function' &&
          document.activeElement.closest('[data-testid="replay-minimap-dock"]'))
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'j') {
        e.preventDefault();
        handlePrevCheckpoint();
      } else if (e.key === 'ArrowRight' || e.key === 'k') {
        e.preventDefault();
        handleNextCheckpoint();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setIsChaptersOpen((prev) => !prev);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setIsEvidenceOpen((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setIsMiniMapOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        // Dismiss topmost active panel
        if (isMiniMapOpen) {
          setIsMiniMapOpen(false);
        } else if (isEvidenceOpen) {
          setIsEvidenceOpen(false);
        } else if (isChaptersOpen) {
          setIsChaptersOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevCheckpoint, handleNextCheckpoint, isChaptersOpen, isEvidenceOpen, isMiniMapOpen]);

  const getHistoricalContent = useCallback(
    (path: string) => {
      return adapter.getHistoricalFileAtCheckpoint(currentSeq, path);
    },
    [adapter, currentSeq]
  );

  const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
  const recordedAtLabel = currentEntry ? formatRecordedAt(currentEntry.captured_at, timelineOptions?.timeZone) : '';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--replay-bg-canvas, #07090e)',
        color: 'var(--replay-text-primary, #e6edf8)',
        fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
        overflow: 'hidden',
      }}
      data-testid="replay-workspace"
    >
      {/* 1. Minimal Header (Step position + Origin + On-demand panel controls only) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexWrap: 'wrap',
          gap: '10px',
          flexShrink: 0,
        }}
        data-testid="replay-workspace-header"
      >
        {/* Left: Minimal Position + Origin */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={handlePrevCheckpoint}
              disabled={currentIndex <= 0}
              className="btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                backgroundColor: currentIndex <= 0 ? 'transparent' : 'var(--replay-bg-surface-2, #141a26)',
                color: 'var(--replay-text-primary, #e6edf8)',
                cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                opacity: currentIndex <= 0 ? 0.35 : 1,
                transition: 'background-color var(--replay-transition-quick, 160ms ease)',
              }}
              title="Previous checkpoint (Left arrow or j)"
              aria-label="Previous checkpoint"
              data-testid="replay-prev-btn"
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>

            <span
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 8px',
                color: 'var(--replay-accent, #4a7bb0)',
                backgroundColor: 'var(--replay-accent-glow, rgba(74, 123, 176, 0.15))',
                border: '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))',
                borderRadius: 'var(--replay-radius-control, 7px)',
                cursor: 'help',
              }}
              title={recordedAtLabel}
              data-testid="replay-current-seq-badge"
            >
              Checkpoint #{currentSeq} of {timeline.length}
            </span>

            <button
              onClick={handleNextCheckpoint}
              disabled={currentIndex >= timeline.length - 1}
              className="btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                backgroundColor: currentIndex >= timeline.length - 1 ? 'transparent' : 'var(--replay-bg-surface-2, #141a26)',
                color: 'var(--replay-text-primary, #e6edf8)',
                cursor: currentIndex >= timeline.length - 1 ? 'not-allowed' : 'pointer',
                opacity: currentIndex >= timeline.length - 1 ? 0.35 : 1,
                transition: 'background-color var(--replay-transition-quick, 160ms ease)',
              }}
              title="Next checkpoint (Right arrow or k)"
              aria-label="Next checkpoint"
              data-testid="replay-next-btn"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Origin Badge */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 'var(--replay-radius-control, 7px)',
              backgroundColor: origin === 'real_recording' ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))' : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
              border: origin === 'real_recording' ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))' : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
              color: origin === 'real_recording' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
            }}
            data-testid="replay-header-origin"
          >
            {origin === 'synthetic_fixture'
              ? 'SYNTHETIC FIXTURE'
              : origin === 'simulated_demo'
              ? 'SIMULATED DEMO'
              : 'REAL RECORDING'}
          </span>

        </div>

        {/* Right: On-Demand Controls (Chapters [C], Evidence [E], Mini Map [M]) & Help */}
        <div
          data-testid="replay-header-tools"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
        >
          <button
            onClick={() => setIsChaptersOpen((prev) => !prev)}
            className={`replay-header-toggle-btn ${isChaptersOpen ? 'active' : ''}`}
            title="Toggle chapters left rail (Shortcut: C)"
            aria-label="Toggle chapters rail"
            aria-expanded={isChaptersOpen}
            data-testid="replay-toggle-chapters"
          >
            <BookOpen size={12} />
            <span>Chapters</span>
            <span className="replay-shortcut-tag">C</span>
          </button>

          <button
            onClick={() => setIsEvidenceOpen((prev) => !prev)}
            className={`replay-header-toggle-btn ${isEvidenceOpen ? 'active' : ''}`}
            title="Toggle evidence & claims inspector (Shortcut: E)"
            aria-label="Toggle evidence inspector"
            aria-expanded={isEvidenceOpen}
            data-testid="replay-toggle-evidence"
          >
            <ShieldCheck size={12} />
            <span>Evidence</span>
            <span className="replay-shortcut-tag">E</span>
          </button>

          <button
            onClick={() => setIsMiniMapOpen((prev) => !prev)}
            className={`replay-header-toggle-btn ${isMiniMapOpen ? 'active' : ''}`}
            title="Toggle project structure mini map (Shortcut: M)"
            aria-label="Toggle Project Map dock"
            aria-expanded={isMiniMapOpen}
            data-testid="replay-toggle-minimap"
          >
            <Layers size={12} />
            <span>Mini Map</span>
            <span className="replay-shortcut-tag">M</span>
          </button>

          <button
            type="button"
            className="first-use-help-btn"
            data-testid="replay-help-tips-btn"
            onClick={() => setShowTips(true)}
            title="First-use guide (?)"
            aria-label="First-use guide"
          >
            ?
          </button>
        </div>
      </div>

      {/* 2. Hero Timeline Bar (Spanning Full Workspace Width) */}
      <div
        style={{
          padding: '8px 16px 10px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexShrink: 0,
        }}
        data-testid="replay-hero-bar-container"
      >
        <ReplayTimelineBar
          timeline={timeline}
          currentSequence={currentSeq}
          onSelectSequence={handleSelectSequence}
          chapters={chapters}
          tests={allTests}
          options={timelineOptions}
          stepLabels={stepLabels}
        />
      </div>

      {/* 3. Plain-language focus strip. Technical provenance stays collapsed. */}
      <div className="replay-step-focus-strip" data-testid="replay-step-focus-strip">
        <div className="replay-step-focus-left">
          <span className="replay-step-plain-label" data-testid="replay-step-plain-label">
            {currentEntry ? stepLabels.get(currentEntry.sequence) : 'Recorded step'}
          </span>
          {currentEntry && (
            <time className="replay-step-clock" dateTime={currentEntry.captured_at}>
              {formatClockTime(currentEntry.captured_at, timelineOptions?.timeZone)}
            </time>
          )}
        </div>

        {currentEntry && (
          <details className="replay-step-details" data-testid="replay-step-details">
            <summary>Details</summary>
            <dl>
              <div><dt>Record</dt><dd>{currentEntry.record_id}</dd></div>
              <div><dt>Attribution</dt><dd>{currentEntry.attribution_status.replace(/_/g, ' ')}</dd></div>
              <div><dt>Completeness</dt><dd>{currentEntry.completeness}</dd></div>
              {session.codex_version && <div><dt>Codex version</dt><dd>{session.codex_version}</dd></div>}
              <div><dt>Capture</dt><dd>{granularity.replace(/_/g, ' ')}</dd></div>
            </dl>
          </details>
        )}
      </div>

      {/* 4. Main Body: Timeline-First Focus Layout (Diff is Hero, On-Demand Panels Slide In) */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* On-Demand Left Rail: Chapters & Steps (Closed by default, toggled via C) */}
        <div
          className="replay-chapters-rail"
          style={{ display: isChaptersOpen ? 'flex' : 'none' }}
          data-testid="replay-chapters-rail-container"
        >
          <div className="replay-panel-top-bar">
            <div className="replay-panel-top-title">
              <BookOpen size={13} style={{ color: 'var(--replay-accent, #4a7bb0)' }} />
              <span>Chapters & Sequence</span>
              <span className="replay-shortcut-tag">C</span>
            </div>
            <button
              onClick={() => setIsChaptersOpen(false)}
              className="replay-panel-close-btn"
              title="Close chapters rail (C or Esc)"
              aria-label="Close chapters rail"
              data-testid="replay-chapters-close-btn"
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <ReplayTimeline
              timeline={timeline}
              currentSequence={currentSeq}
              onSelectSequence={handleSelectSequence}
              chapters={chapters}
              selectedChapterId={selectedChapterId}
              onSelectChapter={setSelectedChapterId}
              isNarrationOn={isNarrationOn}
              onToggleNarration={setIsNarrationOn}
              isBaselineMode={isBaselineMode}
              onToggleBaseline={(baseline) => {
                setIsBaselineMode(baseline);
                adapter.setUseBaselineChapters(baseline);
              }}
              hasModelChapters={hasModelChapters}
            />
          </div>
        </div>

        {/* Center Main Stage: Diff View as Hero (Always Focused, Full-Width by default) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
          }}
          data-testid="replay-main-stage"
        >
          <ReplayDiffViewer
            selectedFile={selectedFile}
            changedFiles={currentEntry?.changed_files || []}
            changedSymbols={currentEntry?.changed_symbols || []}
            onSelectFile={setSelectedFile}
            getHistoricalContent={getHistoricalContent}
            entry={currentEntry}
            record={currentRecord}
            completenessInfo={completenessInfo}
            isModelNarrationAvailable={hasModelChapters}
          />

          {/* Graph Mini Map Dock (Resizable, Size-cycling, Honest empty state) */}
          <ReplayMiniMapDock
            isOpen={isMiniMapOpen}
            onClose={() => setIsMiniMapOpen(false)}
            graphData={graphData}
            tests={adapter.getAllTests() as any}
            onSelectFile={(f) => setSelectedFile(f)}
            selectedFile={selectedFile}
          />
        </div>

        {/* On-Demand Right Drawer: Evidence Inspector (Closed by default, toggled via E) */}
        <div
          className="replay-evidence-drawer"
          style={{ display: isEvidenceOpen ? 'flex' : 'none' }}
          data-testid="replay-evidence-drawer-container"
        >
          <div className="replay-panel-top-bar">
            <div className="replay-panel-top-title">
              <ShieldCheck size={13} style={{ color: 'var(--replay-accent, #4a7bb0)' }} />
              <span>Evidence & Claims</span>
              <span className="replay-shortcut-tag">E</span>
            </div>
            <button
              onClick={() => setIsEvidenceOpen(false)}
              className="replay-panel-close-btn"
              title="Close evidence drawer (E or Esc)"
              aria-label="Close evidence drawer"
              data-testid="replay-evidence-close-btn"
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <ReplayEvidenceInspector
              narration={narration}
              tests={testsForCurrentSeq}
              limitations={limitations}
              isNarrationOn={isNarrationOn}
              record={currentRecord}
            />
          </div>
        </div>
      </div>

      <FirstUseTipOverlay
        screenId={tipScreenId}
        steps={SCREEN_DEFAULT_STEPS[tipScreenId]}
        active={showTips}
        onDismiss={() => setShowTips(false)}
      />
      <WatchProjectPrompt
        open={showWatchPrompt}
        hasBridge={hasSpectateBridge}
        busy={watchProjectBusy}
        onChoose={() => void handleWatchProject()}
        onDismiss={handleDismissWatchPrompt}
      />
    </div>
  );
};
