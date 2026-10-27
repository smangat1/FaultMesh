'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  choose: 'faultmesh:spectate:choose-project',
  start: 'faultmesh:spectate:start',
  stop: 'faultmesh:spectate:stop',
  event: 'faultmesh:spectate:event',
});

contextBridge.exposeInMainWorld('faultmeshSpectate', Object.freeze({
  chooseProjectFolder: () => ipcRenderer.invoke(CHANNELS.choose),
  startWatch: () => ipcRenderer.invoke(CHANNELS.start),
  stopWatch: () => ipcRenderer.invoke(CHANNELS.stop),
  onSpectateEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('spectate callback must be a function');
    const listener = (_event, record) => callback(record);
    ipcRenderer.on(CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(CHANNELS.event, listener);
  },
}));
