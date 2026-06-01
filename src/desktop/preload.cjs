const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kinagent", {
  getStatus: () => ipcRenderer.invoke("app:get-status"),
  openKindroid: () => ipcRenderer.invoke("app:open-kindroid"),
  startLogin: () => ipcRenderer.invoke("login:start"),
  saveLogin: () => ipcRenderer.invoke("login:save"),
  cancelLogin: () => ipcRenderer.invoke("login:cancel"),
  startMonitor: (input) => ipcRenderer.invoke("monitor:start", input),
  stopMonitor: () => ipcRenderer.invoke("monitor:stop"),
  onEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  }
});
