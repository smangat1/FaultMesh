import React, { useState, useMemo } from 'react';
import type { TestItem, CodeNode, TestStatus } from '../types';
import { TestDetailsPane } from './TestDetailsPane';
import {
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  SkipForward,
  Clock,
  Code2,
} from 'lucide-react';

interface TestListProps {
  tests: TestItem[];
  allNodes: CodeNode[];
  selectedTestId: string | null;
  onSelectTest: (testId: string) => void;
  onNavigateToGraphWithTest?: (testId: string) => void;
}

export const TestList: React.FC<TestListProps> = ({
  tests,
  allNodes,
  selectedTestId,
  onSelectTest,
  onNavigateToGraphWithTest,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TestStatus>('all');

  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.file.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' ? true : t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tests, searchQuery, statusFilter]);

  const selectedTest = useMemo(() => {
    return tests.find((t) => t.id === selectedTestId) || null;
  }, [tests, selectedTestId]);

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
        display: 'grid',
        gridTemplateColumns: '420px 1fr',
        height: 'calc(100vh - 85px)',
        overflow: 'hidden',
      }}
    >
      {/* Left Column: Filter & List */}
      <div
        style={{
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-primary)',
          height: '100%',
        }}
      >
        {/* Search & Status Filter Bar */}
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '9px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Filter tests by name or file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '6px 10px 6px 30px',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
              }}
              aria-label="Filter tests"
            />
          </div>

          {/* Status Filter Chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStatusFilter('all')}
              className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '2px 8px' }}
            >
              All ({counts.all})
            </button>
            <button
              onClick={() => setStatusFilter('fail')}
              className={`btn btn-sm ${statusFilter === 'fail' ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                color: statusFilter === 'fail' ? '#fff' : 'var(--status-fail)',
              }}
            >
              Failing ({counts.fail})
            </button>
            <button
              onClick={() => setStatusFilter('error')}
              className={`btn btn-sm ${statusFilter === 'error' ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                color: statusFilter === 'error' ? '#fff' : 'var(--status-error)',
              }}
            >
              Errors ({counts.error})
            </button>
            <button
              onClick={() => setStatusFilter('pass')}
              className={`btn btn-sm ${statusFilter === 'pass' ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                color: statusFilter === 'pass' ? '#fff' : 'var(--status-pass)',
              }}
            >
              Passed ({counts.pass})
            </button>
            <button
              onClick={() => setStatusFilter('skipped')}
              className={`btn btn-sm ${statusFilter === 'skipped' ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                color: statusFilter === 'skipped' ? '#fff' : 'var(--status-skipped)',
              }}
            >
              Skipped ({counts.skipped})
            </button>
          </div>
        </div>

        {/* Test Items List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredTests.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '12px',
              }}
            >
              <Filter size={24} style={{ opacity: 0.4, marginBottom: '8px' }} />
              <div>No matching tests found.</div>
            </div>
          ) : (
            filteredTests.map((t) => {
              const isSelected = t.id === selectedTestId;
              const hasReruns = t.rerunHistory && t.rerunHistory.length > 0;
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTest(t.id)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    backgroundColor: isSelected
                      ? 'var(--bg-tertiary)'
                      : 'transparent',
                    borderLeft: isSelected
                      ? '3px solid var(--accent)'
                      : '3px solid transparent',
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`badge-status ${t.status}`}>
                        {t.status === 'pass' && <CheckCircle2 size={11} />}
                        {t.status === 'fail' && <XCircle size={11} />}
                        {t.status === 'error' && <AlertOctagon size={11} />}
                        {t.status === 'skipped' && <SkipForward size={11} />}
                        {t.status}
                      </span>
                      {hasReruns && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            color: 'var(--accent)',
                            backgroundColor: 'rgba(56, 189, 248, 0.15)',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t.rerunHistory.length}x rerun
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        <Clock size={10} /> {t.durationMs}ms
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: isSelected
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t.name}
                  </div>

                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      marginTop: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{t.file}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <Code2 size={11} /> {t.exercisedNodeIds.length} nodes
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Selected Test Details */}
      <div style={{ height: '100%', overflow: 'hidden' }}>
        <TestDetailsPane
          test={selectedTest}
          allNodes={allNodes}
          onNavigateToGraphWithTest={onNavigateToGraphWithTest}
        />
      </div>
    </div>
  );
};
