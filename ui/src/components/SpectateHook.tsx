import React, { useEffect, useRef, useState } from 'react';
import { Eye, FolderOpen, Square, X } from 'lucide-react';
import type { LineRange, ProjectChoice, SpectateEvent } from '../spectate/types';
import '../styles/spectate.css';

interface FileChangeView {
  path: string;
  sha256: string | null;
  ranges: LineRange[];
  parseError: string | null;
  affectedNodeIds: string[];
  updatedAt: string;
}

interface TextView {
  path: string;
  text: string | null;
  skippedReason: string | null;
  truncated?: boolean;
}

const shortHash = (value: string | null): string => (value ? value.slice(0, 10) : 'deleted');

export const SpectateHook: React.FC = () => {
  const bridge = window.faultmeshSpectate;
  const [project, setProject] = useState<ProjectChoice | null>(null);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [change, setChange] = useState<FileChangeView | null>(null);
  const [source, setSource] = useState<TextView | null>(null);
  const [diff, setDiff] = useState<TextView | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const dismissedFiles = useRef(new Set<string>());
  const currentPath = useRef<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onSpectateEvent((record: SpectateEvent) => {
      if (record.event === 'session_started') {
        setWatching(true);
        setStatusNote(null);
        return;
      }
      if (record.event === 'file_changed' && record.path) {
        currentPath.current = record.path;
        setChange({
          path: record.path,
          sha256: record.new_sha256 ?? null,
          ranges: record.changed_line_ranges ?? [],
          parseError: record.parse_error ?? null,
          affectedNodeIds: [
            ...(record.affected_file_ids ?? []),
            ...(record.affected_symbol_ids ?? []),
          ],
          updatedAt: record.emitted_at,
        });
        setSource(null);
        setDiff(null);
        if (!dismissedFiles.current.has(record.path)) {
          if (bannerTimer.current) clearTimeout(bannerTimer.current);
          bannerTimer.current = setTimeout(() => setBannerPath(record.path ?? null), 120);
        }
        return;
      }
      if (record.event === 'source' && record.path === currentPath.current) {
        setSource({
          path: record.path,
          text: record.text ?? null,
          skippedReason: record.skipped_reason ?? null,
        });
        return;
      }
      if (record.event === 'diff' && record.path === currentPath.current) {
        setDiff({
          path: record.path,
          text: record.text ?? null,
          skippedReason: record.skipped_reason ?? null,
          truncated: record.truncated,
        });
        return;
      }
      if (record.event === 'structure_update' && record.path === currentPath.current) {
        setChange((previous) =>
          previous
            ? {
                ...previous,
                parseError: record.parse_error ?? null,
                affectedNodeIds: record.changed_node_ids ?? previous.affectedNodeIds,
              }
            : previous,
        );
        return;
      }
      if (record.event === 'watch_error') {
        setStatusNote(`Watch notice: ${record.reason ?? 'bounded read skipped'}`);
        return;
      }
      if (record.event === 'root_missing') {
        setStatusNote(`Project unavailable: ${record.reason ?? 'root missing'}`);
        setWatching(false);
        return;
      }
      if (record.event === 'session_ended') {
        setWatching(false);
        setStatusNote(`Stopped: ${record.reason ?? 'session ended'}`);
      }
    });
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge) return null;

  const startWatching = async () => {
    setBusy(true);
    setStatusNote(null);
    try {
      const selected = await bridge.chooseProjectFolder();
      if (!selected) return;
      setProject(selected);
      await bridge.startWatch();
      setWatching(true);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : 'Unable to start watching.');
    } finally {
      setBusy(false);
    }
  };

  const stopWatching = async () => {
    setBusy(true);
    try {
      await bridge.stopWatch();
      setWatching(false);
      setBannerPath(null);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : 'Unable to stop watching.');
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    if (bannerPath) dismissedFiles.current.add(bannerPath);
    setBannerPath(null);
  };

  return (
    <div className="spectate-hook" data-testid="spectate-hook">
      <div className={`spectate-status ${watching ? 'is-watching' : ''}`}>
        <span className="spectate-status-dot" aria-hidden="true" />
        <span>
          {watching
            ? `Watching (no tests rerun) · ${project?.displayName ?? 'project'}`
            : panelOpen
              ? 'Stopped (no tests rerun)'
              : 'Live spectate is off'}
        </span>
        {watching ? (
          <button className="btn-ghost btn-sm" onClick={stopWatching} disabled={busy}>
            <Square size={11} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button className="btn-secondary btn-sm" onClick={startWatching} disabled={busy}>
            <FolderOpen size={12} aria-hidden="true" /> {busy ? 'Choosing…' : 'Watch project'}
          </button>
        )}
      </div>

      {statusNote && <div className="spectate-status-note">{statusNote}</div>}

      {bannerPath && (
        <div className="spectate-banner" role="status">
          <span>Code changing in <strong>{bannerPath}</strong></span>
          <button
            className="btn-primary btn-sm"
            onClick={() => {
              setPanelOpen(true);
              setBannerPath(null);
            }}
          >
            <Eye size={12} aria-hidden="true" /> Spectate
          </button>
          <button className="btn-ghost btn-sm" onClick={notNow}>Not now</button>
        </div>
      )}

      {panelOpen && (
        <aside className="spectate-panel" aria-label="Live source and diff">
          <header className="spectate-panel-header">
            <div>
              <div className="spectate-eyebrow">Previous stable snapshot</div>
              <h2>{change?.path ?? 'Waiting for a stable Python change…'}</h2>
            </div>
            <button
              className="btn-ghost btn-sm"
              aria-label="Close spectate panel"
              onClick={() => setPanelOpen(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          {change && (
            <div className="spectate-facts">
              <span>sha {shortHash(change.sha256)}</span>
              <span>
                lines {change.ranges.length
                  ? change.ranges.map((range) => `${range.start_line}-${range.end_line}`).join(', ')
                  : 'none'}
              </span>
              <span>{new Date(change.updatedAt).toLocaleTimeString()}</span>
            </div>
          )}

          {change?.parseError && (
            <div className="spectate-parse-error" role="alert">
              Parse error: {change.parseError}. Last good map symbols are retained.
            </div>
          )}

          <section className="spectate-code-section">
            <h3>Live source</h3>
            <pre>{source?.text ?? (source?.skippedReason
              ? `Source skipped: ${source.skippedReason}`
              : 'Waiting for source…')}</pre>
          </section>

          <section className="spectate-code-section">
            <h3>Diff</h3>
            <pre>{diff?.text ?? (diff?.skippedReason
              ? `Diff skipped: ${diff.skippedReason}`
              : 'Waiting for diff…')}</pre>
            {diff?.truncated && <div className="spectate-truncated">Diff truncated by configured limit.</div>}
          </section>

          <section className="spectate-node-ids">
            <h3>Affected map IDs</h3>
            {change?.affectedNodeIds.length ? (
              <ul>
                {change.affectedNodeIds.map((identity) => <li key={identity}>{identity}</li>)}
              </ul>
            ) : (
              <p>No existing symbol overlaps this change.</p>
            )}
            <p className="spectate-gap">IDs are exposed; final map highlight wiring remains a layout integration.</p>
          </section>
        </aside>
      )}
    </div>
  );
};
