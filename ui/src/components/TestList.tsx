import React, { useState, useMemo } from 'react';
import type { TestItem, TestStatus } from '../types';
import {
  Search,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  SkipForward,
  Clock,
  X,
  Code2,
} from 'lucide-react';

interface TestListProps {
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest: (testId: string) => void;
}

export const TestList: React.FC<TestListProps> = ({
  tests,
  selectedTestId,
  onSelectTest,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TestStatus>('all');

  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.file.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true : t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tests, searchQuery, statusFilter]);

  const counts = useMemo(() => {
    return {
      all: tests.length,
      fail: tests.filter((t) => t.status === 'fail').length,
      error: tests.filter((t) => t.status === 'error').length,
      pass: tests.filter((t) => t.status === 'pass').length,
      skipped: tests.filter((t) => t.status === 'skipped').length,
    };
  }, [tests]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-default)',
        minWidth: '280px',
        maxWidth: '340px',
        width: '300px',
        flexShrink: 0,
      }}
    >
      {/* Search & Filter Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        {/* Search input */}
        <div style={{ position: 'relative' }}>
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
            type="text"
            placeholder="Filter tests by name or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 24px 5px 26px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            aria-label="Filter tests"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
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

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setStatusFilter('all')}
            className={statusFilter === 'all' ? 'btn-secondary' : 'btn-ghost'}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              backgroundColor: statusFilter === 'all' ? 'var(--bg-active)' : 'transparent',
            }}
          >
            All ({counts.all})
          </button>
          {counts.fail > 0 && (
            <button
              onClick={() => setStatusFilter('fail')}
              className={statusFilter === 'fail' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                color: 'var(--status-fail)',
                backgroundColor: statusFilter === 'fail' ? 'var(--status-fail-bg)' : 'transparent',
              }}
            >
              Failing ({counts.fail})
            </button>
          )}
          {counts.error > 0 && (
            <button
              onClick={() => setStatusFilter('error')}
              className={statusFilter === 'error' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                color: 'var(--status-error)',
                backgroundColor: statusFilter === 'error' ? 'var(--status-error-bg)' : 'transparent',
              }}
            >
              Errors ({counts.error})
            </button>
          )}
          {counts.pass > 0 && (
            <button
              onClick={() => setStatusFilter('pass')}
              className={statusFilter === 'pass' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                color: 'var(--status-pass)',
                backgroundColor: statusFilter === 'pass' ? 'var(--status-pass-bg)' : 'transparent',
              }}
            >
              Passed ({counts.pass})
            </button>
          )}
          {counts.skipped > 0 && (
            <button
              onClick={() => setStatusFilter('skipped')}
              className={statusFilter === 'skipped' ? 'btn-secondary' : 'btn-ghost'}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                color: 'var(--status-skipped)',
                backgroundColor: statusFilter === 'skipped' ? 'var(--status-skipped-bg)' : 'transparent',
              }}
            >
              Skipped ({counts.skipped})
            </button>
          )}
        </div>
      </div>

      {/* Tests List */}
      <div style={{ flex: 1, overflowY: 'auto' }} role="region" aria-label="Tests List">
        {filteredTests.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
            }}
          >
            <div>No matching tests found.</div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="btn-secondary btn-sm"
                style={{ marginTop: '8px' }}
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} role="list">
            {filteredTests.map((t) => {
              const isSelected = t.id === selectedTestId;
              const hasReruns = t.rerunHistory && t.rerunHistory.length > 0;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => onSelectTest(t.id)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      borderBottom: '1px solid var(--border-subtle)',
                      textAlign: 'left',
                      backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                      borderLeft: isSelected
                        ? '3px solid var(--accent)'
                        : '3px solid transparent',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      cursor: 'pointer',
                    }}
                    role="button"
                    aria-selected={isSelected}
                    title={t.id}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`badge-status ${t.status}`}>
                          {t.status === 'pass' && <CheckCircle2 size={11} />}
                          {t.status === 'fail' && <XCircle size={11} />}
                          {t.status === 'error' && <AlertOctagon size={11} />}
                          {t.status === 'skipped' && <SkipForward size={11} />}
                          {t.status.toUpperCase()}
                        </span>
                        {hasReruns && (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 700,
                              color: 'var(--accent)',
                              backgroundColor: 'var(--accent-muted)',
                              padding: '1px 4px',
                              borderRadius: '2px',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {t.rerunHistory.length}x replay
                          </span>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <Clock size={10} /> {t.durationMs}ms
                      </span>
                    </div>

                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.name}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '180px',
                        }}
                      >
                        {t.file}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        <Code2 size={10} /> {t.exercisedNodeIds.length} nodes
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
