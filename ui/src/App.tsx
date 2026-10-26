import React, { useState, useEffect } from 'react';
import type { FaultMeshAdapter } from './adapter';
import { FixtureAdapter } from './adapter';
import type { RunSummary, TestItem, GraphData } from './types';
import { Header } from './components/Header';
import { RunsScreen } from './components/RunsScreen';
import { TestList } from './components/TestList';
import { GraphView } from './components/GraphView';
import './styles/theme.css';

interface AppProps {
  adapter?: FaultMeshAdapter;
}

export const App: React.FC<AppProps> = ({ adapter = new FixtureAdapter(10) }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeTab, setActiveTab] = useState<'runs' | 'tests' | 'graph'>('runs');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>('run-auth-regression');
  const [tests, setTests] = useState<TestItem[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    edges: [],
    unresolvedReferences: [],
    parseErrors: [],
  });
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Sync theme attribute to HTML root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  };

  // Initial runs load
  useEffect(() => {
    let isMounted = true;
    adapter.getRuns().then((loadedRuns) => {
      if (!isMounted) return;
      setRuns(loadedRuns);
      if (loadedRuns.length > 0 && !activeRunId) {
        setActiveRunId(loadedRuns[0].id);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [adapter]);

  // Load active run data
  useEffect(() => {
    if (!activeRunId) return;
    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      adapter.getTests(activeRunId),
      adapter.getGraph(activeRunId),
    ]).then(([loadedTests, loadedGraph]) => {
      if (!isMounted) return;
      setTests(loadedTests);
      setGraphData(loadedGraph);

      // Default select the failing test if available
      const failingTest = loadedTests.find((t) => t.status === 'fail');
      if (failingTest) {
        setSelectedTestId(failingTest.id);
      } else if (loadedTests.length > 0) {
        setSelectedTestId(loadedTests[0].id);
      } else {
        setSelectedTestId(null);
      }
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [adapter, activeRunId]);

  const activeRun = runs.find((r) => r.id === activeRunId) || null;
  const failedTestCount = tests.filter((t) => t.status === 'fail' || t.status === 'error').length;

  const handleNavigateToGraphWithTest = (testId: string) => {
    setSelectedTestId(testId);
    setActiveTab('graph');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <Header
        runs={runs}
        activeRun={activeRun}
        onSelectRun={(runId) => {
          setActiveRunId(runId);
        }}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        failedTestCount={failedTestCount}
      />

      <main style={{ flex: 1, position: 'relative' }}>
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '400px',
              color: 'var(--text-muted)',
              fontSize: '13px',
              gap: '10px',
            }}
          >
            <span>Loading run artifacts...</span>
          </div>
        ) : (
          <>
            {activeTab === 'runs' && (
              <RunsScreen
                runs={runs}
                activeRun={activeRun}
                graphData={graphData}
                onSelectRun={(runId) => setActiveRunId(runId)}
                onNavigateToTests={() => setActiveTab('tests')}
                onNavigateToGraph={() => setActiveTab('graph')}
              />
            )}

            {activeTab === 'tests' && (
              <TestList
                tests={tests}
                allNodes={graphData.nodes}
                selectedTestId={selectedTestId}
                onSelectTest={(testId) => setSelectedTestId(testId)}
                onNavigateToGraphWithTest={handleNavigateToGraphWithTest}
              />
            )}

            {activeTab === 'graph' && (
              <GraphView
                graphData={graphData}
                tests={tests}
                selectedTestId={selectedTestId}
                onSelectTest={(testId) => setSelectedTestId(testId)}
                theme={theme}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
};
