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
});

contextBridge.exposeInMainWorld('faultmeshSpectate', Object.freeze({
  chooseProjectFolder: () => ipcRenderer.invoke(CHANNELS.choose),
  startWatch: () => ipcRenderer.invoke(CHANNELS.start),
  stopWatch: () => ipcRenderer.invoke(CHANNELS.stop),
  openRecording: () => ipcRenderer.invoke(CHANNELS.openRecording),
  listHistory: () => ipcRenderer.invoke(CHANNELS.listHistory),
  importSession: (sessionId, tool) => ipcRenderer.invoke(CHANNELS.importSession, sessionId, tool),
  onSpectateEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('spectate callback must be a function');
    const listener = (_event, record) => callback(record);
    ipcRenderer.on(CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(CHANNELS.event, listener);
  },
}));
