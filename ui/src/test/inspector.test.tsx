import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorDrawer } from '../components/InspectorDrawer';
import { FIXTURE_TESTS, FIXTURE_GRAPH } from '../fixtures';

describe('InspectorDrawer Component', () => {
  const tests = FIXTURE_TESTS['run-auth-regression'];
  const graph = FIXTURE_GRAPH['run-auth-regression'];

  it('renders symbol inspector with grounded description labeled "Sample description"', () => {
    const node = graph.nodes.find((n) => n.id === 'auth/tokens.py::validate_token')!;
    const onClose = vi.fn();
    const onPinSymbol = vi.fn();

    render(
      <InspectorDrawer
        selectedNodeId={node.id}
        onSelectNode={vi.fn()}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        selectedFile={null}
        onSelectFile={vi.fn()}
        nodes={graph.nodes}
        edges={graph.edges}
        tests={tests}
        files={graph.files}
        pinnedSymbols={[]}
        onPinSymbol={onPinSymbol}
        onClose={onClose}
      />
    );

    // 1. Identity
    expect(screen.getByText('validate_token')).toBeDefined();
    expect(screen.getByText(/auth\/tokens\.py:43-59/i)).toBeDefined();
    expect(screen.getAllByText(/modified/i).length).toBeGreaterThan(0);

    // 2. What it does (Role explanation)
    expect(screen.getByText(/Sample description/i)).toBeDefined();
    expect(screen.getByText(node.description!)).toBeDefined();

    // 3. Source Viewer & Diff tabs
    expect(screen.getByText(/Unified Diff/i)).toBeDefined();
    expect(screen.getByText(/Source Code/i)).toBeDefined();

    // 4. Pin button
    const pinBtn = screen.getByRole('button', { name: /Pin validate_token/i });
    fireEvent.click(pinBtn);
    expect(onPinSymbol).toHaveBeenCalled();

    // 5. Close button
    const closeBtn = screen.getByLabelText(/Close inspector/i);
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders test inspector with promoted failure message and traceback', () => {
    const failingTest = tests.find((t) => t.status === 'fail')!;

    render(
      <InspectorDrawer
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        selectedTestId={failingTest.id}
        onSelectTest={vi.fn()}
        selectedFile={null}
        onSelectFile={vi.fn()}
        nodes={graph.nodes}
        edges={graph.edges}
        tests={tests}
        files={graph.files}
        pinnedSymbols={[]}
        onClose={vi.fn()}
      />
    );

    // Promoted failure
    expect(screen.getByText(/Failure Message/i)).toBeDefined();
    expect(screen.getAllByText(/InvalidClaimError/i).length).toBeGreaterThan(0);

    // Traceback
    expect(screen.getByText(/Python Traceback/i)).toBeDefined();

    // Recorded replay comparison
    expect(screen.getByText(/Recorded Replay Comparison/i)).toBeDefined();
    expect(screen.getAllByText(/FP-AUTH-TOK-52/i).length).toBeGreaterThan(0);
  });

  it('renders file inspector with symbol list and touching tests', () => {
    render(
      <InspectorDrawer
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        selectedFile="auth/tokens.py"
        onSelectFile={vi.fn()}
        nodes={graph.nodes}
        edges={graph.edges}
        tests={tests}
        files={graph.files}
        pinnedSymbols={[]}
        onClose={vi.fn()}
      />
    );

    // File name and cluster info
    expect(screen.getByText('tokens.py')).toBeDefined();
    expect(screen.getByText(/Symbols in File \(10\)/i)).toBeDefined();
    expect(screen.getByText(/Tests Touching This File/i)).toBeDefined();
  });

  it('dismisses when Escape key is pressed', () => {
    const onClose = vi.fn();

    render(
      <InspectorDrawer
        selectedNodeId="auth/tokens.py::validate_token"
        onSelectNode={vi.fn()}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        selectedFile={null}
        onSelectFile={vi.fn()}
        nodes={graph.nodes}
        edges={graph.edges}
        tests={tests}
        files={graph.files}
        pinnedSymbols={[]}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
