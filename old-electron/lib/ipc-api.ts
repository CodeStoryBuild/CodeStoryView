// IPC API service to replace HTTP calls with Electron IPC
// This provides the same interface as the original HTTP API but uses IPC

interface ElectronAPI {
  git: {
    getBranches: (repoPath: string) => Promise<{ branches: string[] }>;
    getCommits: (
      repoPath: string,
      branch: string,
    ) => Promise<{ commits: any[] }>;
    getDiff: (
      repoPath: string,
      commitHash: string,
    ) => Promise<{ diff: string }>;
  };
  vibe: {
    executeCommand: (options: any) => Promise<any>;
    getInfo: () => Promise<any>;
    getCompatibility: () => Promise<any>;
    runCommand: (options: any) => Promise<any>;
    startStreamingCommand: (options: any) => Promise<any>;
    onCommandOutput: (callback: (data: any) => void) => () => void;
  };
  secureStore?: {
    getApiKey: () => Promise<string | null>;
    setApiKey: (key: string) => Promise<boolean>;
    clearApiKey: () => Promise<boolean>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Check if we're running in Electron
const isElectron = typeof window !== "undefined" && window.electronAPI;

// API service that uses IPC when available, falls back to HTTP
export const apiService = {
  // Git API methods
  git: {
    async getBranches(repoPath: string) {
      if (isElectron) {
        return await window.electronAPI.git.getBranches(repoPath);
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/git/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath }),
        });
        return await response.json();
      }
    },

    async getCommits(repoPath: string, branch: string) {
      if (isElectron) {
        return await window.electronAPI.git.getCommits(repoPath, branch);
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/git/commits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath, branch }),
        });
        return await response.json();
      }
    },

    async getDiff(repoPath: string, commitHash: string) {
      if (isElectron) {
        return await window.electronAPI.git.getDiff(repoPath, commitHash);
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/git/diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath, commitHash }),
        });
        return await response.json();
      }
    },
  },

  // Vibe API methods
  vibe: {
    async executeCommand(options: {
      root_args?: string[];
      command: string;
      args?: string[];
      timeout?: number;
      workingDirectory?: string;
    }) {
      if (isElectron) {
        return await window.electronAPI.vibe.executeCommand(options);
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/vibe/execute_command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });
        return await response.json();
      }
    },

    async getInfo() {
      if (isElectron) {
        return await window.electronAPI.vibe.getInfo();
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/vibe/info", {
          method: "GET",
        });
        return await response.json();
      }
    },

    async getCompatibility() {
      if (isElectron) {
        return await window.electronAPI.vibe.getCompatibility();
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/vibe/compatibility", {
          method: "GET",
        });
        return await response.json();
      }
    },

    async runCommand(options: {
      root_args?: string[];
      command: string;
      args?: string[];
      timeout?: number;
      workingDirectory?: string;
    }) {
      if (isElectron) {
        return await window.electronAPI.vibe.runCommand(options);
      } else {
        // Fallback to HTTP for development
        const response = await fetch("/api/vibe/run_command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });
        return await response.json();
      }
    },

    async startStreamingCommand(options: {
      root_args?: string[];
      command: string;
      args?: string[];
      workingDirectory?: string;
    }) {
      if (isElectron) {
        return await window.electronAPI.vibe.startStreamingCommand(options);
      } else {
        // For development, fall back to non-streaming
        return await this.runCommand(options);
      }
    },

    onCommandOutput(callback: (data: any) => void) {
      if (isElectron) {
        return window.electronAPI.vibe.onCommandOutput(callback);
      } else {
        // Return a no-op cleanup function for development
        return () => {};
      }
    },
  },
};
