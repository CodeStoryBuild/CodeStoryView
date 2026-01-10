import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  fetchCommits,
  fetchBranches,
  fetchDiff,
  isGitRepo,
  getCurrentBranch,
  hasGitChanges,
  isGitLocked,
} from "./git/git-logic";
import { CstManager } from "./cst-manager";

let codestoryTerminal: vscode.Terminal | undefined;
let currentExecutionState: {
  isExecuting: boolean;
  hash?: string;
  name?: string;
  cwd?: string;
  execution?: vscode.TerminalShellExecution;
} = { isExecuting: false };

export function activate(context: vscode.ExtensionContext) {
  console.log("Codestory View extension is now active!");

  const cstManager = new CstManager(context);
  let isShellIntegrationReady = false;

  const checkShellIntegration = () => {
    const config = vscode.workspace.getConfiguration(
      "terminal.integrated.shellIntegration",
    );
    const enabled = config.get<boolean>("enabled");
    if (!enabled) {
      vscode.window
        .showWarningMessage(
          "Codestory requires VS Code Shell Integration to be enabled for robust command tracking. This extension will not work correctly without it.",
          "Open Settings",
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "terminal.integrated.shellIntegration.enabled",
            );
          }
        });
    }
    return !!enabled;
  };

  const updateExecutionState = (
    state: Partial<typeof currentExecutionState>,
    panel?: vscode.WebviewPanel,
  ) => {
    currentExecutionState = { ...currentExecutionState, ...state };
    const p = panel || activePanel;
    if (p) {
      p.webview.postMessage({
        command: "executionState",
        state: currentExecutionState,
      });
    }
  };

  const updateShellIntegrationStatus = (panel?: vscode.WebviewPanel) => {
    const config = vscode.workspace.getConfiguration(
      "terminal.integrated.shellIntegration",
    );
    const settingEnabled = config.get<boolean>("enabled");
    const terminalReady = !!codestoryTerminal?.shellIntegration;
    isShellIntegrationReady = !!settingEnabled && terminalReady;

    const p = panel || activePanel;
    if (p) {
      p.webview.postMessage({
        command: "shellIntegrationStatus",
        enabled: !!settingEnabled,
        ready: terminalReady,
      });
    }
  };

  // Check on startup
  checkShellIntegration();

  let activePanel: vscode.WebviewPanel | undefined;
  let isLoadingRepo = false;
  let repoWatcher: vscode.FileSystemWatcher | undefined;
  let nonRepoWatcher: vscode.FileSystemWatcher | undefined;
  let watchedRepoPath: string | undefined;
  let currentViewedBranch: string | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;
  let nonRepoDebounceTimer: NodeJS.Timeout | undefined;
  let lastState:
    | {
        branches: string[];
        currentBranch: string | undefined;
        isDetached: boolean;
        commits: any[];
      }
    | undefined;

  async function handleLoadRepo(
    panel: vscode.WebviewPanel,
    repoPath: string,
    branch?: string,
    source: "initial" | "manual" | "git" | "workdir" | "load_more" = "manual",
    limit: number = 100,
  ) {
    if (isLoadingRepo) {
      return;
    }
    isLoadingRepo = true;

    try {
      if (!repoPath) throw new Error("Please specify a directory path.");

      if (
        source === "manual" ||
        source === "initial" ||
        source === "load_more"
      ) {
        panel.webview.postMessage({ command: "loading" });
      }

      if (source === "git" || source === "workdir") {
        let locked = await isGitLocked(repoPath);
        let retries = 0;
        while (locked && retries < 3) {
          const delay = Math.pow(2, retries) * 200;
          await new Promise((resolve) => setTimeout(resolve, delay));
          locked = await isGitLocked(repoPath);
          retries++;
        }
        if (locked) return;
      }

      const pathChanged = watchedRepoPath !== repoPath;
      currentViewedBranch = branch;

      if (pathChanged) {
        if (repoWatcher) {
          repoWatcher.dispose();
          repoWatcher = undefined;
        }
        if (nonRepoWatcher) {
          nonRepoWatcher.dispose();
          nonRepoWatcher = undefined;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        if (nonRepoDebounceTimer) {
          clearTimeout(nonRepoDebounceTimer);
          nonRepoDebounceTimer = undefined;
        }
        lastState = undefined;
      }

      const branches = await fetchBranches(repoPath);
      let currentBranch = await getCurrentBranch(repoPath);
      const isDetached = currentBranch === "(not on a branch)";

      if (isDetached && branches.length > 0) {
        currentBranch = branches[0];
      }

      const { commits, hasMore, status } = await fetchCommits(
        repoPath,
        branch || "HEAD",
        limit,
      );

      const newState = {
        branches,
        currentBranch,
        isDetached,
        commits,
        hasMore,
        status,
      };

      const commitsChanged = (a: any[], b: any[]) => {
        const hasWorkA = a[0]?.isWorkingDir;
        const hasWorkB = b[0]?.isWorkingDir;
        if (hasWorkA !== hasWorkB) return true;

        // If both have working dir, check if the status changed
        if (hasWorkA && hasWorkB) {
          if (a[0].status !== b[0].status) return true;
        }

        const headA = hasWorkA ? a[1]?.id : a[0]?.id;
        const headB = hasWorkB ? b[1]?.id : b[0]?.id;
        return headA !== headB;
      };

      const branchesChanged = (a: string[], b: string[]) => {
        if (a.length !== b.length) return true;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return true;
        }
        return false;
      };

      const stateChanged =
        !lastState ||
        branchesChanged(lastState.branches, newState.branches) ||
        lastState.currentBranch !== newState.currentBranch ||
        lastState.isDetached !== newState.isDetached ||
        commitsChanged(lastState.commits, newState.commits);

      if (
        source !== "manual" &&
        source !== "initial" &&
        source !== "load_more" &&
        !stateChanged
      ) {
        return;
      }

      lastState = newState;

      panel.webview.postMessage({
        command: "displayBranches",
        branches,
        currentBranch,
        isDetached,
        shouldUpdate: !branch,
        isManual: source === "manual" || source === "initial",
      });

      panel.webview.postMessage({
        command: "displayCommits",
        commits,
        hasMore,
        source,
      });

      if (pathChanged) {
        watchedRepoPath = repoPath;
        setupWatchers(repoPath, panel);
      }
    } catch (error) {
      panel.webview.postMessage({
        command: "loadError",
        message: (error as Error).message,
      });
    } finally {
      isLoadingRepo = false;
    }
  }

  function setupWatchers(repoPath: string, panel: vscode.WebviewPanel) {
    let pendingGitChange = false;
    let pendingWorkdirChange = false;
    let pendingActualWorkdirChange = false;

    const handleFileChange = async () => {
      if (!activePanel) return;

      const wasGitChange = pendingGitChange;
      const wasWorkdirChange = pendingWorkdirChange;
      const wasActualWorkdirChange = pendingActualWorkdirChange;

      pendingGitChange = false;
      pendingWorkdirChange = false;
      pendingActualWorkdirChange = false;

      let locked = await isGitLocked(repoPath);
      let retries = 0;
      while (locked && retries < 3) {
        const delay = Math.pow(2, retries) * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
        locked = await isGitLocked(repoPath);
        retries++;
      }
      if (locked) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleFileChange(), 1000);
        return;
      }

      const currentHasChanges = await hasGitChanges(repoPath);
      const previousHasChanges =
        lastState?.commits.some((c) => c.id === "WORKING_DIR") || false;
      const workingDirStateChanged = currentHasChanges !== previousHasChanges;

      if (wasGitChange) {
        vscode.window.setStatusBarMessage(
          "Repo State Changed, Reloading...",
          3000,
        );
        const branchToUse =
          currentViewedBranch || lastState?.currentBranch || "HEAD";
        const currentLimit = lastState?.commits.length || 100;
        await handleLoadRepo(panel, repoPath, branchToUse, "git", currentLimit);
        return;
      }

      if (workingDirStateChanged) {
        vscode.window.setStatusBarMessage(
          "Working Directory State Changed, Reloading...",
          3000,
        );
        const branchToUse =
          currentViewedBranch || lastState?.currentBranch || "HEAD";
        const currentLimit = lastState?.commits.length || 100;
        await handleLoadRepo(
          panel,
          repoPath,
          branchToUse,
          "workdir",
          currentLimit,
        );
        return;
      }

      if (wasWorkdirChange && wasActualWorkdirChange && currentHasChanges) {
        activePanel.webview.postMessage({
          command: "reloadWorkingDirDiff",
        });
      }
    };

    const gitRefsPattern = new vscode.RelativePattern(
      repoPath,
      ".git/{refs,HEAD,ORIG_HEAD,MERGE_HEAD,FETCH_HEAD}/**",
    );
    repoWatcher = vscode.workspace.createFileSystemWatcher(gitRefsPattern);

    // Initial load of .gitignore
    let ignoredPatterns: string[] = [];
    let ignoreRegex: RegExp | undefined;

    const loadGitignore = () => {
      try {
        const gitignorePath = path.join(repoPath, ".gitignore");
        if (fs.existsSync(gitignorePath)) {
          const content = fs.readFileSync(gitignorePath, "utf-8");
          ignoredPatterns = content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));

          if (ignoredPatterns.length > 0) {
            // Convert patterns to regex parts
            const parts = ignoredPatterns.map((p) => {
              // Escape regex special chars except * and ?
              let escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
              // Convert glob * and ** to regex
              escaped = escaped
                .replace(/\*\*/g, "(.+)")
                .replace(/\*/g, "([^/\\\\]+)")
                .replace(/\?/g, "(.)");

              // If it ends with /, it matches the dir and everything inside
              if (escaped.endsWith("/")) {
                return `^${escaped.slice(0, -1)}($|[\\\\/].*)`;
              }
              // Otherwise matches the file/dir exactly or as a trailing part
              return `(^|[\\\\/])${escaped}($|[\\\\/].*)`;
            });
            ignoreRegex = new RegExp(parts.join("|"), "i");
          } else {
            ignoreRegex = undefined;
          }
        }
      } catch (e) {
        console.error("Failed to read .gitignore", e);
      }
    };
    loadGitignore();

    const isIgnored = (relPath: string) => {
      // Primary hardcoded ignores
      if (relPath.startsWith(".git" + path.sep) || relPath === ".git")
        return true;
      if (
        relPath.startsWith("node_modules" + path.sep) ||
        relPath === "node_modules"
      )
        return true;
      if (relPath.startsWith("dist" + path.sep) || relPath === "dist")
        return true;
      if (relPath.startsWith("out" + path.sep) || relPath === "out")
        return true;

      // Use compiled regex if available
      if (ignoreRegex && ignoreRegex.test(relPath)) {
        return true;
      }

      return false;
    };

    const gitRefresh = () => {
      pendingGitChange = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => handleFileChange(), 1000);
    };

    repoWatcher.onDidChange(gitRefresh);
    repoWatcher.onDidCreate(gitRefresh);
    repoWatcher.onDidDelete(gitRefresh);

    const allPattern = new vscode.RelativePattern(repoPath, "**");
    nonRepoWatcher = vscode.workspace.createFileSystemWatcher(allPattern);

    const nonRepoRefresh = (uri?: vscode.Uri) => {
      const fsPath = uri?.fsPath || repoPath;
      const rel = path.relative(repoPath, fsPath);

      if (isIgnored(rel)) {
        return;
      }

      if (rel === ".gitignore") {
        loadGitignore();
      }

      pendingWorkdirChange = true;
      pendingActualWorkdirChange = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => handleFileChange(), 1000);
    };

    nonRepoWatcher.onDidChange(nonRepoRefresh);
    nonRepoWatcher.onDidCreate(nonRepoRefresh);
    nonRepoWatcher.onDidDelete(nonRepoRefresh);
  }

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution(async (e) => {
      if (
        e.terminal === codestoryTerminal &&
        e.execution === currentExecutionState.execution
      ) {
        updateExecutionState(
          { isExecuting: false, hash: undefined, execution: undefined },
          activePanel,
        );

        if (activePanel) {
          if (e.exitCode === 0) {
            activePanel.webview.postMessage({
              command: "displayOutput",
              data: `Command finished successfully.`,
            });
            // Auto-reload the repository after successful execution to reflect changes
            if (currentExecutionState.cwd) {
              const currentLimit = lastState?.commits.length || 100;
              handleLoadRepo(
                activePanel,
                currentExecutionState.cwd,
                currentViewedBranch,
                "git",
                currentLimit,
              );
            }
          } else {
            activePanel.webview.postMessage({
              command: "displayOutput",
              data: `Command failed with code ${e.exitCode}`,
            });
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === codestoryTerminal) {
        updateShellIntegrationStatus(activePanel);
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === codestoryTerminal) {
        codestoryTerminal = undefined;
        updateExecutionState(
          { isExecuting: false, hash: undefined },
          activePanel,
        );
        updateShellIntegrationStatus(activePanel);
      }
    }),
  );

  let disposable = vscode.commands.registerCommand(
    "codestory-view.start",
    async () => {
      if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.One);
        return;
      }

      activePanel = vscode.window.createWebviewPanel(
        "codestoryView",
        "Codestory View",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );

      activePanel.onDidDispose(() => {
        activePanel = undefined;
        if (repoWatcher) {
          repoWatcher.dispose();
          repoWatcher = undefined;
        }
        if (nonRepoWatcher) {
          nonRepoWatcher.dispose();
          nonRepoWatcher = undefined;
        }
      });

      activePanel.webview.html = getWebviewContent(
        activePanel.webview,
        context.extensionUri,
      );

      updateShellIntegrationStatus(activePanel);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const isRepo = await isGitRepo(workspacePath);
        if (isRepo) {
          await handleLoadRepo(
            activePanel,
            workspacePath,
            undefined,
            "initial",
          );
        }
      }

      activePanel.webview.onDidReceiveMessage(
        async (message) => {
          if (!activePanel) return;
          switch (message.command) {
            case "selectDirectory": {
              const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                openLabel: "Select Repository",
                canSelectFiles: false,
                canSelectFolders: true,
              };
              const fileUri = await vscode.window.showOpenDialog(options);
              if (fileUri && fileUri[0]) {
                activePanel.webview.postMessage({
                  command: "displayDirectory",
                  directory: fileUri[0].fsPath,
                });
              }
              return;
            }
            case "requestWorkspaceDirectory": {
              const folders = vscode.workspace.workspaceFolders;
              if (folders && folders.length > 0) {
                const workspacePath = folders[0].uri.fsPath;
                const isRepo = await isGitRepo(workspacePath);
                if (isRepo) {
                  activePanel.webview.postMessage({
                    command: "displayDirectory",
                    directory: workspacePath,
                  });
                }
              }
              return;
            }
            case "runTest":
              try {
                const directory = message.directory || "Not specified";
                const branch = message.branch;
                const executable = await getExecutablePath(
                  cstManager,
                  activePanel,
                );
                const configStr = await context.secrets.get(
                  "Codestory_global_config",
                );
                let apiKey: string | undefined;
                if (configStr) {
                  try {
                    apiKey = JSON.parse(configStr).api_key;
                  } catch (e) {}
                }
                await runCstInTerminal(
                  "Codestory Test",
                  directory,
                  executable,
                  ["-SL"],
                  context,
                  activePanel,
                  apiKey,
                  branch,
                  "TEST",
                );
              } catch (error) {
                updateExecutionState({ isExecuting: false });
                activePanel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;
            case "loadRepo":
              try {
                await handleLoadRepo(
                  activePanel,
                  message.directory,
                  message.branch,
                  message.source || "manual",
                  message.limit,
                );
              } catch (error) {
                activePanel.webview.postMessage({
                  command: "loadError",
                  message: (error as Error).message,
                });
              }
              return;
            case "fetchDiff":
              try {
                const diff = await fetchDiff(
                  message.repoPath,
                  message.commitHash,
                );
                activePanel.webview.postMessage({
                  command: "displayDiff",
                  diff,
                  commitHash: message.commitHash,
                });
              } catch (error) {}
              return;
            case "getGlobalConfig":
              const configStr = await context.secrets.get(
                "Codestory_global_config",
              );
              let config = {};
              if (configStr) {
                try {
                  config = JSON.parse(configStr);
                } catch (e) {}
              }
              const branchUpdateStrategy = vscode.workspace
                .getConfiguration("codestoryView")
                .get<string>("branchUpdateStrategy", "prompt");
              activePanel.webview.postMessage({
                command: "globalConfig",
                config,
                branchUpdateStrategy,
              });
              return;
            case "setBranchUpdateStrategy":
              await vscode.workspace
                .getConfiguration("codestoryView")
                .update(
                  "branchUpdateStrategy",
                  message.value,
                  vscode.ConfigurationTarget.Global,
                );
              return;
            case "setGlobalConfig":
              if (message.config) {
                await context.secrets.store(
                  "Codestory_global_config",
                  JSON.stringify(message.config),
                );
              } else {
                await context.secrets.delete("Codestory_global_config");
              }
              return;
            case "runCodestoryCommandCommit":
              try {
                await runCodestoryCommandCommit({
                  repoPath: message.repoPath,
                  branch: message.branch,
                  globalArgs: message.globalArgs,
                  commandArgs: message.commandArgs,
                  context,
                  cstManager,
                  panel: activePanel,
                });
              } catch (error) {
                updateExecutionState({ isExecuting: false });
                activePanel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;
            case "runCodestoryCommandFix":
              try {
                await runCodestoryCommandFix({
                  repoPath: message.repoPath,
                  branch: message.branch,
                  commandArgs: message.commandArgs,
                  globalArgs: message.globalArgs,
                  context,
                  cstManager,
                  panel: activePanel,
                });
              } catch (error) {
                updateExecutionState({ isExecuting: false });
                activePanel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;
            case "resetExecuting":
              updateExecutionState({ isExecuting: false, hash: undefined });
              return;
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  context.subscriptions.push(disposable);

  // --- Helpers for runCodestoryCommand ---
  async function runCodestoryCommandCommit(params: {
    repoPath: string;
    branch?: string;
    globalArgs?: Record<string, any>;
    commandArgs?: Record<string, any>;
    context: vscode.ExtensionContext;
    cstManager: CstManager;
    panel?: vscode.WebviewPanel;
  }) {
    const {
      repoPath,
      branch,
      globalArgs,
      commandArgs,
      context,
      cstManager,
      panel,
    } = params;
    const args = [...prepareGlobalArgs(globalArgs)];
    args.push("commit");
    if (commandArgs?.pathspec && Array.isArray(commandArgs.pathspec)) {
      args.push(...commandArgs.pathspec);
    }
    if (commandArgs?.message) args.push("-m", commandArgs.message);
    if (commandArgs?.intent) args.push("--intent", commandArgs.intent);
    const executable = await getExecutablePath(cstManager, panel);
    await runCstInTerminal(
      "Codestory: commit",
      repoPath,
      executable,
      args,
      context,
      panel,
      globalArgs?.api_key,
      branch,
      commandArgs?.commit_hash || "WORKING_DIR",
    );
  }

  async function runCodestoryCommandFix(params: {
    repoPath: string;
    branch?: string;
    commandArgs?: Record<string, any>;
    globalArgs?: Record<string, any>;
    context: vscode.ExtensionContext;
    cstManager: CstManager;
    panel?: vscode.WebviewPanel;
  }) {
    const {
      repoPath,
      branch,
      commandArgs,
      globalArgs,
      context,
      cstManager,
      panel,
    } = params;
    const args = [...prepareGlobalArgs(globalArgs)];
    args.push("fix");
    const commitHash = commandArgs?.commit_hash;
    if (commitHash) args.push(commitHash);
    if (commandArgs?.message) args.push("-m", commandArgs.message);
    const executable = await getExecutablePath(cstManager, panel);
    await runCstInTerminal(
      "Codestory: fix",
      repoPath,
      executable,
      args,
      context,
      panel,
      globalArgs?.api_key,
      branch,
      commitHash,
    );
  }

  function prepareGlobalArgs(globalArgs?: Record<string, any>): string[] {
    if (!globalArgs) return [];
    const args: string[] = [];
    const GLOBAL_ARG_CLI_MAP: Record<string, string> = {
      model: "--model",
      api_base: "--api-base",
      temperature: "--temperature",
      max_tokens: "--max-tokens",
      relevance_filtering: "--relevance-filtering",
      verbose: "--verbose",
      auto_accept: "--yes",
    };
    for (const key of Object.keys(globalArgs)) {
      const value = globalArgs[key];
      if (value === undefined || value === null || value === "") continue;
      const cliFlag = GLOBAL_ARG_CLI_MAP[key];
      if (!cliFlag) continue;
      if (typeof value === "boolean") {
        if (value) args.push(cliFlag);
        continue;
      }
      args.push(cliFlag, String(value));
    }
    return args;
  }
}

export function deactivate() { }

async function getExecutablePath(
  cstManager: CstManager,
  panel?: vscode.WebviewPanel,
): Promise<string> {
  const resolvedPath = await cstManager.get_exe((status) => {
    if (panel) {
      panel.webview.postMessage({ command: "cstStatus", status });
    }
  });
  return resolvedPath || "cst";
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.css"),
  );
  const baseUri =
    webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview"))
      .toString() + "/";
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';">
    <base href="${baseUri}">
    <link rel="stylesheet" type="text/css" href="${styleUri}">
    <title>Codestory View</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

async function runCstInTerminal(
  name: string,
  cwd: string,
  executable: string,
  args: string[],
  context: vscode.ExtensionContext,
  panel?: vscode.WebviewPanel,
  apiKey?: string,
  branch?: string,
  hash?: string,
): Promise<void> {
  if (currentExecutionState.isExecuting) {
    vscode.window.showWarningMessage(
      `A command (${currentExecutionState.name || "Codestory"}) is already running.`,
    );
    return;
  }

  const updateState = (state: Partial<typeof currentExecutionState>) => {
    currentExecutionState = { ...currentExecutionState, ...state };
    if (panel) {
      panel.webview.postMessage({
        command: "executionState",
        state: currentExecutionState,
      });
    }
  };

  updateState({ isExecuting: true, hash, name, cwd });

  const config = vscode.workspace.getConfiguration(
    "terminal.integrated.shellIntegration",
  );
  if (!config.get<boolean>("enabled")) {
    vscode.window.showErrorMessage(
      "Codestory requires VS Code Shell Integration to be enabled.",
    );
    updateState({ isExecuting: false });
    return;
  }

  try {
    let configPath: string | undefined;
    if (apiKey) {
      const configContent = `api_key = "${apiKey}"\n`;
      const storagePath = context.globalStorageUri.fsPath;
      if (!fs.existsSync(storagePath))
        fs.mkdirSync(storagePath, { recursive: true });
      configPath = path.join(storagePath, ".codestory.toml");
      fs.writeFileSync(configPath, configContent);
    }

    if (
      !codestoryTerminal ||
      codestoryTerminal.exitStatus !== undefined ||
      !codestoryTerminal.shellIntegration ||
      (codestoryTerminal as any)._lastCstCwd !== cwd
    ) {
      if (codestoryTerminal) codestoryTerminal.dispose();
      codestoryTerminal = vscode.window.createTerminal({
        name: "Codestory",
        cwd: cwd,
      });
      (codestoryTerminal as any)._lastCstCwd = cwd;
    }

    codestoryTerminal.show();

    if (!codestoryTerminal.shellIntegration) {
      await new Promise<void>((resolve) => {
        const disposable = vscode.window.onDidChangeTerminalShellIntegration(
          (e) => {
            if (e.terminal === codestoryTerminal) {
              disposable.dispose();
              resolve();
            }
          },
        );
        setTimeout(() => {
          disposable.dispose();
          resolve();
        }, 5000);
      });
    }

    if (!codestoryTerminal.shellIntegration) {
      vscode.window.showErrorMessage("Failed to activate Shell Integration.");
      updateState({ isExecuting: false });
      return;
    }

    const shell = (vscode.env.shell || "").toLowerCase();
    const isPowerShell = shell.includes("powershell") || shell.includes("pwsh");
    const finalArgs = ["--repo", cwd];
    if (configPath) finalArgs.push("--custom-config", configPath);
    if (branch && branch !== "(not on a branch)")
      finalArgs.push("--branch", branch);
    finalArgs.push(...args);

    const escapeArg = (arg: string): string => {
      const needsQuoting = /[\s"'&|<>^$`!;(){}[\]*?~]/.test(arg);
      if (!needsQuoting) return arg;
      if (isPowerShell) return `'${arg.replace(/'/g, "''")}'`;
      else return `'${arg.replace(/'/g, "'\\''")}'`;
    };

    const fullCommand = isPowerShell
      ? `& '${executable}' ${finalArgs.map(escapeArg).join(" ")}`
      : `'${executable}' ${finalArgs.map(escapeArg).join(" ")}`;

    const execution =
      codestoryTerminal.shellIntegration.executeCommand(fullCommand);
    updateState({ execution });
  } catch (error) {
    updateState({ isExecuting: false, execution: undefined });
    throw error;
  }
}
