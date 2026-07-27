const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aihub', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  login2FA: (input) => ipcRenderer.invoke('auth:login-2fa', input),
  rememberedAccount: () => ipcRenderer.invoke('auth:remembered-account'),
  restore: () => ipcRenderer.invoke('auth:restore'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  request: (route, options = {}) => ipcRenderer.invoke('api:request', {
    route,
    method: options.method || 'GET',
    body: options.body,
  }),
  copyText: (value) => ipcRenderer.invoke('app:copy-text', value),
  saveText: (input) => ipcRenderer.invoke('app:save-text', input),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setTitlebarTheme: (dark) => ipcRenderer.send('app:set-titlebar-theme', Boolean(dark)),
  ccSwitch: {
    listClients: () => ipcRenderer.invoke('cc-switch:invoke', { method: 'listClients' }),
    getClientState: (clientId) => ipcRenderer.invoke('cc-switch:invoke', { method: 'getClientState', args: [clientId] }),
    listProfiles: (clientId) => ipcRenderer.invoke('cc-switch:invoke', { method: 'listProfiles', args: [clientId] }),
    getProfile: (profileId) => ipcRenderer.invoke('cc-switch:invoke', { method: 'getProfile', args: [profileId] }),
    upsertProfile: (profile) => ipcRenderer.invoke('cc-switch:invoke', { method: 'upsertProfile', args: [profile] }),
    deleteProfile: (profileId) => ipcRenderer.invoke('cc-switch:invoke', { method: 'deleteProfile', args: [profileId] }),
    switchProfile: (input) => ipcRenderer.invoke('cc-switch:invoke', { method: 'switchProfile', args: [input] }),
    listBackups: (clientId) => ipcRenderer.invoke('cc-switch:invoke', { method: 'listBackups', args: [clientId] }),
    restoreBackup: (input) => ipcRenderer.invoke('cc-switch:invoke', { method: 'restoreBackup', args: [input] }),
  },
})
