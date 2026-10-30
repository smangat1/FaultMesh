'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  choose: 'faultmesh:spectate:choose-project',
  start: 'faultmesh:spectate:start',
  stop: 'faultmesh:spectate:stop',
  openRecording: 'faultmesh:spectate:open-recording',
  event: 'faultmesh:spectate:event',
  listHistory: 'faultmesh:spectate:list-history',
  importSession: 'faultmesh:spectate:import-session',
  linkSessionProject: 'faultmesh:spectate:link-session-project',
  modelStatus: 'faultmesh:replay:model-status',
  downloadModel: 'faultmesh:replay:download-model',
  chooseModel: 'faultmesh:replay:choose-model',
  startNarration: 'faultmesh:replay:start-narration',
  cancelNarration: 'faultmesh:replay:cancel-narration',
  rerunNarration: 'faultmesh:replay:rerun-narration',
  narrationEvent: 'faultmesh:replay:narration-event',
});

contextBridge.exposeInMainWorld('faultmeshSpectate', Object.freeze({
  chooseProjectFolder: () => ipcRenderer.invoke(CHANNELS.choose),
  startWatch: () => ipcRenderer.invoke(CHANNELS.start),
  stopWatch: () => ipcRenderer.invoke(CHANNELS.stop),
  openRecording: () => ipcRenderer.invoke(CHANNELS.openRecording),
  listHistory: () => ipcRenderer.invoke(CHANNELS.listHistory),
  importSession: (sessionId, tool) => ipcRenderer.invoke(CHANNELS.importSession, sessionId, tool),
  linkSessionProject: (sessionId, projectHandle) => ipcRenderer.invoke(
    CHANNELS.linkSessionProject,
    sessionId,
    projectHandle,
  ),
  modelStatus: () => ipcRenderer.invoke(CHANNELS.modelStatus),
  downloadModel: (modelId) => ipcRenderer.invoke(CHANNELS.downloadModel, modelId),
  chooseModel: () => ipcRenderer.invoke(CHANNELS.chooseModel),
  startNarration: (sessionId, tool) => ipcRenderer.invoke(
    CHANNELS.startNarration,
    sessionId,
    tool,
  ),
  cancelNarration: () => ipcRenderer.invoke(CHANNELS.cancelNarration),
  rerunNarration: (sessionId, tool) => ipcRenderer.invoke(
    CHANNELS.rerunNarration,
    sessionId,
    tool,
  ),
  onNarrationEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('narration callback must be a function');
    const listener = (_event, record) => callback(record);
    ipcRenderer.on(CHANNELS.narrationEvent, listener);
    return () => ipcRenderer.removeListener(CHANNELS.narrationEvent, listener);
  },
  onSpectateEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('spectate callback must be a function');
    const listener = (_event, record) => callback(record);
    ipcRenderer.on(CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(CHANNELS.event, listener);
  },
}));
