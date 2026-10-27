import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Eye, FolderOpen, Square, X } from 'lucide-react';
import {
  EMPTY_LIVE_SPECTATE_STATE,
  reduceLiveSpectate,
  type LiveSpectateState,
} from '../spectate/liveState';
import type { ProjectChoice, SpectateEvent } from '../spectate/types';
import '../styles/spectate.css';

interface SpectateHookProps {
  onLiveStateChange?: (state: LiveSpectateState) => void;
}

const shortHash = (value: string | null): string => (value ? value.slice(0, 10) : 'deleted');

export const SpectateHook: React.FC<SpectateHookProps> = ({ onLiveStateChange }) => {
  const bridge = window.faultmeshSpectate;
  const [liveState, dispatch] = useReducer(reduceLiveSpectate, EMPTY_LIVE_SPECTATE_STATE);
  const [project, setProject] = useState<ProjectChoice | null>(null);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const dismissedFiles = useRef(new Set<string>());
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onLiveStateChange?.(liveState);
  }, [liveState, onLiveStateChange]);

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onSpectateEvent((record: SpectateEvent) => {
      dispatch(record);
      if (record.event === 'session_started') {
        setWatching(true);
        setStatusNote(null);
        return;
      }
      if (record.event === 'file_changed' && record.path) {
        if (!dismissedFiles.current.has(record.path)) {
          if (bannerTimer.current) clearTimeout(bannerTimer.current);
          bannerTimer.current = setTimeout(() => setBannerPath(record.path ?? null), 120);
        }
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
      dispatch({ event: 'local_stop', reason: 'stopped_by_user' });
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
  const change = liveState.change;
  const source = liveState.source;
  const diff = liveState.diff;
  const currentStructureIsStale = Boolean(
    change && liveState.stalePaths.some((item) => item.path === change.path),
  );

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
              <div className="spectate-eyebrow">Live source</div>
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

          {(change?.parseError || currentStructureIsStale) && (
            <div className="spectate-parse-error" role="alert">
              {change?.parseError && <>Parse error: {change.parseError}. </>}
              Structure from last good parse (stale); current source is shown below.
            </div>
          )}

          <section className="spectate-code-section">
            <h3>Current stable source</h3>
            <pre>{change?.kind === 'deleted'
              ? 'File deleted; there is no current source.'
              : source?.text ?? (source?.skippedReason
              ? `Source skipped: ${source.skippedReason}`
              : 'Waiting for source…')}</pre>
          </section>

          <section className="spectate-code-section">
            <h3>Diff vs previous stable snapshot</h3>
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
            <p className="spectate-gap">These IDs are highlighted on the watched project's live map.</p>
            {liveState.partialReasons.length > 0 && (
              <p>Relationship view partial: {liveState.partialReasons.join(', ')}.</p>
            )}
          </section>
        </aside>
      )}
    </div>
  );
};
