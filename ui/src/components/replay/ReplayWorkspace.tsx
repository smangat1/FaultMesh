import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { ReplayModelSetup } from './ReplayModelSetup';
import type { ProjectChoice, RevertPlan } from '../../spectate/types';
import type {
  SelectionSummary,
  StepNarration,
  StructuredTestEvidence,
  TypedClaim,
} from '../../replay/types';
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
  CircleStop,
  HelpCircle,
  RotateCcw,
  ListTree,
  Pause,
  Play,
  Copy,
  ExternalLink,
  Undo2,
  Check,
  X,
} from 'lucide-react';

const DETERMINISTIC_STEP_NOTE = 'No recorded changes, command exit, or test evidence for this step.';
const MODEL_NOT_READY_STEP_NOTE = 'Set up the local model to check this step.';
const PROMPT_PLAYBACK_DELAY_MS = 2400;
const FILE_STEP_PLAYBACK_DELAY_MS = 1200;

type PlaybackSpeed = 1 | 2 | 4;

function promptClaimLabel(claim: TypedClaim): string {
  const assertion = claim.assertion;
  if (assertion.predicate === 'file_changed') return `Changed ${assertion.path}`;
  if (assertion.predicate === 'python_function_added') {
    return `Added ${assertion.qualified_name} in ${assertion.path}`;
  }
  if (assertion.predicate === 'python_function_removed') {
    return `Removed ${assertion.qualified_name} from ${assertion.path}`;
  }
  if (assertion.predicate === 'command_exit') {
    return `Command exited with code ${assertion.exit_code}`;
  }
  return `Tests: ${assertion.passed} passed, ${assertion.failed} failed, ${assertion.errors} errors`;
}

function promptTestAssociationLabel(tests: StructuredTestEvidence[]): string {
  if (tests.length === 0) return 'not observed';
  const associations = new Set(tests.map((test) => test.association));
  if (associations.has('nearby_in_time_state_unverified')) return 'nearby, state unverified';
  if (associations.has('none')) return 'association unknown';
  if (associations.has('controlled_no_write')) return 'controlled no-write';
  return 'content identity';
}

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches)
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return prefersReducedMotion;
}

export interface ReplayWorkspaceProps {
  adapter: ReplayAdapter;
  graphData?: GraphData | null;
  timelineOptions?: TimeModelOptions;
  defaultChaptersOpen?: boolean;
  defaultEvidenceOpen?: boolean;
  defaultMiniMapOpen?: boolean;
  importedSessionId?: string | null;
  importedSessionTool?: string | null;
  importedSessionSource?: 'history' | 'replay_store';
  historyPromptPolling?: boolean;
  historyPromptRefreshRevision?: number;
  hasSpectateBridge?: boolean;
  watchProjectBusy?: boolean;
  onWatchProject?: () => Promise<ProjectChoice | null>;
  onLinkSessionProject?: (sessionId: string, projectHandle: string) => Promise<void>;
  onOpenSessionFile?: (
    sessionId: string,
    relativePath: string,
  ) => Promise<{ opened: true; method: 'code' | 'finder' }>;
  onRequestRevertPlan?: (
    sessionId: string,
    tool: string,
    start: number,
    end: number,
    source: 'history' | 'replay_store',
  ) => Promise<RevertPlan>;
  narrationRevision?: number;
  narrationProgress?: {
    done: number;
    total: number;
    stage?: 'summarizing' | 'checking';
  } | null;
  narrationError?: string | null;
  modelSetupOpen?: boolean;
  modelSetupMessage?: string;
  modelSetupBusy?: boolean;
  modelDownloadProgress?: { downloaded: number; total: number } | null;
  plainMode?: boolean;
  onDemandModelReady?: boolean;
  onDownloadModel?: () => void;
  onChooseModel?: () => void;
  onSkipModelSetup?: () => void;
  onCancelNarration?: () => void;
  onRerunNarration?: () => void;
  onExplainStep?: (sequence: number) => Promise<StepNarration | null>;
  onSummarizeSelection?: (start: number, end: number) => Promise<SelectionSummary | null>;
}

