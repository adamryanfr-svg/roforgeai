const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rf', {
  call: (method, payload) => ipcRenderer.invoke('rf', method, payload),
  on: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('rf:event', listener);
    return () => ipcRenderer.removeListener('rf:event', listener);
  },
  // Chemin réel d'un fichier glissé dans la fenêtre.
  pathOf: (file) => webUtils.getPathForFile(file),
});
