import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FaultMeshAdapter } from './adapter';
import { FixtureAdapter } from './adapter';
import type { RunSummary, TestItem, GraphData, PinnedSymbol } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { GraphView } from './components/GraphView';
import { InspectorDrawer } from './components/InspectorDrawer';
import { RunDiagnosticsPane } from './components/RunDiagnosticsPane';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import './styles/theme.css';

const DEFAULT_ADAPTER = new FixtureAdapter(0);

interface AppProps {
  adapter?: FaultMeshAdapter;
}

export const App: React.FC<AppProps> = ({ adapter = DEFAULT_ADAPTER }) => {
  const [activeView, setActiveView] = useState<'evidence_map' | 'diagnostics' | 'investigation'>('evidence_map');
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

      // Default select: failing test as highlight layer (or first test)
      const failingTest = loadedTests.find((t) => t.status === 'fail');
      const errorTest = loadedTests.find((t) => t.status === 'error');
      const defaultTest = failingTest || errorTest || loadedTests[0] || null;

      setSelectedTestId(defaultTest ? defaultTest.id : null);
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
      <Header
        runs={runs}
        activeRun={activeRun}
        onSelectRun={(runId) => {
          setActiveRunId(runId);
        }}
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
        {/* Runs discovery error state */}
        {runsError && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
              textAlign: 'center',
            }}
          >
            <AlertTriangle size={32} style={{ color: 'var(--status-fail)', marginBottom: '10px' }} />
            <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>Failed to Load Runs</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', maxWidth: '420px', marginBottom: '14px' }}>
              {runsError}
            </p>
            <button onClick={loadRuns} className="btn-secondary btn-sm">
              <RotateCcw size={12} />
              Retry Discovery
            </button>
          </div>
        )}

        {/* Empty Runs list */}
        {!runsError && !isLoadingRuns && runs.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No Recorded Runs
            </div>
            <div style={{ fontSize: '12px', maxWidth: '380px' }}>
              No test execution artifacts or recorded runs were discovered for this workspace.
            </div>
          </div>
        )}

        {/* Active run artifacts error */}
        {runDataError && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
              textAlign: 'center',
            }}
          >
            <AlertTriangle size={32} style={{ color: 'var(--status-error)', marginBottom: '10px' }} />
            <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>Run Artifact Error</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', maxWidth: '420px', marginBottom: '14px' }}>
              {runDataError}
            </p>
            {activeRunId && (
              <button onClick={() => loadActiveRunData(activeRunId)} className="btn-secondary btn-sm">
                <RotateCcw size={12} />
                Retry Loading Run
              </button>
            )}
          </div>
        )}

        {/* Normal Loading state for run data */}
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

        {/* Holistic Workspace Body */}
        {!runsError && runs.length > 0 && !runDataError && (
          <>
            {activeView === 'diagnostics' ? (
              <RunDiagnosticsPane activeRun={activeRun} graphData={graphData} />
            ) : (
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
                {/* 1. Left Zotero-like Sidebar (Tests, Pinned Shortlist, Files) */}
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
                  pinnedSymbols={pinnedSymbols}
                  onPinSymbol={handlePinSymbol}
                  onUnpinSymbol={handleUnpinSymbol}
                  onClose={handleCloseInspector}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
