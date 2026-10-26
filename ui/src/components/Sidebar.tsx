import React, { useState, useMemo, useRef } from 'react';
import type { TestItem, FileCluster, CodeNode, PinnedSymbol, TestStatus } from '../types';
import {
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  Pin,
  PinOff,
  FileCode,
  Folder,
  X,
} from 'lucide-react';

export interface SidebarProps {
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest: (testId: string | null) => void;
  files?: FileCluster[];
  selectedFile?: string | null;
  onSelectFile?: (file: string | null) => void;
  collapsedFiles?: Set<string>;
  onToggleCollapseFile?: (file: string) => void;
  onCollapseAllFiles?: () => void;
  onExpandAllFiles?: () => void;
  nodes?: CodeNode[];
  pinnedSymbols?: PinnedSymbol[];
  onPinSymbol?: (symbol: PinnedSymbol) => void;
  onUnpinSymbol?: (symbolId: string) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  viewMode?: 'structure' | 'changes' | 'tests' | 'investigation';
}

export const Sidebar: React.FC<SidebarProps> = ({
  tests,
  selectedTestId,
  onSelectTest,
  files = [],
  selectedFile,
  onSelectFile,
  collapsedFiles = new Set(),
  onToggleCollapseFile,
  onCollapseAllFiles,
  onExpandAllFiles,
  nodes = [],
  pinnedSymbols = [],
  onUnpinSymbol,
  selectedNodeId,
  onSelectNode,
  viewMode = 'structure',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TestStatus>('all');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeTest = useMemo(() => {
    return tests.find((t) => t.id === selectedTestId) || null;
  }, [tests, selectedTestId]);

  // Compute file clusters if not explicitly passed
  const fileClusters = useMemo(() => {
    if (files.length > 0) return files;
    const map = new Map<string, { count: number; changeStatus: CodeNode['changeStatus'] }>();
    nodes.forEach((n) => {
      const existing = map.get(n.file) || { count: 0, changeStatus: 'unchanged' };
      existing.count += 1;
      if (n.changeStatus === 'modified') existing.changeStatus = 'modified';
      else if (n.changeStatus === 'added' && existing.changeStatus !== 'modified') {
        existing.changeStatus = 'added';
      }
      map.set(n.file, existing);
    });
    return Array.from(map.entries()).map(([file, info]) => ({
      file,
      name: file.split('/').pop() || file,
      symbolCount: info.count,
      changeStatus: info.changeStatus,
      lineCount: 100,
    }));
  }, [files, nodes]);

  // Unified Search Results matching symbols, files, and tests
  interface SearchResultItem {
    type: 'symbol' | 'file' | 'test';
    id: string;
    title: string;
    subtitle: string;
    file?: string;
  }

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResultItem[] = [];

    // Match symbols
    nodes.forEach((n) => {
      if (n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        results.push({
          type: 'symbol',
          id: n.id,
          title: n.name,
          subtitle: `${n.kind} in ${n.file}`,
          file: n.file,
        });
      }
    });

    // Match files
    fileClusters.forEach((f) => {
      if (f.name.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)) {
        results.push({
          type: 'file',
          id: f.file,
          title: f.name,
          subtitle: `${f.symbolCount} symbols • ${f.file}`,
          file: f.file,
        });
      }
    });

    // Match tests
    tests.forEach((t) => {
      if (t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)) {
        results.push({
          type: 'test',
          id: t.id,
          title: t.name,
          subtitle: `Test • ${t.status}`,
          file: t.file,
        });
      }
    });

    return results.slice(0, 15);
  }, [searchQuery, nodes, fileClusters, tests]);

  // Handle Search Keyboard Navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSearchIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSearchIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = searchResults[activeSearchIndex];
      if (item) {
        selectSearchResult(item);
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setIsSearchFocused(false);
      searchInputRef.current?.blur();
    }
  };

  const selectSearchResult = (item: SearchResultItem) => {
    if (item.type === 'symbol') {
      // If parent cluster is collapsed, expand it
      if (item.file && collapsedFiles.has(item.file) && onToggleCollapseFile) {
        onToggleCollapseFile(item.file);
      }
      onSelectNode?.(item.id);
    } else if (item.type === 'file') {
      onSelectFile?.(item.id);
    } else if (item.type === 'test') {
      onSelectTest(item.id);
    }
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  // Filtered Tests for Tests Section
  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const q = searchQuery.toLowerCase();
      // If searching, only filter within tests section if query matches
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.file.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' ? true : t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tests, searchQuery, statusFilter]);

  const testCounts = useMemo(() => {
    return {
      all: tests.length,
      fail: tests.filter((t) => t.status === 'fail').length,
      error: tests.filter((t) => t.status === 'error').length,
      pass: tests.filter((t) => t.status === 'pass').length,
      skipped: tests.filter((t) => t.status === 'skipped').length,
    };
  }, [tests]);

  if (isCollapsed) {
    return (
      <div
        style={{
          width: '36px',
          height: '100%',
          backgroundColor: '#111722',
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '10px',
          gap: '12px',
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setIsCollapsed(false)}
          className="btn-ghost"
          style={{ padding: '6px', color: 'var(--text-secondary)' }}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }

  const renderTestsSection = () => (
    <section style={{ borderBottom: '1px solid var(--border-default)' }}>
      <div
        style={{
          padding: '8px 12px 6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#131b28',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--text-secondary)',
          }}
        >
          Tests ({tests.length})
        </span>

        {selectedTestId && (
          <button
            onClick={() => onSelectTest(null)}
            className="btn-ghost btn-sm"
            style={{ fontSize: '10px', padding: '1px 6px', color: '#38bdf8' }}
            title="Clear test highlight"
            aria-label="Clear test highlight"
          >
            Clear
          </button>
        )}
      </div>

      {/* Test Status Filter Pills */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 12px 8px 12px',
          backgroundColor: '#131b28',
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => setStatusFilter('all')}
          className={`pill-filter ${statusFilter === 'all' ? 'active' : ''}`}
        >
          All {testCounts.all}
        </button>
        {testCounts.fail > 0 && (
          <button
            onClick={() => setStatusFilter('fail')}
            className={`pill-filter ${statusFilter === 'fail' ? 'active fail' : ''}`}
          >
            Failing {testCounts.fail}
          </button>
        )}
        {testCounts.error > 0 && (
          <button
            onClick={() => setStatusFilter('error')}
            className={`pill-filter ${statusFilter === 'error' ? 'active error' : ''}`}
          >
            Error {testCounts.error}
          </button>
        )}
        {testCounts.pass > 0 && (
          <button
            onClick={() => setStatusFilter('pass')}
            className={`pill-filter ${statusFilter === 'pass' ? 'active pass' : ''}`}
          >
            Passed {testCounts.pass}
          </button>
        )}
      </div>

      {/* Tests List */}
      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        {filteredTests.length === 0 ? (
          <div style={{ padding: '12px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
            No tests match filter.
          </div>
        ) : (
          filteredTests.map((test) => {
            const isSelected = test.id === selectedTestId;
            return (
              <button
                key={test.id}
                onClick={() => onSelectTest(isSelected ? null : test.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 12px',
                  backgroundColor: isSelected ? '#1e293b' : 'transparent',
                  border: 'none',
                  borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  gap: '8px',
                  outline: 'none',
                }}
                title={test.id}
                aria-label={`Test ${test.name}: ${test.status}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor:
                        test.status === 'fail'
                          ? 'var(--status-fail)'
                          : test.status === 'error'
                          ? 'var(--status-error)'
                          : test.status === 'pass'
                          ? 'var(--status-pass)'
                          : 'var(--status-skip)',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? '#f8fafc' : 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {test.name}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {test.durationMs}ms
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );

  const renderShortlistSection = () => (
    <section style={{ borderBottom: '1px solid var(--border-default)' }}>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#131b28',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Pin size={11} style={{ color: 'var(--text-secondary)' }} />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
            }}
          >
            Pinned Shortlist ({pinnedSymbols.length})
          </span>
        </div>
      </div>

      <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
        {pinnedSymbols.length === 0 ? (
          <div
            style={{
              padding: '10px 12px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              lineHeight: '1.4',
            }}
          >
            No pinned symbols. Pin functions from the map or inspector to build an investigation shortlist.
          </div>
        ) : (
          pinnedSymbols.map((sym) => {
            const isSelected = sym.id === selectedNodeId;
            const isExercisedInActiveTest =
              !activeTest || activeTest.exercisedNodeIds.includes(sym.id);

            return (
              <div
                key={sym.id}
                onClick={() => onSelectNode?.(sym.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '5px 12px',
                  backgroundColor: isSelected ? '#1e293b' : 'transparent',
                  borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                  cursor: 'pointer',
                  gap: '8px',
                }}
                title={sym.id}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      backgroundColor: '#1e293b',
                      color: '#94a3b8',
                      flexShrink: 0,
                      textTransform: 'uppercase',
                    }}
                  >
                    {sym.kind.substring(0, 2)}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: isSelected ? '#ffffff' : 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {sym.name}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {!isExercisedInActiveTest && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '2px',
                        backgroundColor: '#1f2937',
                        color: '#94a3b8',
                      }}
                      title="Symbol was not exercised in currently selected test"
                    >
                      not in test
                    </span>
                  )}
                  {onUnpinSymbol && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnpinSymbol(sym.id);
                      }}
                      className="btn-ghost"
                      style={{ padding: '2px', color: 'var(--text-muted)' }}
                      title="Remove from shortlist"
                      aria-label={`Unpin ${sym.name}`}
                    >
                      <PinOff size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );

  const renderFilesSection = () => (
    <section style={{ flex: 1 }}>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#131b28',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Folder size={11} style={{ color: 'var(--text-secondary)' }} />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
            }}
          >
            Files ({fileClusters.length})
          </span>
        </div>

        {onCollapseAllFiles && onExpandAllFiles && (
          <button
            onClick={() => {
              if (collapsedFiles.size === 0) {
                onCollapseAllFiles();
              } else {
                onExpandAllFiles();
              }
            }}
            className="btn-ghost btn-sm"
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              color: 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              cursor: 'pointer',
            }}
            title={
              collapsedFiles.size === 0
                ? 'Fold all files into overview dots'
                : 'Unfold all files into symbols'
            }
          >
            <ChevronsUpDown size={10} />
            <span>{collapsedFiles.size === 0 ? 'Fold All' : 'Unfold All'}</span>
          </button>
        )}
      </div>

      <div style={{ overflowY: 'auto' }}>
        {fileClusters.map((f) => {
          const isSelected = f.file === selectedFile;
          const isCollapsed = collapsedFiles.has(f.file);

          return (
            <div
              key={f.file}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 12px',
                backgroundColor: isSelected ? '#1e293b' : 'transparent',
                borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                cursor: 'pointer',
                gap: '6px',
              }}
              onClick={() => onSelectFile?.(f.file)}
              title={f.file}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapseFile?.(f.file);
                  }}
                  className="btn-ghost"
                  style={{ padding: '2px', color: 'var(--text-muted)', flexShrink: 0 }}
                  title={isCollapsed ? 'Expand cluster' : 'Collapse cluster'}
                  aria-label={isCollapsed ? `Expand ${f.name}` : `Collapse ${f.name}`}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>

                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: isSelected ? '#ffffff' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.name}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {f.changeStatus === 'modified' && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--change-modified)',
                    }}
                    title="Modified file"
                  />
                )}
                {f.changeStatus === 'added' && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--change-added)',
                    }}
                    title="Added file"
                  />
                )}
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {f.symbolCount}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <nav
      aria-label="Repository Navigation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#111722',
        borderRight: '1px solid var(--border-default)',
        minWidth: '240px',
        maxWidth: '300px',
        width: '260px',
        flexShrink: 0,
        userSelect: 'none',
        position: 'relative',
        zIndex: 20,
      }}
    >
      {/* Top Search Box with live dropdown and collapse toggle */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: '#161f2e',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          position: 'relative',
        }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={13}
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Filter tests by name or file, or search symbols..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setActiveSearchIndex(0);
            }}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              backgroundColor: '#0d1117',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 22px 5px 26px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            aria-label="Filter tests, symbols and files"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setIsSearchFocused(false);
              }}
              className="btn-ghost"
              style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '2px',
                color: 'var(--text-muted)',
              }}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <button
          onClick={() => setIsCollapsed(true)}
          className="btn-ghost"
          style={{ padding: '4px', color: 'var(--text-muted)', flexShrink: 0 }}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft size={13} />
        </button>

        {/* Search Results Dropdown Overlay */}
        {isSearchFocused && searchResults.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: '#161f2e',
              border: '1px solid var(--border-default)',
              borderTop: 'none',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 100,
              maxHeight: '320px',
              overflowY: 'auto',
            }}
          >
            {searchResults.map((item, idx) => {
              const isSelected = idx === activeSearchIndex;
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSearchResult(item);
                  }}
                  onMouseEnter={() => setActiveSearchIndex(idx)}
                  style={{
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    backgroundColor: isSelected ? '#1e293b' : 'transparent',
                    cursor: 'pointer',
                    borderBottom: '1px solid #1f2937',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    {item.type === 'file' ? (
                      <Folder size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    ) : item.type === 'symbol' ? (
                      <FileCode size={12} style={{ color: '#a78bfa', flexShrink: 0 }} />
                    ) : (
                      <CheckCircle2 size={12} style={{ color: '#34d399', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#f1f5f9',
                          fontFamily: item.type === 'symbol' ? 'var(--font-mono)' : 'inherit',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#94a3b8',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '9px',
                      textTransform: 'uppercase',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      backgroundColor: '#0f172a',
                      color: '#94a3b8',
                      flexShrink: 0,
                    }}
                  >
                    {item.type}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable Container with Contextual Section Ordering */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'structure' || viewMode === 'changes' ? (
          <>
            {renderFilesSection()}
            {renderShortlistSection()}
            {renderTestsSection()}
          </>
        ) : (
          <>
            {renderTestsSection()}
            {renderShortlistSection()}
            {renderFilesSection()}
          </>
        )}
      </div>
    </nav>
  );
};

// Backwards-compatible export for existing test suites
export const TestList: React.FC<{
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest: (testId: string) => void;
}> = ({ tests, selectedTestId, onSelectTest }) => {
  return (
    <Sidebar
      tests={tests}
      selectedTestId={selectedTestId}
      onSelectTest={(id) => onSelectTest(id || '')}
    />
  );
};
