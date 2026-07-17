const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('triggerPad', {
  readConfig: () => ipcRenderer.invoke('config:read'),
  bindAudio: (callback, audioName) => ipcRenderer.invoke('config:bind-audio', { callback, audioName }),
  updateSettings: changes => ipcRenderer.invoke('settings:update', changes),
  listAudio: () => ipcRenderer.invoke('audio:list'),
  readAudio: fileName => ipcRenderer.invoke('audio:read', fileName),
  importAudio: () => ipcRenderer.invoke('audio:import'),
  removeAudio: fileName => ipcRenderer.invoke('audio:remove', fileName),
  clearAudio: () => ipcRenderer.invoke('audio:clear'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  isMaximizedWindow: () => ipcRenderer.invoke('window:is-maximized'),
  getAccentColor: () => ipcRenderer.invoke('window:get-accent-color'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
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
  onWindowMaximized: callback => {
    const listener = (_event, maximized) => callback(Boolean(maximized))
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  }
})
