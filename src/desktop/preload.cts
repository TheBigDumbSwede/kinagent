import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type RendererEventCallback = (message: unknown) => void;

const kinagentApi = {
  getStatus: () => ipcRenderer.invoke("app:get-status"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (input: unknown) => ipcRenderer.invoke("settings:save", input),
  openKindroid: () => ipcRenderer.invoke("app:open-kindroid"),
  startLogin: () => ipcRenderer.invoke("login:start"),
  saveLogin: () => ipcRenderer.invoke("login:save"),
  cancelLogin: () => ipcRenderer.invoke("login:cancel"),
  startMonitor: (input: unknown) => ipcRenderer.invoke("monitor:start", input),
  stopMonitor: () => ipcRenderer.invoke("monitor:stop"),
  setKinEnabled: (input: unknown) => ipcRenderer.invoke("kins:set-enabled", input),
  refreshKins: () => ipcRenderer.invoke("kins:refresh"),
  setGroupEnabled: (input: unknown) => ipcRenderer.invoke("groups:set-enabled", input),
  refreshGroups: () => ipcRenderer.invoke("groups:refresh"),
  getCapturedKin: (input: unknown) => ipcRenderer.invoke("capture:get-kin", input),
  getCapturedGroup: (input: unknown) => ipcRenderer.invoke("capture:get-group", input),
  listJournalSuggestions: () => ipcRenderer.invoke("journal:list-suggestions"),
  acceptJournalSuggestion: (input: unknown) => ipcRenderer.invoke("journal:accept-suggestion", input),
  deleteInvalidatedJournalSuggestion: (input: unknown) =>
    ipcRenderer.invoke("journal:delete-invalidated-suggestion", input),
  dismissJournalSuggestion: (input: unknown) => ipcRenderer.invoke("journal:dismiss-suggestion", input),
  getKinVoicePreference: (input: unknown) => ipcRenderer.invoke("voice:get-kin-preference", input),
  setKinVoicePreference: (input: unknown) => ipcRenderer.invoke("voice:set-kin-preference", input),
  getGroupSoundscapePreference: (input: unknown) => ipcRenderer.invoke("soundscape:get-group-preference", input),
  setGroupSoundscapePreference: (input: unknown) => ipcRenderer.invoke("soundscape:set-group-preference", input),
  forceLocalScenePrewarm: (input: unknown) => ipcRenderer.invoke("prewarm:local-scene", input),
  forceSoundscapePrewarm: (input: unknown) => ipcRenderer.invoke("prewarm:soundscape", input),
  getKinAmbientPreference: (input: unknown) => ipcRenderer.invoke("ambient:get-kin-preference", input),
  setKinAmbientPreference: (input: unknown) => ipcRenderer.invoke("ambient:set-kin-preference", input),
  exportKinChat: (input: unknown) => ipcRenderer.invoke("chat-export:kin", input),
  exportGroupChat: (input: unknown) => ipcRenderer.invoke("chat-export:group", input),
  analyzeKin: (input: unknown) => ipcRenderer.invoke("kin-analyze:run", input),
  readSoundscapeAsset: (input: unknown) => ipcRenderer.invoke("soundscape:read-asset", input),
  onEvent: (callback: RendererEventCallback) => {
    const listener = (_event: IpcRendererEvent, message: unknown) => callback(message);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  }
};

contextBridge.exposeInMainWorld("kinagent", kinagentApi);