export const ReplayWorkspace: React.FC<ReplayWorkspaceProps> = ({
  adapter,
  graphData,
  timelineOptions,
  defaultChaptersOpen = false,
  defaultEvidenceOpen = false,
  defaultMiniMapOpen,
  importedSessionId = null,
  importedSessionTool = null,
  importedSessionSource = 'history',
  historyPromptPolling = false,
  historyPromptRefreshRevision = 0,
  hasSpectateBridge = false,
  watchProjectBusy = false,
  onWatchProject,
  onLinkSessionProject,
  onOpenSessionFile,
  onRequestRevertPlan,
  narrationRevision = 0,
  narrationProgress = null,
  narrationError = null,
  modelSetupOpen = false,
  modelSetupMessage = 'Choose a local model to upgrade the template narration.',
  modelSetupBusy = false,
  modelDownloadProgress = null,
  plainMode = false,
  onDemandModelReady = true,
  onDownloadModel,
  onChooseModel,
  onSkipModelSetup,
  onCancelNarration,
  onRerunNarration,
  onExplainStep,
  onSummarizeSelection,
}) => {
  const timeline = useMemo(() => adapter.getTimeline(), [adapter]);
  const promptGroups = useMemo(() => adapter.getPromptGroups(), [adapter]);
  const [rawStepMode, setRawStepMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [currentSeq, setCurrentSeq] = useState<number>(() => adapter.getCurrentSequence());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [isNarrationOn, setIsNarrationOn] = useState<boolean>(true);
  const [isBaselineMode, setIsBaselineMode] = useState<boolean>(false);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [selectionSummary, setSelectionSummary] = useState<SelectionSummary | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionCache = useRef(new Map<string, SelectionSummary>());
  const [explanationLoadingSequence, setExplanationLoadingSequence] = useState<number | null>(null);
  const [instantStepNote, setInstantStepNote] = useState<string | null>(null);
  const explanationInFlightRef = useRef(false);
  const latestExplanationSequenceRef = useRef<number | null>(null);
  const explanationTargetSequenceRef = useRef<number | null>(null);
  const tipScreenId = importedSessionId ? 'replayHistory' : 'replay';
  const [showTips, setShowTips] = useState<boolean>(() => !isScreenTipSeen(tipScreenId));
  const [showWatchPrompt, setShowWatchPrompt] = useState<boolean>(() => Boolean(
    importedSessionId
    && !isSessionProjectLinked(importedSessionId)
    && !isSessionWatchPromptDismissed(importedSessionId)
  ));
  const [projectLinked, setProjectLinked] = useState<boolean>(() => Boolean(
    importedSessionId && isSessionProjectLinked(importedSessionId)
  ));
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [revertPlan, setRevertPlan] = useState<RevertPlan | null>(null);
  const [revertPlanOpen, setRevertPlanOpen] = useState(false);
  const [revertPlanLoading, setRevertPlanLoading] = useState(false);
  const [revertPlanError, setRevertPlanError] = useState<string | null>(null);
  const [showNewPromptNotice, setShowNewPromptNotice] = useState(false);
  const actionNoticeTimerRef = useRef<number | null>(null);

  // On-demand panel visibility states (Rule 2 + Visual Direction: closed by default)
  const [isChaptersOpen, setIsChaptersOpen] = useState<boolean>(defaultChaptersOpen);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState<boolean>(defaultEvidenceOpen);
  const [isMiniMapOpen, setIsMiniMapOpen] = useState<boolean>(() => Boolean(defaultMiniMapOpen));

  const currentEntry = adapter.getTimelineEntry(currentSeq) || timeline[0] || null;
  const currentRecord = adapter.getRecordForSequence(currentSeq);
  const session = adapter.getSession();
  const origin = adapter.getOrigin();
  const limitations = adapter.getLimitations();
  const completenessInfo = adapter.getCompletenessSummary();
  const granularity = adapter.detectCaptureGranularity();
  const hasModelChapters = adapter.isModelNarrationAvailable();
  const sessionSummary = adapter.getSessionSummary();
  const activePromptIndex = Math.max(
    0,
    promptGroups.findIndex(
      (prompt) => currentSeq >= prompt.startSequence && currentSeq <= prompt.endSequence
    )
  );
  const activePrompt = promptGroups[activePromptIndex] || null;
  const promptStopSequences = useMemo(() => {
    const stops = promptGroups.flatMap((prompt) => (
      prompt.fileChangingSequences.length > 0
        ? prompt.fileChangingSequences
        : [prompt.startSequence]
    ));
    return new Set(stops);
  }, [promptGroups]);
  const navigationTimeline = useMemo(
    () => rawStepMode ? timeline : timeline.filter((entry) => promptStopSequences.has(entry.sequence)),
    [promptStopSequences, rawStepMode, timeline]
  );
  const foldedSequences = useMemo(
    () => rawStepMode
      ? []
      : timeline.filter((entry) => !promptStopSequences.has(entry.sequence)).map((entry) => entry.sequence),
    [promptStopSequences, rawStepMode, timeline]
  );
  const promptEntrySequences = useMemo(
    () => new Set(promptGroups.map((prompt) => (
      prompt.fileChangingSequences[0] ?? prompt.startSequence
    ))),
    [promptGroups]
  );
  const currentIndex = navigationTimeline.findIndex((entry) => entry.sequence === currentSeq);
  const activePromptDiff = useMemo(() => {
    if (!activePrompt) return '';
    return timeline
      .filter((entry) => (
        entry.sequence >= activePrompt.startSequence
        && entry.sequence <= activePrompt.endSequence
      ))
      .flatMap((entry) => entry.changed_files.map((changed) => changed.unified_diff || ''))
      .filter(Boolean)
      .join('\n');
  }, [activePrompt, timeline]);
  const activePromptFile = activePrompt?.changedFiles.includes(selectedFile || '')
    ? selectedFile
    : activePrompt?.changedFiles[0] || null;

  const pausePlayback = useCallback(() => setIsPlaying(false), []);

  const announceAction = useCallback((message: string) => {
    setActionNotice(message);
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null);
      actionNoticeTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => () => {
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (historyPromptRefreshRevision <= 0) {
      setShowNewPromptNotice(false);
      return undefined;
    }
    setShowNewPromptNotice(true);
    const timer = window.setTimeout(() => setShowNewPromptNotice(false), 4000);
    return () => window.clearTimeout(timer);
  }, [historyPromptRefreshRevision]);

  const stepLabels = useMemo(() => new Map(
    timeline.map((entry) => [
      entry.sequence,
      plainReplayStepLabel(adapter.getRecordForSequence(entry.sequence), entry),
    ])
  ), [adapter, timeline]);

  useEffect(() => {
    if (!importedSessionId) return;
    setShowTips(!isScreenTipSeen('replayHistory'));
    setProjectLinked(isSessionProjectLinked(importedSessionId));
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
    setProjectLinked(true);
    setShowWatchPrompt(false);
  }, [importedSessionId, onLinkSessionProject, onWatchProject]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard access is unavailable.');
    }
    await navigator.clipboard.writeText(text);
    announceAction(successMessage);
  }, [announceAction]);

  const handleCopyPromptDiff = useCallback(() => {
    if (!activePromptDiff) return;
    void copyText(activePromptDiff, 'Prompt diff copied.').catch((error: unknown) => {
      announceAction(error instanceof Error ? error.message : 'The prompt diff could not be copied.');
    });
  }, [activePromptDiff, announceAction, copyText]);

  const handleOpenPromptFile = useCallback(() => {
    if (!importedSessionId || !activePromptFile || !onOpenSessionFile) return;
    void onOpenSessionFile(importedSessionId, activePromptFile).then((result) => {
      announceAction(result.method === 'code' ? 'Opened in your editor.' : 'Revealed in Finder.');
    }).catch((error: unknown) => {
      announceAction(error instanceof Error ? error.message : 'The file could not be opened.');
    });
  }, [activePromptFile, announceAction, importedSessionId, onOpenSessionFile]);

  const handleRevertPlan = useCallback(() => {
    if (!activePrompt || !importedSessionId || !importedSessionTool || !onRequestRevertPlan) return;
    setRevertPlanOpen(true);
    setRevertPlanLoading(true);
    setRevertPlanError(null);
    setRevertPlan(null);
    void onRequestRevertPlan(
      importedSessionId,
      importedSessionTool,
      activePrompt.startSequence,
      activePrompt.endSequence,
      importedSessionSource,
    ).then((plan) => {
      setRevertPlan(plan);
      setRevertPlanLoading(false);
    }).catch((error: unknown) => {
      setRevertPlanError(error instanceof Error ? error.message : 'The revert plan is unavailable.');
      setRevertPlanLoading(false);
    });
  }, [
    activePrompt,
    importedSessionId,
    importedSessionSource,
    importedSessionTool,
    onRequestRevertPlan,
  ]);

  const chapters = useMemo(() => {
    return isBaselineMode ? adapter.getBaselineChapters() : adapter.getChapters();
  }, [adapter, isBaselineMode, narrationRevision]);

  const narration = useMemo(() => {
    return adapter.getNarration(currentSeq);
  }, [adapter, currentSeq, narrationRevision]);

  const promptInterpretation = useMemo(() => {
    if (isBaselineMode || !activePrompt) return null;
    return adapter.getPromptInterpretation(activePrompt.id);
  }, [activePrompt, adapter, isBaselineMode, narrationRevision]);

  const promptRiskFlags = useMemo(() => (
    activePrompt ? adapter.getPromptRiskFlags(activePrompt.id) : []
  ), [activePrompt, adapter, narrationRevision]);

  const promptClaimCheck = useMemo(() => {
    if (isBaselineMode || !activePrompt) return null;
    return adapter.getPromptClaimCheck(activePrompt.id);
  }, [activePrompt, adapter, isBaselineMode, narrationRevision]);

  const checkedPromptClaims = useMemo(() => {
    if (!promptClaimCheck) return [];
    const finalClaims = Array.isArray(promptClaimCheck.claims.final_claims)
      ? promptClaimCheck.claims.final_claims
      : promptClaimCheck.claims.final_claims.claims;
    const verdicts = new Map(
      promptClaimCheck.claims.verdicts.map((verdict) => [verdict.claim_id, verdict])
    );
    return finalClaims.map((claim) => ({ claim, verdict: verdicts.get(claim.id) || null }));
  }, [promptClaimCheck]);

  const testsForCurrentSeq = useMemo(() => {
    return adapter.getTestsForSequence(currentSeq);
  }, [adapter, currentSeq]);

  const allTests = useMemo(() => {
    return adapter.getAllTests ? adapter.getAllTests() : [];
  }, [adapter]);

  const foldedRecordsForCurrent = useMemo(() => {
    if (rawStepMode || !activePrompt || activePrompt.fileChangingSequences.length === 0) return [];
    return timeline
      .filter((entry) => (
        entry.sequence >= activePrompt.startSequence
        && entry.sequence <= activePrompt.endSequence
        && !promptStopSequences.has(entry.sequence)
      ))
      .filter((entry) => {
        const nearest = activePrompt.fileChangingSequences.reduce((best, sequence) => (
          Math.abs(sequence - entry.sequence) < Math.abs(best - entry.sequence) ? sequence : best
        ));
        return nearest === currentSeq;
      })
      .map((entry) => adapter.getRecordForSequence(entry.sequence))
      .filter((record): record is NonNullable<typeof record> => record !== null);
  }, [activePrompt, adapter, currentSeq, promptStopSequences, rawStepMode, timeline]);

  // Set sequence and update adapter
  const isTrivialStep = useCallback((seq: number) => {
    const entry = timeline.find((item) => item.sequence === seq);
    const record = adapter.getRecordForSequence(seq);
    const response = record?.tool_response;
    const hasCommandExit = Boolean(
      response
      && typeof response === 'object'
      && typeof (response as Record<string, unknown>).exit_code === 'number'
    );
    return Boolean(
      entry
      && entry.changed_files.length === 0
      && entry.test_evidence.length === 0
      && !hasCommandExit
      && !record?.edit_patch
    );
  }, [adapter, timeline]);

  const requestStepExplanation = useCallback((seq: number) => {
    explanationTargetSequenceRef.current = seq;
    setInstantStepNote(null);
    if (!onDemandModelReady) {
      latestExplanationSequenceRef.current = null;
      setExplanationLoadingSequence(null);
      setInstantStepNote(MODEL_NOT_READY_STEP_NOTE);
      return;
    }
    if (isTrivialStep(seq)) {
      latestExplanationSequenceRef.current = null;
      setExplanationLoadingSequence(null);
      setInstantStepNote(DETERMINISTIC_STEP_NOTE);
      return;
    }
    if (adapter.getNarration(seq) || !onExplainStep) {
      latestExplanationSequenceRef.current = null;
      setExplanationLoadingSequence(null);
      return;
    }
    latestExplanationSequenceRef.current = seq;
    setExplanationLoadingSequence(seq);
    if (explanationInFlightRef.current) return;
    explanationInFlightRef.current = true;
    const runLatest = async () => {
      try {
        while (latestExplanationSequenceRef.current !== null) {
          const requested = latestExplanationSequenceRef.current;
          latestExplanationSequenceRef.current = null;
          try {
            const result = await onExplainStep(requested);
            if (
              !result
              && explanationTargetSequenceRef.current === requested
              && latestExplanationSequenceRef.current === null
            ) {
              setInstantStepNote(DETERMINISTIC_STEP_NOTE);
            }
          } catch (error: unknown) {
            if (
              explanationTargetSequenceRef.current === requested
              && latestExplanationSequenceRef.current === null
            ) {
              setInstantStepNote(
                error instanceof Error ? error.message : 'The step explanation was unavailable.'
              );
            }
          }
        }
      } finally {
        explanationInFlightRef.current = false;
        setExplanationLoadingSequence(null);
      }
    };
    void runLatest();
  }, [adapter, isTrivialStep, onDemandModelReady, onExplainStep]);

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
        requestStepExplanation(seq);
      }
    },
    [adapter, requestStepExplanation, timeline]
  );

  const handleUserSelectSequence = useCallback((seq: number) => {
    pausePlayback();
    handleSelectSequence(seq);
  }, [handleSelectSequence, pausePlayback]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (currentIndex < 0 || currentIndex >= navigationTimeline.length - 1) {
      setIsPlaying(false);
      return undefined;
    }
    const delay = (
      promptEntrySequences.has(currentSeq)
        ? PROMPT_PLAYBACK_DELAY_MS
        : FILE_STEP_PLAYBACK_DELAY_MS
    ) / playbackSpeed;
    const timer = window.setTimeout(() => {
      const next = navigationTimeline[currentIndex + 1];
      if (next) handleSelectSequence(next.sequence);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    currentIndex,
    currentSeq,
    handleSelectSequence,
    isPlaying,
    navigationTimeline,
    playbackSpeed,
    promptEntrySequences,
  ]);

  const togglePlayback = useCallback(() => {
    if (!isPlaying && (currentIndex < 0 || currentIndex >= navigationTimeline.length - 1)) {
      return;
    }
    setIsPlaying((playing) => !playing);
  }, [currentIndex, isPlaying, navigationTimeline.length]);

  const handleSelectFile = useCallback((path: string | null) => {
    pausePlayback();
    setSelectedFile(path);
  }, [pausePlayback]);

  const handleWorkspacePointerDown = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.replay-playback-controls')) pausePlayback();
  }, [pausePlayback]);

  useEffect(() => {
    if (rawStepMode || promptStopSequences.has(currentSeq)) return;
    const prompt = promptGroups.find(
      (item) => currentSeq >= item.startSequence && currentSeq <= item.endSequence
    );
    const target = prompt?.fileChangingSequences[0] ?? prompt?.startSequence;
    if (target !== undefined) handleSelectSequence(target);
  }, [currentSeq, handleSelectSequence, promptGroups, promptStopSequences, rawStepMode]);

  const handleRangeSelect = useCallback((seq: number, extend: boolean) => {
    pausePlayback();
    if (extend && selectionAnchor !== null) {
      setSelectionRange({
        start: Math.min(selectionAnchor, seq),
        end: Math.max(selectionAnchor, seq),
      });
    } else {
      setSelectionAnchor(seq);
      setSelectionRange({ start: seq, end: seq });
    }
    setSelectionSummary(null);
    setSelectionError(null);
  }, [pausePlayback, selectionAnchor]);

  const handleSummarizeSelection = useCallback(() => {
    if (!selectionRange || !onSummarizeSelection) return;
    const key = `${selectionRange.start}:${selectionRange.end}`;
    const cached = selectionCache.current.get(key);
    setIsEvidenceOpen(true);
    if (cached) {
      setSelectionSummary(cached);
      setSelectionError(null);
      return;
    }
    if (!onDemandModelReady) {
      setSelectionLoading(false);
      setSelectionError(null);
      setInstantStepNote(MODEL_NOT_READY_STEP_NOTE);
      return;
    }
    setSelectionLoading(true);
    setSelectionError(null);
    void onSummarizeSelection(selectionRange.start, selectionRange.end).then((summary) => {
      if (summary) {
        selectionCache.current.set(key, summary);
        setSelectionSummary(summary);
      }
    }).catch((error: unknown) => {
      setSelectionError(error instanceof Error ? error.message : 'The selection summary was unavailable.');
    }).finally(() => setSelectionLoading(false));
  }, [onDemandModelReady, onSummarizeSelection, selectionRange]);

  // Navigate previous / next checkpoint
  const handlePrevCheckpoint = useCallback(() => {
    pausePlayback();
    const currentIndex = navigationTimeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex > 0) {
      handleSelectSequence(navigationTimeline[currentIndex - 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, navigationTimeline, pausePlayback]);

  const handleNextCheckpoint = useCallback(() => {
    pausePlayback();
    const currentIndex = navigationTimeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex >= 0 && currentIndex < navigationTimeline.length - 1) {
      handleSelectSequence(navigationTimeline[currentIndex + 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, navigationTimeline, pausePlayback]);

  const moveRawStep = useCallback((delta: -1 | 1) => {
    pausePlayback();
    const currentIndex = timeline.findIndex((entry) => entry.sequence === currentSeq);
    const target = timeline[currentIndex + delta];
    if (target) handleSelectSequence(target.sequence);
  }, [currentSeq, handleSelectSequence, pausePlayback, timeline]);

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

      if (
        (e.code === 'Space' || e.key === ' ')
        && target
        && typeof target.closest === 'function'
        && target.closest('button')
      ) {
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlayback();
      } else if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        setRawStepMode(true);
        moveRawStep(-1);
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        setRawStepMode(true);
        moveRawStep(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'j') {
        e.preventDefault();
        handlePrevCheckpoint();
      } else if (e.key === 'ArrowRight' || e.key === 'k') {
        e.preventDefault();
        handleNextCheckpoint();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        pausePlayback();
        setIsChaptersOpen((prev) => !prev);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        pausePlayback();
        setIsEvidenceOpen((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        pausePlayback();
        setIsMiniMapOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        pausePlayback();
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
  }, [
    handlePrevCheckpoint,
    handleNextCheckpoint,
    isChaptersOpen,
    isEvidenceOpen,
    isMiniMapOpen,
    moveRawStep,
    pausePlayback,
    togglePlayback,
  ]);

  const getHistoricalContent = useCallback(
    (path: string) => {
      return adapter.getHistoricalFileAtCheckpoint(currentSeq, path);
    },
    [adapter, currentSeq]
  );

  const recordedAtLabel = currentEntry ? formatRecordedAt(currentEntry.captured_at, timelineOptions?.timeZone) : '';

  return (
    <div
      className="replay-workspace-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--replay-bg-canvas, #07090e)',
        color: 'var(--replay-text-primary, #e6edf8)',
        fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
        overflow: 'hidden',
        position: 'relative',
      }}
      data-testid="replay-workspace"
      data-motion={prefersReducedMotion ? 'reduced' : 'full'}
      onPointerDownCapture={handleWorkspacePointerDown}
    >
      <div className="replay-workspace-header" data-testid="replay-workspace-header">
        <div className="replay-toolbar-cluster">
          <button
            onClick={handlePrevCheckpoint}
            disabled={currentIndex <= 0}
            className="replay-toolbar-icon"
            title={rawStepMode ? 'Previous raw step · Left arrow or J' : 'Previous prompt change · Left arrow or J'}
            aria-label={rawStepMode ? 'Previous raw step' : 'Previous prompt change'}
            data-testid="replay-prev-btn"
          >
            <ChevronLeft size={16} />
          </button>
          <span
            className="replay-navigation-count"
            title={recordedAtLabel}
            data-testid="replay-current-seq-badge"
          >
            {rawStepMode
              ? `Step ${currentSeq} of ${timeline.length}`
              : `Prompt ${activePromptIndex + 1} of ${promptGroups.length}`}
          </span>
          <button
            onClick={handleNextCheckpoint}
            disabled={currentIndex >= navigationTimeline.length - 1}
            className="replay-toolbar-icon"
            title={rawStepMode ? 'Next raw step · Right arrow or K' : 'Next prompt change · Right arrow or K'}
            aria-label={rawStepMode ? 'Next raw step' : 'Next prompt change'}
            data-testid="replay-next-btn"
          >
            <ChevronRight size={16} />
          </button>
          <div className="replay-playback-controls" data-testid="replay-playback-controls">
            <button
              type="button"
              onClick={togglePlayback}
              disabled={!isPlaying && currentIndex >= navigationTimeline.length - 1}
              className={`replay-toolbar-icon replay-play-button ${isPlaying ? 'active' : ''}`}
              title={isPlaying ? 'Pause replay · Space' : 'Play replay · Space'}
              aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
              aria-pressed={isPlaying}
              data-testid="replay-play-toggle"
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <div className="replay-speed-control" role="group" aria-label="Replay speed">
              {([1, 2, 4] as PlaybackSpeed[]).map((speed) => (
                <button
                  type="button"
                  key={speed}
                  className={playbackSpeed === speed ? 'active' : ''}
                  onClick={() => setPlaybackSpeed(speed)}
                  aria-pressed={playbackSpeed === speed}
                  data-testid={`replay-speed-${speed}`}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
          <span className="replay-origin-label" data-testid="replay-header-origin">
            {origin === 'synthetic_fixture'
              ? 'Synthetic sample'
              : origin === 'simulated_demo'
              ? 'Simulated sample'
              : 'Recorded session'}
          </span>
          {historyPromptPolling && (
            <span
              className="replay-recording-indicator"
              title="Watching this local session for newly recorded prompts"
              data-testid="replay-recording-indicator"
            >
              <span aria-hidden="true" />
              Recording
            </span>
          )}
          {narrationProgress && (
            <span className="replay-progress-label" data-testid="replay-narration-progress">
              {narrationProgress.stage === 'checking' ? 'Checking prompts' : 'Summarizing prompts'}{' '}
              {narrationProgress.done}/{narrationProgress.total}
            </span>
          )}
          {plainMode && !narrationProgress && (
            <span className="replay-muted-label" data-testid="replay-plain-mode">Plain mode</span>
          )}
        </div>

        <div className="replay-toolbar-cluster" data-testid="replay-header-tools">
          <button
            type="button"
            onClick={() => {
              pausePlayback();
              setRawStepMode((value) => !value);
            }}
            className={`replay-toolbar-icon ${rawStepMode ? 'active' : ''}`}
            title={rawStepMode ? 'Switch to prompt view' : 'Switch to raw step view'}
            aria-label={rawStepMode ? 'Switch to prompt view' : 'Switch to raw step view'}
            data-testid="replay-raw-step-toggle"
          >
            <ListTree size={16} />
            <span className="sr-only">{rawStepMode ? 'Prompt view' : 'Raw step view'}</span>
          </button>
          <button
            onClick={() => {
              pausePlayback();
              setIsChaptersOpen((prev) => !prev);
            }}
            className={`replay-toolbar-icon ${isChaptersOpen ? 'active' : ''}`}
            title="Chapters · C"
            aria-label="Toggle chapters rail"
            aria-expanded={isChaptersOpen}
            data-testid="replay-toggle-chapters"
          >
            <BookOpen size={16} />
            <span className="sr-only">Chapters</span>
          </button>

          <button
            onClick={() => {
              pausePlayback();
              setIsEvidenceOpen((prev) => !prev);
            }}
            className={`replay-toolbar-icon ${isEvidenceOpen ? 'active' : ''}`}
            title="Evidence · E"
            aria-label="Toggle evidence inspector"
            aria-expanded={isEvidenceOpen}
            data-testid="replay-toggle-evidence"
          >
            <ShieldCheck size={16} />
            <span className="sr-only">Evidence</span>
          </button>

          <button
            onClick={() => {
              pausePlayback();
              setIsMiniMapOpen((prev) => !prev);
            }}
            className={`replay-toolbar-icon ${isMiniMapOpen ? 'active' : ''}`}
            title="Project map · M"
            aria-label="Toggle Project Map dock"
            aria-expanded={isMiniMapOpen}
            data-testid="replay-toggle-minimap"
          >
            <Layers size={16} />
            <span className="sr-only">Project map</span>
          </button>

          <button
            type="button"
            className="replay-toolbar-icon"
            data-testid="replay-help-tips-btn"
            onClick={() => setShowTips(true)}
            title="Replay guide"
            aria-label="First-use guide"
          >
            <HelpCircle size={16} />
            <span className="sr-only">Replay guide</span>
          </button>
          {narrationProgress ? (
            <button
              type="button"
              className="replay-toolbar-icon"
              title="Stop prompt summaries"
              aria-label="Stop prompt summaries"
              onClick={onCancelNarration}
            >
              <CircleStop size={16} />
              <span className="sr-only">Stop summaries</span>
            </button>
          ) : importedSessionId && !modelSetupOpen && !plainMode ? (
            <button
              type="button"
              className="replay-toolbar-icon"
              data-testid="replay-rerun-narration"
              title="Re-run narration"
              aria-label="Re-run narration"
              onClick={onRerunNarration}
            >
              <RotateCcw size={16} />
              <span className="sr-only">Re-run narration</span>
            </button>
          ) : null}
        </div>
      </div>

      {sessionSummary && (
        <div
          data-testid="replay-session-summary"
          style={{
            padding: '9px 16px',
            borderBottom: '1px solid var(--replay-border-subtle, rgba(255,255,255,0.06))',
            background: 'var(--replay-bg-surface-2, #141a26)',
            fontSize: '11px',
            color: 'var(--replay-text-muted, #8b97ad)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--replay-text-primary, #e6edf8)' }}>
            {sessionSummary.source === 'model' ? 'Model interpretation: ' : 'Session overview: '}
          </strong>
          {sessionSummary.sentences.join(' ')}
        </div>
      )}

      {narrationError && (
        <div data-testid="replay-narration-error" style={{ padding: '6px 16px', fontSize: '10px', color: 'var(--replay-accent)' }}>
          {narrationError}
        </div>
      )}

      {/* 2. Hero Timeline Bar (Spanning Full Workspace Width) */}
      <div
        className="replay-scrubber-shell"
        style={{
          padding: '8px 16px 10px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexShrink: 0,
        }}
        data-testid="replay-hero-bar-container"
      >
        <ReplayTimelineBar
          timeline={navigationTimeline}
          currentSequence={currentSeq}
          onSelectSequence={handleUserSelectSequence}
          onInteractionStart={pausePlayback}
          chapters={chapters}
          tests={allTests}
          options={timelineOptions}
          stepLabels={stepLabels}
          foldedSequences={foldedSequences}
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
              <span>Chapters</span>
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
              timeline={navigationTimeline}
              currentSequence={currentSeq}
              onSelectSequence={handleUserSelectSequence}
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
              selectionRange={selectionRange}
              onRangeSelect={handleRangeSelect}
              onSummarizeSelection={handleSummarizeSelection}
              selectionLoading={selectionLoading}
              promptMode={!rawStepMode}
            />
          </div>
        </div>

        {/* Center Main Stage: Diff View as Hero (Always Focused, Full-Width by default) */}
        <div
          className="replay-main-stage"
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
          }}
          data-testid="replay-main-stage"
        >
          <div
            key={`${rawStepMode ? 'raw' : 'prompt'}:${currentSeq}`}
            className="replay-stop-content"
            data-testid="replay-stop-content"
          >
          {!rawStepMode && activePrompt && (
            <section
              className={`replay-prompt-card ${isPlaying ? 'is-playing' : ''}`}
              data-testid="replay-prompt-card"
            >
              <div className="replay-prompt-card-heading">
                <div>
                  <span className="replay-prompt-kicker">Prompt {activePromptIndex + 1}</span>
                  <h2>{activePrompt.promptText?.split(/\r?\n/)[0] || 'Prompt text unavailable'}</h2>
                </div>
                <span className="replay-prompt-test-status" data-state={
                  activePrompt.testEvidence.some((test) => test.state === 'fail' || test.state === 'error')
                    ? 'fail'
                    : activePrompt.testEvidence.some((test) => test.state === 'pass')
                    ? 'pass'
                    : 'not-observed'
                }>
                  {activePrompt.testEvidence.some((test) => test.state === 'fail' || test.state === 'error')
                    ? 'Tests failed'
                    : activePrompt.testEvidence.some((test) => test.state === 'pass')
                    ? 'Tests passed'
                    : 'Tests not observed'}
                  {activePrompt.testEvidence.length > 0
                    ? ` · ${promptTestAssociationLabel(activePrompt.testEvidence)}`
                    : ''}
                </span>
              </div>
              {activePrompt.promptText && activePrompt.promptText.includes('\n') && (
                <details>
                  <summary>Full prompt</summary>
                  <pre>{activePrompt.promptText}</pre>
                </details>
              )}
              {promptInterpretation && (
                <div className="replay-prompt-interpretation" data-testid="replay-prompt-interpretation">
                  <span>Model interpretation</span>
                  <p>{promptInterpretation.text}</p>
                </div>
              )}
              <div className="replay-prompt-risks" data-testid="replay-prompt-risks">
                {promptRiskFlags.length > 0 ? promptRiskFlags.map((flag) => (
                  <span
                    key={`${flag.kind}:${flag.files.join('|')}`}
                    className="replay-risk-chip"
                    title={`${flag.source}: ${flag.files.join(', ')}`}
                    data-risk-kind={flag.kind}
                  >
                    {flag.label}: {flag.files.slice(0, 2).join(', ')}
                    {flag.files.length > 2 ? ` +${flag.files.length - 2}` : ''}
                  </span>
                )) : (
                  <span className="replay-risk-clean">No rule-based risk flags</span>
                )}
              </div>
              {promptClaimCheck && (
                <div className="replay-prompt-claims" data-testid="replay-prompt-claims">
                  <div className="replay-prompt-claims-label">{promptClaimCheck.label}</div>
                  {checkedPromptClaims.length > 0 ? checkedPromptClaims.map(({ claim, verdict }) => (
                    <div className="replay-checked-claim" key={claim.id}>
                      <span
                        className="replay-verdict-chip"
                        data-verdict={verdict?.verdict || 'unsupported_or_unknown'}
                      >
                        {verdict?.verdict === 'supported'
                          ? 'Supported'
                          : verdict?.verdict === 'contradicted'
                          ? 'Contradicted'
                          : 'Unknown'}
                      </span>
                      <span>{promptClaimLabel(claim)}</span>
                      <code title={verdict?.reason || 'No checker reason recorded'}>
                        {(verdict?.evidence_refs || claim.evidence_refs).join(', ')}
                      </code>
                    </div>
                  )) : (
                    <span className="replay-risk-clean">No checkable atomic claims were returned.</span>
                  )}
                </div>
              )}
              <div className="replay-prompt-card-meta">
                <span>{activePrompt.changedFiles.length} {activePrompt.changedFiles.length === 1 ? 'file' : 'files'} changed</span>
                <span>
                  {activePrompt.grouping === 'prompt_turn'
                    ? 'Grouped from recorded prompt evidence'
                    : 'Grouped from recorded events (prompt link unavailable)'}
                </span>
              </div>
              <div className="replay-prompt-actions" data-testid="replay-prompt-actions">
                <button
                  type="button"
                  onClick={handleCopyPromptDiff}
                  disabled={!activePromptDiff}
                  title={activePromptDiff ? 'Copy the combined recorded diff' : 'No recorded diff to copy'}
                  data-testid="replay-copy-prompt-diff"
                >
                  <Copy size={13} />
                  Copy diff
                </button>
                {hasSpectateBridge && importedSessionId && (
                  <button
                    type="button"
                    onClick={handleOpenPromptFile}
                    disabled={!projectLinked || !activePromptFile || !onOpenSessionFile}
                    title={projectLinked
                      ? 'Open the selected changed file in your editor'
                      : 'Link the project folder to open files'}
                    data-testid="replay-open-prompt-file"
                  >
                    <ExternalLink size={13} />
                    Open in editor
                  </button>
                )}
                {hasSpectateBridge && importedSessionId && (
                  <button
                    type="button"
                    onClick={handleRevertPlan}
                    disabled={!onRequestRevertPlan}
                    title="Generate a read-only plan; no files will be changed"
                    data-testid="replay-generate-revert-plan"
                  >
                    <Undo2 size={13} />
                    Revert plan
                  </button>
                )}
                {actionNotice && (
                  <span className="replay-prompt-action-notice" role="status">
                    <Check size={12} />
                    {actionNotice}
                  </span>
                )}
              </div>
            </section>
          )}
          {!rawStepMode && activePrompt && activePrompt.changedFiles.length === 0 ? (
            <div className="replay-prompt-no-files" data-testid="replay-prompt-no-files">
              <strong>No recorded file changes for this prompt</strong>
              <span>Commands and other recorded evidence remain available in the Evidence panel.</span>
            </div>
          ) : (
            <ReplayDiffViewer
              selectedFile={selectedFile}
              changedFiles={currentEntry?.changed_files || []}
              changedSymbols={currentEntry?.changed_symbols || []}
              onSelectFile={handleSelectFile}
              getHistoricalContent={getHistoricalContent}
              entry={currentEntry}
              record={currentRecord}
              completenessInfo={completenessInfo}
              isModelNarrationAvailable={hasModelChapters}
              narration={narration}
              explanationLoading={explanationLoadingSequence === currentSeq}
              instantStepNote={instantStepNote}
              foldedRecords={foldedRecordsForCurrent}
            />
          )}
          </div>

          {/* Graph Mini Map Dock (Resizable, Size-cycling, Honest empty state) */}
          <ReplayMiniMapDock
            isOpen={isMiniMapOpen}
            onClose={() => setIsMiniMapOpen(false)}
            graphData={graphData}
            tests={adapter.getAllTests() as any}
            onSelectFile={handleSelectFile}
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
              <span>Evidence</span>
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
              selectionSummary={selectionSummary}
              selectionLoading={selectionLoading}
              selectionError={selectionError}
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
      {revertPlanOpen && (
        <div
          className="replay-revert-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRevertPlanOpen(false);
          }}
        >
          <section
            className="replay-revert-plan"
            role="dialog"
            aria-modal="true"
            aria-labelledby="replay-revert-plan-title"
            data-testid="replay-revert-plan"
          >
            <header>
              <div>
                <span className="replay-prompt-kicker">Derived, not applied</span>
                <h2 id="replay-revert-plan-title">Read-only revert plan</h2>
              </div>
              <button
                type="button"
                onClick={() => setRevertPlanOpen(false)}
                aria-label="Close revert plan"
                title="Close"
              >
                <X size={15} />
              </button>
            </header>
            <p className="replay-revert-provenance">
              This plan is derived from recorded patches and reconstructed file evidence. It never
              writes files or runs commands. Reconstructed content is unverified; unknown evidence
              remains marked unknown.
            </p>
            <div className="replay-revert-body">
              {revertPlanLoading && (
                <div className="replay-panel-empty" role="status">
                  <strong>Building the plan</strong>
                  <span>Reading the recorded file evidence for this prompt.</span>
                </div>
              )}
              {revertPlanError && (
                <div className="replay-panel-empty" role="alert">
                  <strong>Revert plan unavailable</strong>
                  <span>{revertPlanError}</span>
                </div>
              )}
              {revertPlan && (
                <>
                  <div className="replay-revert-summary">
                    <span>{revertPlan.actions.length} planned {revertPlan.actions.length === 1 ? 'action' : 'actions'}</span>
                    {revertPlan.truncated && <span>Plan is truncated</span>}
                  </div>
                  <pre data-testid="replay-revert-plan-text">{revertPlan.text}</pre>
                </>
              )}
            </div>
            <footer>
              <span>No changes are made from this screen.</span>
              <button
                type="button"
                disabled={!revertPlan}
                onClick={() => {
                  if (!revertPlan) return;
                  void copyText(revertPlan.text, 'Revert plan copied.').catch((error: unknown) => {
                    announceAction(error instanceof Error ? error.message : 'The plan could not be copied.');
                  });
                }}
                data-testid="replay-copy-revert-plan"
              >
                <Copy size={13} />
                Copy plan
              </button>
            </footer>
          </section>
        </div>
      )}
      {showNewPromptNotice && (
        <div
          className="replay-new-prompt-toast"
          role="status"
          aria-live="polite"
          data-testid="replay-new-prompt-toast"
        >
          <span aria-hidden="true" />
          New prompt recorded
        </div>
      )}
      <ReplayModelSetup
        open={!showTips && modelSetupOpen}
        message={modelSetupMessage}
        busy={modelSetupBusy}
        progress={modelDownloadProgress}
        onDownload={() => onDownloadModel?.()}
        onChoose={() => onChooseModel?.()}
        onSkip={() => onSkipModelSetup?.()}
      />
      <WatchProjectPrompt
        open={showWatchPrompt && !showTips && !modelSetupOpen}
        hasBridge={hasSpectateBridge}
        busy={watchProjectBusy}
        onChoose={() => void handleWatchProject()}
        onDismiss={handleDismissWatchPrompt}
      />
    </div>
  );
};
