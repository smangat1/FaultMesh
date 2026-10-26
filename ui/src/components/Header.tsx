import React from 'react';
import type { RunSummary } from '../types';
import {
  Activity,
  Layers,
  GitBranch,
  Sun,
  Moon,
  Clock,
  AlertTriangle,
} from 'lucide-react';

interface HeaderProps {
  runs: RunSummary[];
  activeRun: RunSummary | null;
  onSelectRun: (runId: string) => void;
  activeTab: 'runs' | 'tests' | 'graph';
  onSelectTab: (tab: 'runs' | 'tests' | 'graph') => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  selectedTestCount?: number;
  failedTestCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  runs,
  activeRun,
  onSelectRun,
  activeTab,
  onSelectTab,
  theme,
  onToggleTheme,
  failedTestCount = 0,
}) => {
  return (
    <header style={{ borderBottom: '1px solid var(--border-color)' }}>
      {/* Required Visible Fixture Banner */}
      {activeRun?.isFixture && (
        <div className="fixture-banner" role="banner" aria-label="Fixture Notice">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} />
            <span>{activeRun.fixtureLabel}</span>
          </div>
          <span className="badge">Read-only offline preview</span>
        </div>
      )}

      {/* Main Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        {/* Brand & Active Run Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                backgroundColor: 'var(--accent)',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '13px',
              }}
            >
              FM
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.01em' }}>
                FaultMesh
              </div>
            </div>
            <span
              style={{
                fontSize: '10px',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '2px 6px',
                borderRadius: '3px',
                color: 'var(--text-muted)',
              }}
            >
              prototype
            </span>
          </div>

          {/* Run Switcher Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Run:</span>
            <select
              value={activeRun?.id || ''}
              onChange={(e) => onSelectRun(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
              }}
              aria-label="Select Run"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.project} ({r.gitBranch} @ {r.gitRevision}) [{r.status.toUpperCase()}]
                </option>
              ))}
            </select>
          </div>

          {activeRun && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <GitBranch size={12} /> {activeRun.gitBranch} ({activeRun.gitRevision})
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} /> {activeRun.durationMs}ms
              </span>
            </div>
          )}
        </div>

        {/* View Navigation & Theme Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <nav
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '4px',
              padding: '2px',
              border: '1px solid var(--border-color)',
            }}
          >
            <button
              onClick={() => onSelectTab('runs')}
              className={`btn btn-sm ${activeTab === 'runs' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '3px' }}
            >
              <Activity size={13} />
              Run Overview
            </button>
            <button
              onClick={() => onSelectTab('tests')}
              className={`btn btn-sm ${activeTab === 'tests' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '3px', position: 'relative' }}
            >
              Tests
              {failedTestCount > 0 && (
                <span
                  style={{
                    backgroundColor: 'var(--status-fail)',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '0 5px',
                    fontSize: '9px',
                    fontWeight: 700,
                  }}
                >
                  {failedTestCount}
                </span>
              )}
            </button>
            <button
              onClick={() => onSelectTab('graph')}
              className={`btn btn-sm ${activeTab === 'graph' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: '3px' }}
            >
              <Layers size={13} />
              Execution Graph
            </button>
          </nav>

          <button
            onClick={onToggleTheme}
            className="btn btn-sm btn-ghost"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
    </header>
  );
};
