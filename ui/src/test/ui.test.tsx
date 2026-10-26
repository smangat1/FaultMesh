import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunsScreen } from '../components/RunsScreen';
import { TestList } from '../components/TestList';
import { TestDetailsPane } from '../components/TestDetailsPane';
import { FIXTURE_RUNS, FIXTURE_TESTS, FIXTURE_GRAPH } from '../fixtures';

describe('RunsScreen Component', () => {
  const activeRun = FIXTURE_RUNS[0];
  const graphData = FIXTURE_GRAPH['run-auth-regression'];

  it('renders run overview, project name, and git branch', () => {
    render(
      <RunsScreen
        runs={FIXTURE_RUNS}
        activeRun={activeRun}
        graphData={graphData}
        onSelectRun={vi.fn()}
        onNavigateToTests={vi.fn()}
        onNavigateToGraph={vi.fn()}
      />
    );

    expect(screen.getAllByText('auth-service').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/feat\/jwt-sessions/i).length).toBeGreaterThan(0);
    expect(screen.getByText('9f3c82d7a1')).toBeDefined();
  });

  it('renders honest causality notice', () => {
    render(
      <RunsScreen
        runs={FIXTURE_RUNS}
        activeRun={activeRun}
        graphData={graphData}
        onSelectRun={vi.fn()}
        onNavigateToTests={vi.fn()}
        onNavigateToGraph={vi.fn()}
      />
    );

    expect(
      screen.getAllByText(/Observed, not proven cause:/i).length
    ).toBeGreaterThan(0);
  });

  it('displays empty scan honest diagnostic state', () => {
    const emptyRun = FIXTURE_RUNS.find((r) => r.status === 'empty')!;
    const emptyGraph = FIXTURE_GRAPH['run-empty-scan'];

    render(
      <RunsScreen
        runs={FIXTURE_RUNS}
        activeRun={emptyRun}
        graphData={emptyGraph}
        onSelectRun={vi.fn()}
        onNavigateToTests={vi.fn()}
        onNavigateToGraph={vi.fn()}
      />
    );

    expect(screen.getAllByText(/Empty Scan State/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/No pytest test cases were detected/i).length
    ).toBeGreaterThan(0);
  });

  it('displays error state with collection failure information', () => {
    const errorRun = FIXTURE_RUNS.find((r) => r.status === 'failed')!;
    const errorGraph = FIXTURE_GRAPH['run-failed-harness'];

    render(
      <RunsScreen
        runs={FIXTURE_RUNS}
        activeRun={errorRun}
        graphData={errorGraph}
        onSelectRun={vi.fn()}
        onNavigateToTests={vi.fn()}
        onNavigateToGraph={vi.fn()}
      />
    );

    expect(
      screen.getAllByText(/Test Runner Error \(Collection Phase\)/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/pytest\.CollectionError/i).length
    ).toBeGreaterThan(0);
  });
});

describe('TestList Component & Filtering', () => {
  const tests = FIXTURE_TESTS['run-auth-regression'];
  const nodes = FIXTURE_GRAPH['run-auth-regression'].nodes;

  it('renders list of tests and filters by status', () => {
    render(
      <TestList
        tests={tests}
        selectedTestId={tests[0].id}
        onSelectTest={vi.fn()}
      />
    );

    expect(screen.getAllByText('test_login_expired_token').length).toBeGreaterThan(0);
    expect(screen.getAllByText('test_login_valid_token').length).toBeGreaterThan(0);

    // Click Failing filter
    const failButton = screen.getByRole('button', { name: /Failing/i });
    fireEvent.click(failButton);

    // Failing test should remain visible
    expect(screen.getAllByText('test_login_expired_token').length).toBeGreaterThan(0);
    // Passing test should be filtered out
    expect(screen.queryByText('test_login_valid_token')).toBeNull();
  });

  it('filters tests by text search query', () => {
    render(
      <TestList
        tests={tests}
        selectedTestId={tests[0].id}
        onSelectTest={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Filter tests by name/i);
    fireEvent.change(searchInput, { target: { value: 'expired' } });

    expect(screen.getAllByText('test_login_expired_token').length).toBeGreaterThan(0);
    expect(screen.queryByText('test_session_create')).toBeNull();
  });

  it('displays traceback and rerun history for failing test', () => {
    render(
      <TestDetailsPane
        test={tests[0]}
        allNodes={nodes}
      />
    );

    expect(screen.getAllByText(/Failure Message/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Python Traceback/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recorded Replay Comparison/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FP-AUTH-TOK-52/i).length).toBeGreaterThan(0);
  });
});
