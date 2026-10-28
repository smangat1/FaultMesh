import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { FaultMeshAdapter } from './adapter';
import { FixtureAdapter, ImportedAdapter, LiveSpectateAdapter, EmptyAdapter } from './adapter';
import type { RunSummary, TestItem, GraphData, PinnedSymbol } from './types';
import { Header, type WorkspaceActiveView } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { GraphView, type GraphViewMode } from './components/GraphView';
import { InspectorDrawer } from './components/InspectorDrawer';
import { RunDiagnosticsPane } from './components/RunDiagnosticsPane';
import { ReplayComparisonView } from './components/ReplayComparisonView';
import { ProjectSelectorScreen } from './components/ProjectSelectorScreen';
import { StartupScreen } from './components/StartupScreen';
import { LiveEntranceScreen } from './components/LiveEntranceScreen';
import { SpectateHook } from './components/SpectateHook';
import { LiveToast } from './components/LiveToast';
import { LiveFilesView } from './components/LiveFilesView';
import { LiveChangesView } from './components/LiveChangesView';
import { LiveMapDrawers } from './components/LiveMapDrawers';
import { useLiveSpectate } from './spectate/useLiveSpectate';
import { isDemoMode } from './utils/demo';
import {
  AGENT_SIMULATION_STEPS,
  AGENT_ORIGINAL_SNIPPET,
  type AgentLogEntry,
} from './agent/agentSimulation';
import {
  validateV3Structure,
  validateV2RunEvidence,
  MAX_V3_SIZE_BYTES,
  type V3StructureExport,
  type V2RunEvidenceExport,
} from './import';
import { AlertTriangle } from 'lucide-react';
import { EMPTY_LIVE_SPECTATE_STATE, type LiveSpectateState } from './spectate/liveState';
import type { Core } from 'cytoscape';
import './styles/theme.css';

export interface AppProps {
  adapter?: FaultMeshAdapter;
  initialScreen?: 'selector' | 'entrance' | 'workspace';
  isDemo?: boolean;
}

