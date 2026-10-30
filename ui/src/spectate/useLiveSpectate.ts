import { useEffect, useReducer, useRef, useState } from 'react';
import {
  EMPTY_LIVE_SPECTATE_STATE,
  reduceLiveSpectate,
  type LiveSpectateState,
} from './liveState';
import type { ProjectChoice, SpectateEvent } from './types';

export interface UseLiveSpectateOptions {
  onLiveStateChange?: (state: LiveSpectateState) => void;
}

export function useLiveSpectate({ onLiveStateChange }: UseLiveSpectateOptions = {}) {
  const bridge = typeof window !== 'undefined' ? window.faultmeshSpectate : undefined;
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

  const startWatching = async (): Promise<ProjectChoice | null> => {
    if (!bridge) return null;
    setBusy(true);
    setStatusNote(null);
    try {
      const selected = await bridge.chooseProjectFolder();
      if (!selected) return null;
      setProject(selected);
      await bridge.startWatch();
      setWatching(true);
      return selected;
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : 'Unable to start watching.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const stopWatching = async () => {
    if (!bridge) return;
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

  return {
    bridge,
    hasBridge: Boolean(bridge),
    liveState,
    project,
    watching,
    busy,
    panelOpen,
    setPanelOpen,
    bannerPath,
    setBannerPath,
    statusNote,
    startWatching,
    stopWatching,
    notNow,
  };
}

export type SpectateController = ReturnType<typeof useLiveSpectate>;
