// Gives the QuantBot page its window buttons (the app draws its own title bar), its log folder and its chats'
// workspace folders, nothing else
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quantbotDesktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  logsPath: () => ipcRenderer.invoke('logs:path'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  openWorkspace: (dir) => ipcRenderer.invoke('workspace:open', dir),
  onMaximizedChange: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
});
