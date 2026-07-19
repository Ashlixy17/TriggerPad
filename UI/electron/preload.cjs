const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('triggerPad', {
  readConfig: () => ipcRenderer.invoke('config:read'),
  bindAudio: (callback, audioName) => ipcRenderer.invoke('config:bind-audio', { callback, audioName }),
  setEventEnabled: (callback, enabled) => ipcRenderer.invoke('config:set-event-enabled', { callback, enabled }),
  updateEventAudio: (callback, changes) => ipcRenderer.invoke('config:update-event-audio', { callback, changes }),
  updateSettings: changes => ipcRenderer.invoke('settings:update', changes),
  listAudio: () => ipcRenderer.invoke('audio:list'),
  listOutputDevices: () => ipcRenderer.invoke('audio:list-output-devices'),
  playPreviewAudio: options => ipcRenderer.invoke('audio:preview-play', options),
  stopPreviewAudio: channel => ipcRenderer.invoke('audio:preview-stop', channel),
  readAudio: fileName => ipcRenderer.invoke('audio:read', fileName),
  importAudio: () => ipcRenderer.invoke('audio:import'),
  renameAudio: (oldFileName, newFileName) => ipcRenderer.invoke('audio:rename', { oldFileName, newFileName }),
  removeAudio: fileName => ipcRenderer.invoke('audio:remove', fileName),
  clearAudio: () => ipcRenderer.invoke('audio:clear'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  isMaximizedWindow: () => ipcRenderer.invoke('window:is-maximized'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
  getAccentColor: () => ipcRenderer.invoke('window:get-accent-color'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  onServerLog: callback => {
    const listener = (_event, entry) => callback(entry)
    ipcRenderer.on('server:log', listener)
    return () => ipcRenderer.removeListener('server:log', listener)
  },
  onServerStatus: callback => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('server:status', listener)
    return () => ipcRenderer.removeListener('server:status', listener)
  },
  onPreviewAudioState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('audio:preview-state', listener)
    return () => ipcRenderer.removeListener('audio:preview-state', listener)
  },
  onWindowMaximized: callback => {
    const listener = (_event, maximized) => callback(Boolean(maximized))
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
  onWindowAlwaysOnTop: callback => {
    const listener = (_event, alwaysOnTop) => callback(Boolean(alwaysOnTop))
    ipcRenderer.on('window:always-on-top', listener)
    return () => ipcRenderer.removeListener('window:always-on-top', listener)
  }
})
