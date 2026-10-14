// Gives the QuantBot page its window buttons (the app draws its own title bar) and nothing else
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quantbotDesktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
});
