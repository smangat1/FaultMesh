import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FaultMeshAdapter } from './adapter';
import { FixtureAdapter } from './adapter';
import type { RunSummary, TestItem, GraphData } from './types';
import { Header } from './components/Header';
import { TestList } from './components/TestList';
import { TestDetailsPane } from './components/TestDetailsPane';
import { GraphView } from './components/GraphView';
import { RunDiagnosticsPane } from './components/RunDiagnosticsPane';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import './styles/theme.css';

const DEFAULT_ADAPTER = new FixtureAdapter(0);

interface AppProps {
  adapter?: FaultMeshAdapter;
}

export const App: React.FC<AppProps> = ({ adapter = DEFAULT_ADAPTER }) => {
  const [activeView, setActiveView] = useState<'investigation' | 'evidence_map' | 'diagnostics'>('investigation');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    edges: [],
    unresolvedReferences: [],
    parseErrors: [],
  });
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
        // Adopt first valid run if current ID is null or missing from loaded runs
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

      // Default select: failing test > error test > first test > null
      const failingTest = loadedTests.find((t) => t.status === 'fail');
      const errorTest = loadedTests.find((t) => t.status === 'error');
      const defaultTest = failingTest || errorTest || loadedTests[0] || null;

      setSelectedTestId(defaultTest ? defaultTest.id : null);
      setSelectedNodeId(null);
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
      setGraphData({ nodes: [], edges: [], unresolvedReferences: [], parseErrors: [] });
      setSelectedTestId(null);
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

  const handleNavigateToEvidenceMap = (testId: string) => {
    setSelectedTestId(testId);
    setActiveView('evidence_map');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-app)',
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

        {/* Workspace Body */}
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
                }}
              >
                {/* Left Test Rail: Search & Status Filters */}
                <TestList
                  tests={tests}
                  selectedTestId={selectedTestId}
                  onSelectTest={(testId) => setSelectedTestId(testId)}
                />

                {/* Main Content Area */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                    overflow: 'hidden',
                    backgroundColor: 'var(--bg-app)',
                  }}
                >
                  {activeView === 'investigation' && (
                    <TestDetailsPane
                      test={tests.find((t) => t.id === selectedTestId) || null}
                      allNodes={graphData.nodes}
                      onNavigateToEvidenceMap={handleNavigateToEvidenceMap}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={setSelectedNodeId}
                    />
                  )}

                  {activeView === 'evidence_map' && (
                    <GraphView
                      graphData={graphData}
                      tests={tests}
                      selectedTestId={selectedTestId}
                      onSelectTest={setSelectedTestId}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={setSelectedNodeId}
                      runStatus={activeRun?.status}
                      errorMessage={activeRun?.errorMessage}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
