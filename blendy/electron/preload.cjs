const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("blendyWindow", {
  getPinned: () => ipcRenderer.invoke("window:get-pinned"),
  setPinned: (pinned) => ipcRenderer.invoke("window:set-pinned", pinned),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
});

contextBridge.exposeInMainWorld("blendyApp", {
  getState: () => ipcRenderer.invoke("blendy:get-state"),
  getModelStatus: (settings) => ipcRenderer.invoke("blendy:get-model-status", settings),
  refreshContext: (request) => ipcRenderer.invoke("blendy:refresh-context", request),
  sendMessage: (request) => ipcRenderer.invoke("blendy:send-message", request),
  regenerateLast: (request) => ipcRenderer.invoke("blendy:regenerate-last", request),
  cancelMessage: (request) => ipcRenderer.invoke("blendy:cancel-message", request),
  compactChat: (request) => ipcRenderer.invoke("blendy:compact-chat", request),
  freshChat: (request) => ipcRenderer.invoke("blendy:fresh-chat", request),
  switchChat: (request) => ipcRenderer.invoke("blendy:switch-chat", request),
  renameChat: (request) => ipcRenderer.invoke("blendy:rename-chat", request),
  deleteChat: (request) => ipcRenderer.invoke("blendy:delete-chat", request),
  saveChatNotebook: (request) => ipcRenderer.invoke("blendy:save-chat-notebook", request),
  acknowledgeChatScene: (request) => ipcRenderer.invoke("blendy:acknowledge-chat-scene", request),
  saveBackendSettings: (settings) => ipcRenderer.invoke("blendy:save-backend-settings", settings),
  openDiagnosticFile: (filePath) => ipcRenderer.invoke("blendy:open-diagnostic-file", filePath),
  onChatEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("blendy:chat-event", listener);
    return () => ipcRenderer.removeListener("blendy:chat-event", listener);
  },
});
