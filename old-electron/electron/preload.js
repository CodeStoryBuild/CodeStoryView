const { contextBridge, ipcRenderer } = require("electron");

// Security: Disable node integration completely
if (process.contextIsolated !== true) {
  throw new Error("Context isolation must be enabled for security");
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getVersion: () => ipcRenderer.invoke("get-version"),
  openDirectory: () => ipcRenderer.invoke("dialog-open-directory"),
  platform: process.platform,
  secureStore: {
    getApiKey: async () => {
      const res = await ipcRenderer.invoke("secure-get-api-key");
      return res?.key || null;
    },
    setApiKey: async (key) => {
      await ipcRenderer.invoke("secure-set-api-key", { key });
      return true;
    },
    clearApiKey: async () => {
      const res = await ipcRenderer.invoke("secure-clear-api-key");
      return !!res?.ok;
    },
  },

  // Git API methods
  git: {
    getBranches: (repoPath) =>
      ipcRenderer.invoke("git-get-branches", { repoPath }),
    getCommits: (repoPath, branch) =>
      ipcRenderer.invoke("git-get-commits", { repoPath, branch }),
    getDiff: (repoPath, commitHash) =>
      ipcRenderer.invoke("git-get-diff", { repoPath, commitHash }),
  },

  // Vibe API methods
  vibe: {
    executeCommand: (options) =>
      ipcRenderer.invoke("vibe-execute-command", options),
    getInfo: () => ipcRenderer.invoke("vibe-get-info"),
    getCompatibility: () => ipcRenderer.invoke("vibe-get-compatibility"),
    runCommand: (options) => ipcRenderer.invoke("vibe-run-command", options),
    startStreamingCommand: (options) =>
      ipcRenderer.invoke("vibe-start-streaming-command", options),
    onCommandOutput: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on("vibe-command-output", listener);
      return () => ipcRenderer.removeListener("vibe-command-output", listener);
    },
  },
});
