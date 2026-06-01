const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kinagent", {
  getStatus: () => ipcRenderer.invoke("app:get-status"),
  openKindroid: () => ipcRenderer.invoke("app:open-kindroid"),
  startLogin: () => ipcRenderer.invoke("login:start"),
  saveLogin: () => ipcRenderer.invoke("login:save"),
  cancelLogin: () => ipcRenderer.invoke("login:cancel"),
  startMonitor: (input) => ipcRenderer.invoke("monitor:start", input),
  stopMonitor: () => ipcRenderer.invoke("monitor:stop"),
  setKinEnabled: (input) => ipcRenderer.invoke("kins:set-enabled", input),
  refreshKins: () => ipcRenderer.invoke("kins:refresh"),
  setGroupEnabled: (input) => ipcRenderer.invoke("groups:set-enabled", input),
  refreshGroups: () => ipcRenderer.invoke("groups:refresh"),
  onEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  }
});