export const App: React.FC<AppProps> = ({
  adapter,
  initialScreen = 'selector',
  isDemo,
}) => {
  const isDemoActive = isDemo ?? isDemoMode();
  const [activeAdapter, setActiveAdapter] = useState<FaultMeshAdapter>(() => {
    if (adapter) return adapter;
    return isDemoActive ? new FixtureAdapter(0) : new EmptyAdapter();
  });

  const [importError, setImportError] = useState<string | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'selector' | 'entrance' | 'workspace'>(initialScreen);
  const [activeView, setActiveView] = useState<WorkspaceActiveView>('map');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    edges: [],
    unresolvedReferences: [],
    parseErrors: [],
    files: [],
  });
  const [liveChangedNodeIds, setLiveChangedNodeIds] = useState<string[]>([]);
  const [liveSpectateState, setLiveSpectateState] = useState<LiveSpectateState>(EMPTY_LIVE_SPECTATE_STATE);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeMapDrawer, setActiveMapDrawer] = useState<'none' | 'files' | 'diff'>('none');
  const cyInstanceRef = useRef<Core | null>(null);
  const lastChangeTimeRef = useRef<string | null>(null);
  const burstCounterRef = useRef<{ count: number; windowStart: number }>({ count: 0, windowStart: 0 });
  const liveAdapterRef = useRef<LiveSpectateAdapter | null>(null);
  const liveRefreshSeq = useRef(0);
  const activeAdapterRef = useRef<FaultMeshAdapter>(activeAdapter);
  const activeRunIdRef = useRef<string | null>(activeRunId);

  useEffect(() => {
    activeAdapterRef.current = activeAdapter;
  }, [activeAdapter]);

  useEffect(() => {
    if (adapter) {
      setActiveAdapter(adapter);
    }
  }, [adapter]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  // Selection states
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<GraphViewMode>('structure');

  // Shortlist and File cluster collapse states
  const [pinnedSymbols, setPinnedSymbols] = useState<PinnedSymbol[]>([]);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  // Loading & Error States
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [isLoadingRunData, setIsLoadingRunData] = useState<boolean>(false);
  const [runDataError, setRunDataError] = useState<string | null>(null);

  // Autonomous Agent Repair Simulation State
  const [isAgentActive, setIsAgentActive] = useState<boolean>(false);
  const [agentStepIndex, setAgentStepIndex] = useState<number>(0);
  const [isAgentPlaying, setIsAgentPlaying] = useState<boolean>(false);
  const [agentSpeed, setAgentSpeed] = useState<number>(1);
  const [isExplanationExpanded, setIsExplanationExpanded] = useState<boolean>(false);
  const [, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const agentTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Request cancellation token / sequence counter to guard against async race conditions
  const requestSeq = useRef<number>(0);

  // Initial runs load
  const loadRuns = useCallback(async () => {
    setIsLoadingRuns(true);
    setRunsError(null);
    try {
      const loadedRuns = await activeAdapter.getRuns();
      setRuns(loadedRuns);
      if (loadedRuns.length > 0) {
        setActiveRunId((prev) => {
          if (prev && loadedRuns.some((r) => r.id === prev)) {
            return prev;
          }
          return loadedRuns[0].id;
        });
      } else {
        setActiveRunId(null);
      }
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to discover recorded runs.');
    } finally {
      setIsLoadingRuns(false);
    }
  }, [activeAdapter]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Load active run tests and graph
  const loadActiveRunData = useCallback(async (runId: string) => {
    const currentSeq = ++requestSeq.current;
    setIsLoadingRunData(true);
    setRunDataError(null);

    try {
      const [loadedTests, loadedGraph] = await Promise.all([
        activeAdapter.getTests(runId),
        activeAdapter.getGraph(runId),
      ]);

      // Guard against stale async responses if user switched runs quickly
      if (currentSeq !== requestSeq.current) return;

      setTests(loadedTests);
      setGraphData(loadedGraph);

      // Structure mode by default on open: all files collapsed into clean overview constellation, no test preselected
      const allFiles = new Set((loadedGraph.files || []).map((fc) => fc.file));
      setCollapsedFiles(activeAdapter instanceof LiveSpectateAdapter ? new Set() : allFiles);

      setSelectedTestId(null);
      setSelectedNodeId(null);
      setSelectedFile(null);
    } catch (err) {
      if (currentSeq !== requestSeq.current) return;
      setRunDataError(err instanceof Error ? err.message : `Failed to load artifacts for run ${runId}`);
    } finally {
      if (currentSeq === requestSeq.current) {
        setIsLoadingRunData(false);
      }
    }
  }, [activeAdapter]);

  useEffect(() => {
    if (!activeRunId) {
      setTests([]);
      setGraphData({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [], files: [] });
      setSelectedTestId(null);
      setSelectedNodeId(null);
      setSelectedFile(null);
      return;
    }
    loadActiveRunData(activeRunId);
  }, [activeRunId, loadActiveRunData]);

  const activeRun = runs.find((r) => r.id === activeRunId) || null;
  const failedTestCount = tests.filter((t) => t.status === 'fail').length;
  const errorCount = tests.filter((t) => t.status === 'error').length;
  const diagnosticsCount =
    (graphData.unresolvedReferences?.length || 0) +
    (graphData.parseErrors?.length || 0) +
    (activeRun?.errorMessage ? 1 : 0);

  const latestSavedTimestamp = useMemo(() => {
    if (liveSpectateState.fileHistory.length > 0) {
      return Math.max(...liveSpectateState.fileHistory.map((f) => f.timestamp || 0));
    }
    return null;
  }, [liveSpectateState.fileHistory]);

  const lastSavedRelativeText = useMemo(() => {
    if (!latestSavedTimestamp) return 'just now';
    const diffSec = Math.max(0, Math.round((Date.now() - latestSavedTimestamp) / 1000));
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    return `${diffHours}h ago`;
  }, [latestSavedTimestamp]);

  // Shortlist management
  const handlePinSymbol = (symbol: PinnedSymbol) => {
    setPinnedSymbols((prev) => {
      if (prev.some((p) => p.id === symbol.id)) return prev;
      return [...prev, symbol];
    });
  };

  const handleUnpinSymbol = (symbolId: string) => {
    setPinnedSymbols((prev) => prev.filter((p) => p.id !== symbolId));
  };

  // File cluster collapse management
  const handleToggleCollapseFile = (file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const handleCollapseAllFiles = () => {
    const allFiles = new Set((graphData.files || []).map((fc) => fc.file));
    setCollapsedFiles(allFiles);
  };

  const handleExpandAllFiles = () => {
    setCollapsedFiles(new Set());
  };

  const handleSelectViewMode = (mode: GraphViewMode) => {
    setViewMode(mode);
    if (mode === 'changes') {
      setSelectedTestId(null);
    }
  };

  const handleSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setSelectedFile(null);
      // Auto-unfold parent file if currently collapsed so the node is visible
      const node = graphData.nodes.find((n) => n.id === nodeId);
      if (node && collapsedFiles.has(node.file)) {
        setCollapsedFiles((prev) => {
          const next = new Set(prev);
          next.delete(node.file);
          return next;
        });
      }
    }
  };

  const handleSelectFile = (file: string | null) => {
    setSelectedFile(file);
    if (file) {
      setSelectedNodeId(null);
    }
  };

  const handleSelectTest = (testId: string | null) => {
    setSelectedTestId(testId);
    if (testId) {
      setSelectedNodeId(null);
      setSelectedFile(null);
      // Auto-unfold files involved in the selected test trace
      const test = tests.find((t) => t.id === testId);
      if (test && test.exercisedNodeIds) {
        const filesToUnfold = new Set<string>();
        graphData.nodes.forEach((n) => {
          if (test.exercisedNodeIds.includes(n.id) || n.id === testId) {
            filesToUnfold.add(n.file);
          }
        });
        if (filesToUnfold.size > 0) {
          setCollapsedFiles((prev) => {
            const next = new Set(prev);
            filesToUnfold.forEach((f) => next.delete(f));
            return next;
          });
        }
      }
    }
  };

  const handleSelectRun = (runId: string) => {
    setActiveRunId(runId);
    if (
      activeAdapter instanceof ImportedAdapter
      || activeAdapter instanceof LiveSpectateAdapter
    ) {
      activeAdapter.setActiveV2Run(runId);
    }
    setPinnedSymbols([]);
    setSelectedNodeId(null);
    setSelectedFile(null);
    setSelectedTestId(null);
  };

  // File import handler for local V3 and V2 JSON exports
  const handleImportFiles = async (files: FileList | File[]) => {
    setImportError(null);
    try {
      const fileList = Array.from(files);
      if (fileList.length === 0) return;

      let v3Doc: V3StructureExport | null = null;
      const v2Docs: V2RunEvidenceExport[] = [];

      for (const f of fileList) {
        if (f.size > MAX_V3_SIZE_BYTES) {
          throw new Error(`File "${f.name}" (${(f.size / (1024 * 1024)).toFixed(1)} MB) exceeds 64 MB size limit`);
        }
        const text = await f.text();
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text);
        } catch (err) {
          throw new Error(`Malformed JSON in file "${f.name}": ${err instanceof Error ? err.message : String(err)}`);
        }

        if (json.schema_version === '3.0') {
          const val = validateV3Structure(json, f.size);
          if (!val.success) {
            throw new Error(`V3 validation failed for "${f.name}": ${val.errors.map((e) => e.message).join('; ')}`);
          }
          v3Doc = val.data!;
        } else if (json.schema_version === '2.0') {
          const val = validateV2RunEvidence(json, f.size);
          if (!val.success) {
            throw new Error(`V2 validation failed for "${f.name}": ${val.errors.map((e) => e.message).join('; ')}`);
          }
          v2Docs.push(val.data!);
        } else {
          throw new Error(
            `Unsupported schema_version in "${f.name}": expected "3.0" for structure or "2.0" for run evidence, found "${String(json.schema_version)}"`
          );
        }
      }

      if (!v3Doc) {
        if (
          activeAdapter instanceof ImportedAdapter
          || activeAdapter instanceof LiveSpectateAdapter
        ) {
          for (const v2 of v2Docs) {
            activeAdapter.addV2Run(v2);
          }
          const loadedRuns = await activeAdapter.getRuns();
          setRuns(loadedRuns);
          if (loadedRuns.length > 0) {
            setActiveRunId(loadedRuns[0].id);
            await loadActiveRunData(loadedRuns[0].id);
          }
          return;
        }
        throw new Error(
          'Please select a V3 static structure JSON export (schema_version 3.0). V2 evidence requires a matching V3 structure.'
        );
      }

      // Valid V3 document loaded
      const newAdapter = new ImportedAdapter(v3Doc, v2Docs);
      liveAdapterRef.current = null;
      setLiveChangedNodeIds([]);
      setActiveAdapter(newAdapter);

      // Reset selection and pins to prevent stale state
      setPinnedSymbols([]);
      setSelectedNodeId(null);
      setSelectedFile(null);
      setSelectedTestId(null);
      setIsAgentActive(false);

      const loadedRuns = await newAdapter.getRuns();
      setRuns(loadedRuns);
      if (loadedRuns.length > 0) {
        setActiveRunId(loadedRuns[0].id);
      }
      setCurrentScreen('workspace');
    } catch (err) {
      // Keep previous dataset and show specific dismissible error
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetToSampleDemo = useCallback(() => {
    liveAdapterRef.current = null;
    setLiveChangedNodeIds([]);
    setActiveAdapter(new FixtureAdapter(0));
    setImportError(null);
    setSelectedTestId(null);
    setSelectedNodeId(null);
    setSelectedFile(null);
    setPinnedSymbols([]);
    setIsAgentActive(false);
  }, []);

  const handleLiveStateChange = useCallback((state: LiveSpectateState) => {
    if (!state.initialized || !state.sessionId) return;
    setLiveSpectateState(state);

    // Toast notification for observed saved changes on disk (quiet, auto-dismissing, static claims only)
    if (state.change && state.change.updatedAt !== lastChangeTimeRef.current) {
      lastChangeTimeRef.current = state.change.updatedAt;
      const now = Date.now();
      if (now - burstCounterRef.current.windowStart < 1500) {
        burstCounterRef.current.count++;
      } else {
        burstCounterRef.current = { count: 1, windowStart: now };
      }

      if (burstCounterRef.current.count > 1) {
        setToastMessage('Files actively changing on disk');
      } else {
        setToastMessage(`${state.change.path} changed on disk`);
      }
    }

    let liveAdapter = liveAdapterRef.current;
    const isNewDataset = liveAdapter?.getSessionId() !== state.sessionId;
    if (isNewDataset) {
      const currentAdapter = activeAdapterRef.current;
      const v2Runs = currentAdapter instanceof ImportedAdapter
        || currentAdapter instanceof LiveSpectateAdapter
        ? currentAdapter.getV2Runs()
        : [];
      liveAdapter = new LiveSpectateAdapter(state, v2Runs);
      liveAdapterRef.current = liveAdapter;
      activeAdapterRef.current = liveAdapter;
      setActiveAdapter(liveAdapter);
      // When watching starts / project selected, land on calm entrance screen instead of tab bar
      setCurrentScreen((prev) => (prev === 'selector' ? 'entrance' : prev));
      setActiveView('map');
      setPinnedSymbols([]);
      setSelectedTestId(null);
      setSelectedNodeId(null);
      setSelectedFile(null);
      setCollapsedFiles(new Set());
      setIsAgentActive(false);
    } else if (liveAdapter) {
      liveAdapter.update(state);
    }
    if (!liveAdapter) return;
    const adapterForRefresh = liveAdapter;

    setLiveChangedNodeIds(state.changedNodeIds);
    const refreshSeq = ++liveRefreshSeq.current;
    void (async () => {
      const loadedRuns = await adapterForRefresh.getRuns();
      const previousRunId = activeRunIdRef.current;
      const runId = previousRunId && loadedRuns.some((run) => run.id === previousRunId)
        ? previousRunId
        : loadedRuns[0]?.id ?? null;
      const [loadedTests, loadedGraph] = runId
        ? await Promise.all([
            adapterForRefresh.getTests(runId),
            adapterForRefresh.getGraph(runId),
          ])
        : [[], { nodes: [], edges: [], unresolvedReferences: [], parseErrors: [], files: [] }];
      if (refreshSeq !== liveRefreshSeq.current) return;
      setRuns(loadedRuns);
      setActiveRunId(runId);
      activeRunIdRef.current = runId;
      setTests(loadedTests);
      setGraphData(loadedGraph);
      setRunDataError(null);
      setIsLoadingRunData(false);
    })().catch((error: unknown) => {
      if (refreshSeq !== liveRefreshSeq.current) return;
      setRunDataError(error instanceof Error ? error.message : 'Failed to build live project map.');
    });
  }, []);

  const spectate = useLiveSpectate({ onLiveStateChange: handleLiveStateChange });

  const handleDrawerSelectFile = useCallback((file: string) => {
    setSelectedFile(file);
    setSelectedNodeId(null);
    setSelectedTestId(null);
    const cy = cyInstanceRef.current;
    if (cy) {
      const fileNode = cy.getElementById(`file:${file}`);
      if (fileNode.length > 0) {
        cy.animate({
          center: { eles: fileNode },
          duration: 250,
        });
      }
    }
  }, []);

  const handleCloseInspector = () => {
    setSelectedNodeId(null);
    setSelectedFile(null);
    setSelectedTestId(null);
  };

  const currentAgentStep = isAgentActive ? AGENT_SIMULATION_STEPS[agentStepIndex] : null;

  const applyAgentStep = useCallback((idx: number) => {
    const step = AGENT_SIMULATION_STEPS[idx];
    if (!step) return;

    setAgentStepIndex(idx);

    // 1. Target node selection: track active target without jarring drawer open/close layout shifts
    setSelectedNodeId(step.targetNodeId);
    setSelectedFile(null);

    // 2. Unfold active step's target file if collapsed, preserving existing layout
    if (step.targetNodeId) {
      const targetNode = graphData.nodes.find((n) => n.id === step.targetNodeId);
      if (targetNode && collapsedFiles.has(targetNode.file)) {
        setCollapsedFiles((prev) => {
          const next = new Set(prev);
          next.delete(targetNode.file);
          return next;
        });
      }
    }

    // 3. Test Status Time-Travel (revert to fail if jumping back to steps 0..3)
    if (step.activeTestStatus) {
      setTests((prev) =>
        prev.map((t) =>
          t.id === 'tests/test_auth.py::test_login_expired_token'
            ? { ...t, status: step.activeTestStatus as any }
            : t
        )
      );
    }

    // 4. Code Mutation State Time-Travel (revert code to original if jumping back to steps 0..2)
    if (step.patchedSnippet && step.patchedDiff) {
      setGraphData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === 'auth/tokens.py::validate_token'
            ? { ...n, sourceSnippet: step.patchedSnippet!, gitDiff: step.patchedDiff!, changeStatus: 'modified' }
            : n
        ),
      }));
    } else {
      // Revert code snippet and diff back to original pre-patch state when jumping backward!
      setGraphData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === 'auth/tokens.py::validate_token'
            ? { ...n, sourceSnippet: AGENT_ORIGINAL_SNIPPET, gitDiff: undefined, changeStatus: 'modified' }
            : n
        ),
      }));
    }

    // 5. View Mode Time-Travel (Structure mode in steps 0..4, Changes mode in step 5)
    if (step.phase === 'resolved') {
      setViewMode('changes');
    } else {
      setViewMode('structure');
    }

    // Append to agent thought logs
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setAgentLogs((prev) => [
      ...prev,
      {
        id: `agent-log-${Date.now()}-${idx}`,
        timestamp: timeStr,
        phase: step.phase,
        title: step.log.title,
        message: step.log.message,
        badge: step.log.badge,
        codeTarget: step.targetNodeId,
      },
    ]);
  }, []);

  const startAgentSimulation = useCallback(() => {
    setIsAgentActive(true);
    setIsAgentPlaying(true);
    setAgentLogs([]);
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      next.delete('tests/test_auth.py');
      next.delete('auth/service.py');
      next.delete('auth/tokens.py');
      return next;
    });
    applyAgentStep(0);
  }, [applyAgentStep]);

  const stopAgentSimulation = useCallback(() => {
    setIsAgentActive(false);
    setIsAgentPlaying(false);
    if (agentTimerRef.current) clearTimeout(agentTimerRef.current);
    if (activeRunId) {
      loadActiveRunData(activeRunId);
    }
  }, [activeRunId, loadActiveRunData]);

  // Playback timer effect with variable step duration
  useEffect(() => {
    if (!isAgentActive || !isAgentPlaying) {
      if (agentTimerRef.current) clearTimeout(agentTimerRef.current);
      return;
    }

    if (agentStepIndex >= AGENT_SIMULATION_STEPS.length - 1) {
      setIsAgentPlaying(false);
      return;
    }

    const currentStep = AGENT_SIMULATION_STEPS[agentStepIndex];
    const duration = currentStep?.durationMs || 2500;
    const delay = Math.round(duration / agentSpeed);
    agentTimerRef.current = setTimeout(() => {
      applyAgentStep(agentStepIndex + 1);
    }, delay);

    return () => {
      if (agentTimerRef.current) clearTimeout(agentTimerRef.current);
    };
  }, [isAgentActive, isAgentPlaying, agentStepIndex, agentSpeed, applyAgentStep]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: '#101114',
        color: 'var(--text-primary)',
      }}
    >
      {importError && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid #ef4444',
            color: '#fca5a5',
            padding: '8px 16px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            zIndex: 9999,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={15} color="#ef4444" />
            <span>{importError}</span>
          </div>
          <button
            onClick={() => setImportError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 6px',
            }}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {currentScreen === 'selector' ? (
        isDemoActive ? (
          <ProjectSelectorScreen
            runs={runs}
            activeRun={activeRun}
            tests={tests}
            onSelectRun={(runId) => {
              setActiveRunId(runId);
            }}
            onResetToSample={handleResetToSampleDemo}
            onOpenWorkspace={(testId, startAgent) => {
              if (testId) {
                setSelectedTestId(testId);
              }
              setCurrentScreen('workspace');
              if (startAgent && !activeRun?.isRealImport) {
                startAgentSimulation();
              }
            }}
            onOpenDiagnostics={() => {
              setActiveView('diagnostics');
              setCurrentScreen('workspace');
            }}
            isLoading={isLoadingRuns || isLoadingRunData}
            error={runsError || runDataError}
            onRetry={
              runsError
                ? loadRuns
                : activeRunId
                ? () => loadActiveRunData(activeRunId)
                : undefined
            }
            onOpenFiles={handleImportFiles}
          />
        ) : (
          <StartupScreen
            onSelectProject={spectate.startWatching}
            isBusy={spectate.busy}
            hasBridge={spectate.hasBridge}
            statusNote={spectate.statusNote}
            activeRun={activeRun}
            onReturnToWorkspace={() => setCurrentScreen(activeRun?.isLive ? 'entrance' : 'workspace')}
          />
        )
      ) : currentScreen === 'entrance' ? (
        <LiveEntranceScreen
          projectName={activeRun?.project || liveSpectateState.projectName || 'Watched Project'}
          filesCount={liveSpectateState.files.length || graphData.files?.length || 0}
          nodesCount={graphData.nodes?.length || liveSpectateState.symbols?.length || 0}
          changedFilesCount={liveSpectateState.fileHistory.length}
          lastSavedText={lastSavedRelativeText}
          liveStatus={liveSpectateState.status === 'live' ? 'live' : 'stopped'}
          onSelectMode={(mode) => {
            setActiveView(mode);
            setCurrentScreen('workspace');
          }}
          onBackToSelector={() => setCurrentScreen('selector')}
          onSelectAnotherProject={spectate.startWatching}
        />
      ) : (
        <>
          <Header
            runs={runs}
            activeRun={activeRun}
            onSelectRun={handleSelectRun}
            onBackToSelector={() => setCurrentScreen('selector')}
            onBackToEntrance={() => setCurrentScreen('entrance')}
            activeView={activeView}
            onSelectView={setActiveView}
            failedTestCount={failedTestCount}
            errorCount={errorCount}
            diagnosticsCount={diagnosticsCount}
            onOpenFiles={handleImportFiles}
          />

          <main
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              position: 'relative',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {/* Loading state for run data */}
            {isLoadingRunData && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '16px',
                  zIndex: 100,
                  backgroundColor: 'var(--bg-raised)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                }}
              >
                Loading run artifacts...
              </div>
            )}

            {/* Files View (Live Watch 3-View Layout) */}
            {activeView === 'files' ? (
              <LiveFilesView
                files={liveSpectateState.files}
                fileHistory={liveSpectateState.fileHistory}
                liveStatus={liveSpectateState.status}
                stopReason={liveSpectateState.stopReason}
                projectName={activeRun?.project}
                onSelectFile={(f) => {
                  setSelectedFile(f);
                  setSelectedNodeId(null);
                }}
                onOpenMap={(f) => {
                  setSelectedFile(f);
                  setSelectedNodeId(null);
                  setActiveView('map');
                }}
                onOpenChanges={(f) => {
                  setSelectedFile(f);
                  setSelectedNodeId(null);
                  setActiveView('changes');
                }}
              />
            ) : activeView === 'changes' ? (
              /* Changes View (Live Watch 3-View Layout) */
              <LiveChangesView
                fileHistory={liveSpectateState.fileHistory}
                liveStatus={liveSpectateState.status}
                stopReason={liveSpectateState.stopReason}
                selectedFilePath={selectedFile}
                onSelectFilePath={(f) => setSelectedFile(f)}
                onOpenMap={(f) => {
                  setSelectedFile(f);
                  setSelectedNodeId(null);
                  setActiveView('map');
                }}
              />
            ) : activeView === 'diagnostics' ? (
              <RunDiagnosticsPane activeRun={activeRun} graphData={graphData} />
            ) : activeView === 'replay' ? (
              <ReplayComparisonView
                activeRun={activeRun}
                runs={runs}
                adapter={activeAdapter}
                onSelectRun={handleSelectRun}
                onSelectTest={handleSelectTest}
              />
            ) : (
              /* Holistic Map Workspace */
              <div
                style={{
                  display: 'flex',
                  width: '100%',
                  height: '100%',
                  minWidth: 0,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* 1. Left Sidebar (Tests, Pinned Shortlist, Files) */}
                <Sidebar
                  tests={tests}
                  selectedTestId={selectedTestId}
                  onSelectTest={handleSelectTest}
                  files={graphData.files}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  collapsedFiles={collapsedFiles}
                  onToggleCollapseFile={handleToggleCollapseFile}
                  onCollapseAllFiles={handleCollapseAllFiles}
                  onExpandAllFiles={handleExpandAllFiles}
                  nodes={graphData.nodes}
                  pinnedSymbols={pinnedSymbols}
                  onPinSymbol={handlePinSymbol}
                  onUnpinSymbol={handleUnpinSymbol}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  viewMode={viewMode}
                  isRealImport={activeRun?.isRealImport}
                  isLive={activeRun?.isLive}
                  harnessError={activeRun?.harnessError}
                />

                {/* 2. Center: Dominant Whole-Project Map */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                    overflow: 'hidden',
                    backgroundColor: '#101114',
                    position: 'relative',
                  }}
                >
                  <GraphView
                    graphData={graphData}
                    tests={tests}
                    highlightedNodeIds={liveChangedNodeIds}
                    datasetKey={`${activeRun?.id || 'none'}:${activeRun?.contentSha256 || activeRun?.envelopeHeadSha || 'none'}`}
                    selectedTestId={selectedTestId}
                    onSelectTest={handleSelectTest}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    selectedFile={selectedFile}
                    onSelectFile={handleSelectFile}
                    pinnedSymbolIds={pinnedSymbols.map((p) => p.id)}
                    collapsedFiles={collapsedFiles}
                    onToggleCollapseFile={handleToggleCollapseFile}
                    onCollapseAllFiles={handleCollapseAllFiles}
                    onExpandAllFiles={handleExpandAllFiles}
                    viewMode={viewMode}
                    onSelectViewMode={handleSelectViewMode}
                    runStatus={activeRun?.status}
                    errorMessage={activeRun?.errorMessage}
                    isRealImport={activeRun?.isRealImport}
                    isLive={activeRun?.isLive}
                    hasActiveToast={Boolean(toastMessage)}
                    activeMapDrawer={activeMapDrawer}
                    onToggleMapDrawer={setActiveMapDrawer}
                    onCyReady={(cy) => {
                      cyInstanceRef.current = cy;
                    }}
                    isAgentMode={activeRun?.isRealImport || activeRun?.isLive ? false : isAgentActive}
                    onToggleAgentMode={
                      activeRun?.isRealImport || activeRun?.isLive
                        ? undefined
                        : isAgentActive
                        ? stopAgentSimulation
                        : startAgentSimulation
                    }
                    agentActiveNodeId={currentAgentStep?.targetNodeId}
                    agentPhase={currentAgentStep?.phase}
                    agentPhaseLabel={currentAgentStep?.phaseLabel}
                    agentActionPill={currentAgentStep?.actionPill}
                    agentActiveEdgeIds={currentAgentStep?.activeEdgeIds}
                    agentZoomTarget={currentAgentStep?.cameraZoom}
                    isInspectorOpen={Boolean(selectedNodeId || selectedTestId || selectedFile)}
                    agentStepIndex={agentStepIndex}
                    totalAgentSteps={AGENT_SIMULATION_STEPS.length}
                    isAgentPlaying={isAgentPlaying}
                    onToggleAgentPlay={() => setIsAgentPlaying((prev) => !prev)}
                    onPrevAgentStep={() => {
                      setIsAgentPlaying(false);
                      applyAgentStep(Math.max(0, agentStepIndex - 1));
                    }}
                    onNextAgentStep={() => {
                      setIsAgentPlaying(false);
                      applyAgentStep(
                        Math.min(AGENT_SIMULATION_STEPS.length - 1, agentStepIndex + 1)
                      );
                    }}
                    onRestartAgent={startAgentSimulation}
                    onJumpAgentStep={(idx) => {
                      setIsAgentPlaying(false);
                      applyAgentStep(idx);
                    }}
                    agentSpeed={agentSpeed}
                    onChangeAgentSpeed={setAgentSpeed}
                    currentAgentStep={currentAgentStep}
                    isExplanationExpanded={isExplanationExpanded}
                    onToggleExplanationExpand={() => setIsExplanationExpanded((prev) => !prev)}
                  />

                  {/* Quiet Toast on Map View */}
                  {activeRun?.isLive && (
                    <LiveToast
                      message={toastMessage}
                      onDismiss={() => setToastMessage(null)}
                    />
                  )}

                  {/* Unfoldable Drawers on Map View */}
                  {activeRun?.isLive && (
                    <LiveMapDrawers
                      activeDrawer={activeMapDrawer}
                      onClose={() => setActiveMapDrawer('none')}
                      files={liveSpectateState.files}
                      fileHistory={liveSpectateState.fileHistory}
                      selectedFile={selectedFile}
                      onSelectFile={handleDrawerSelectFile}
                    />
                  )}
                </div>

                {/* 3. Right: Contextual Slide-Out Inspector Drawer */}
                {activeMapDrawer === 'none' && (
                  <InspectorDrawer
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  selectedTestId={selectedTestId}
                  onSelectTest={handleSelectTest}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  tests={tests}
                  files={graphData.files}
                  collapsedFiles={collapsedFiles}
                  onToggleCollapseFile={handleToggleCollapseFile}
                  pinnedSymbols={pinnedSymbols}
                  onPinSymbol={handlePinSymbol}
                  onUnpinSymbol={handleUnpinSymbol}
                  onClose={handleCloseInspector}
                  isAgentActive={activeRun?.isRealImport || activeRun?.isLive ? false : isAgentActive}
                  agentPhase={currentAgentStep?.phase}
                  agentPhaseEvidence={currentAgentStep?.phaseEvidence}
                  agentPatchedSnippet={currentAgentStep?.patchedSnippet}
                  agentPatchedDiff={currentAgentStep?.patchedDiff}
                  onReplayInvestigation={activeRun?.isRealImport || activeRun?.isLive ? undefined : startAgentSimulation}
                />
              )}
            </div>
            )}
          </main>
        </>
      )}
      {(currentScreen === 'workspace' || currentScreen === 'entrance') && (
        <SpectateHook controller={spectate} hideBanner={Boolean(activeRun?.isLive)} />
      )}
    </div>
  );
};
