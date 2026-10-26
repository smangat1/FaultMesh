import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../components/Sidebar';
import { FIXTURE_TESTS, FIXTURE_GRAPH } from '../fixtures';
import type { PinnedSymbol } from '../types';

describe('Sidebar Component (Zotero-like Layout)', () => {
  const tests = FIXTURE_TESTS['run-auth-regression'];
  const graph = FIXTURE_GRAPH['run-auth-regression'];

  it('renders all 3 sections: Tests, Pinned Shortlist, and Files', () => {
    render(
      <Sidebar
        tests={tests}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        files={graph.files}
        nodes={graph.nodes}
        pinnedSymbols={[]}
      />
    );

    // Tests header
    expect(screen.getByText(/Tests \(6\)/i)).toBeDefined();
    // Shortlist header
    expect(screen.getByText(/Pinned Shortlist \(0\)/i)).toBeDefined();
    // Files header
    expect(screen.getByText(/Files \(8\)/i)).toBeDefined();

    // Empty shortlist state message
    expect(
      screen.getByText(/No pinned symbols\. Pin functions from the map or inspector/i)
    ).toBeDefined();
  });

  it('supports search and keyboard navigation', () => {
    const onSelectNode = vi.fn();
    const onToggleCollapseFile = vi.fn();

    render(
      <Sidebar
        tests={tests}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        files={graph.files}
        nodes={graph.nodes}
        pinnedSymbols={[]}
        collapsedFiles={new Set(['auth/tokens.py'])}
        onToggleCollapseFile={onToggleCollapseFile}
        onSelectNode={onSelectNode}
      />
    );

    const input = screen.getByPlaceholderText(/Filter tests by name or file/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'validate_token' } });

    // validate_token should appear in dropdown
    const resultItem = screen.getByText('validate_token');
    expect(resultItem).toBeDefined();

    // Press Enter to select
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should have expanded collapsed cluster and selected symbol
    expect(onToggleCollapseFile).toHaveBeenCalledWith('auth/tokens.py');
    expect(onSelectNode).toHaveBeenCalledWith('auth/tokens.py::validate_token');
  });

  it('displays pinned items with stable IDs and shows "not in test" indicator', () => {
    const onUnpinSymbol = vi.fn();
    const pinned: PinnedSymbol[] = [
      {
        id: 'auth/tokens.py::validate_token',
        name: 'validate_token',
        file: 'auth/tokens.py',
        kind: 'function',
        changeStatus: 'modified',
      },
      {
        id: 'auth/limiter.py::RedisRateLimiter.check',
        name: 'check',
        file: 'auth/limiter.py',
        kind: 'method',
        changeStatus: 'unchanged',
      },
    ];

    // Select failing test (which exercises validate_token, but NOT RedisRateLimiter.check)
    const failingTest = tests.find((t) => t.status === 'fail')!;

    render(
      <Sidebar
        tests={tests}
        selectedTestId={failingTest.id}
        onSelectTest={vi.fn()}
        files={graph.files}
        nodes={graph.nodes}
        pinnedSymbols={pinned}
        onUnpinSymbol={onUnpinSymbol}
      />
    );

    expect(screen.getByText('validate_token')).toBeDefined();
    expect(screen.getByText('check')).toBeDefined();

    // "not in test" badge should appear for RedisRateLimiter.check
    expect(screen.getByText('not in test')).toBeDefined();

    // Clicking unpin button
    const unpinBtn = screen.getByLabelText('Unpin check');
    fireEvent.click(unpinBtn);
    expect(onUnpinSymbol).toHaveBeenCalledWith('auth/limiter.py::RedisRateLimiter.check');
  });

  it('toggles file collapse and file selection from files section', () => {
    const onToggleCollapseFile = vi.fn();
    const onSelectFile = vi.fn();

    render(
      <Sidebar
        tests={tests}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        files={graph.files}
        nodes={graph.nodes}
        onToggleCollapseFile={onToggleCollapseFile}
        onSelectFile={onSelectFile}
      />
    );

    // Click file row
    const fileRow = screen.getByText('tokens.py');
    fireEvent.click(fileRow);
    expect(onSelectFile).toHaveBeenCalledWith('auth/tokens.py');

    // Click collapse chevron button
    const collapseBtn = screen.getByLabelText('Collapse tokens.py');
    fireEvent.click(collapseBtn);
    expect(onToggleCollapseFile).toHaveBeenCalledWith('auth/tokens.py');
  });

  it('supports collapsible sidebar rail toggle to maximize canvas area', () => {
    render(
      <Sidebar
        tests={tests}
        selectedTestId={null}
        onSelectTest={vi.fn()}
        files={graph.files}
        nodes={graph.nodes}
      />
    );

    // Initial state: collapse button present
    const collapseBtn = screen.getByLabelText('Collapse sidebar');
    expect(collapseBtn).toBeDefined();

    // Click collapse button
    fireEvent.click(collapseBtn);

    // Sidebar rail should show expand button
    const expandBtn = screen.getByLabelText('Expand sidebar');
    expect(expandBtn).toBeDefined();

    // Click expand button to restore
    fireEvent.click(expandBtn);
    expect(screen.getByLabelText('Collapse sidebar')).toBeDefined();
  });
});
