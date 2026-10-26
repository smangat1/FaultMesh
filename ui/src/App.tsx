import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FaultMeshAdapter } from './adapter';
import { FixtureAdapter } from './adapter';
import type { RunSummary, TestItem, GraphData, PinnedSymbol } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { GraphView, type GraphViewMode } from './components/GraphView';
import { InspectorDrawer } from './components/InspectorDrawer';
import { RunDiagnosticsPane } from './components/RunDiagnosticsPane';
import { ProjectSelectorScreen } from './components/ProjectSelectorScreen';
import './styles/theme.css';

const DEFAULT_ADAPTER = new FixtureAdapter(0);

interface AppProps {
  adapter?: FaultMeshAdapter;
  initialScreen?: 'selector' | 'workspace';
}

export const App: React.FC<AppProps> = ({ adapter = DEFAULT_ADAPTER, initialScreen = 'selector' }) => {
  const [currentScreen, setCurrentScreen] = useState<'selector' | 'workspace'>(initialScreen);
  const [activeView, setActiveView] = useState<'map' | 'diagnostics'>('map');
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

  // Request cancellation token / sequence counter to guard against async race conditions
  const requestSeq = useRef<number>(0);

  // Initial runs load
  const loadRuns = useCallback(async () => {
    setIsLoadingRuns(true);
    setRunsError(null);
    try {
      const loadedRuns = await adapter.getRuns();
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
  }, [adapter]);

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
        adapter.getTests(runId),
        adapter.getGraph(runId),
      ]);

      // Guard against stale async responses if user switched runs quickly
      if (currentSeq !== requestSeq.current) return;

      setTests(loadedTests);
      setGraphData(loadedGraph);

      // Structure mode by default on open: all files collapsed into clean overview constellation, no test preselected
      const allFiles = new Set((loadedGraph.files || []).map((fc) => fc.file));
      setCollapsedFiles(allFiles);

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
  }, [adapter]);

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

  const handleSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setSelectedFile(null);
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
    }
  };

  const handleCloseInspector = () => {
    setSelectedNodeId(null);
    setSelectedFile(null);
    setSelectedTestId(null);
  };

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
      {currentScreen === 'selector' ? (
        <ProjectSelectorScreen
          runs={runs}
          activeRun={activeRun}
          tests={tests}
          onSelectRun={(runId) => {
            setActiveRunId(runId);
          }}
          onOpenWorkspace={(testId) => {
            if (testId) {
              setSelectedTestId(testId);
            }
            setCurrentScreen('workspace');
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
        />
      ) : (
        <>
          <Header
            activeRun={activeRun}
            onBackToSelector={() => setCurrentScreen('selector')}
            activeView={activeView}
            onSelectView={setActiveView}
            failedTestCount={failedTestCount}
            errorCount={errorCount}
            diagnosticsCount={diagnosticsCount}
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

            {/* Diagnostics View */}
            {activeView === 'diagnostics' ? (
              <RunDiagnosticsPane activeRun={activeRun} graphData={graphData} />
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
                  nodes={graphData.nodes}
                  pinnedSymbols={pinnedSymbols}
                  onPinSymbol={handlePinSymbol}
                  onUnpinSymbol={handleUnpinSymbol}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  viewMode={viewMode}
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
                    onSelectViewMode={setViewMode}
                    runStatus={activeRun?.status}
                    errorMessage={activeRun?.errorMessage}
                  />
                </div>

                {/* 3. Right: Contextual Slide-Out Inspector Drawer */}
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
                />
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
};
