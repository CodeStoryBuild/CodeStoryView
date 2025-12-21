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
} from "./git/git-logic";
import { CstManager } from "./cst-manager";

let codestoryTerminal: vscode.Terminal | undefined;
let isExecuting = false;

export function activate(context: vscode.ExtensionContext) {
  console.log("Codestory View extension is now active!");

  const cstManager = new CstManager(context);

  let activePanel: vscode.WebviewPanel | undefined;
  let repoWatcher: vscode.FileSystemWatcher | undefined;
  let nonRepoWatcher: vscode.FileSystemWatcher | undefined;
  let watchedRepoPath: string | undefined;
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

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution(async (e) => {
      if (!e.shellIntegration) return;
      if (e.terminal === codestoryTerminal) {
        isExecuting = false;
        if (activePanel) {
          if (e.exitCode === 0) {
            activePanel.webview.postMessage({
              command: "displayOutput",
              data: `Command finished successfully. Refreshing graph...`,
            });
          } else {
            activePanel.webview.postMessage({
              command: "displayOutput",
              data: `Command failed with code ${e.exitCode}`,
            });
          }
          activePanel.webview.postMessage({ command: "refreshGraph" });
          activePanel.webview.postMessage({ command: "resetExecuting" });
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === codestoryTerminal) {
        codestoryTerminal = undefined;
        isExecuting = false;
        if (activePanel) {
          activePanel.webview.postMessage({ command: "resetExecuting" });
        }
      }
    }),
  );

  let disposable = vscode.commands.registerCommand(
    "codestory-view.start",
    async () => {
      const panel = vscode.window.createWebviewPanel(
        "codestory-view",
        "Codestory View",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      activePanel = panel;
      panel.onDidDispose(
        () => {
          if (activePanel === panel) {
            activePanel = undefined;
          }
          if (repoWatcher) {
            repoWatcher.dispose();
            repoWatcher = undefined;
            watchedRepoPath = undefined;
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
        },
        null,
        context.subscriptions,
      );

      panel.webview.html = getWebviewContent(
        panel.webview,
        context.extensionUri,
      );

      // Send initial workspace directory if available and it's a git repo
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspacePath = workspaceFolders[0].uri.fsPath;
        isGitRepo(workspacePath).then((isRepo) => {
          if (isRepo) {
            panel.webview.postMessage({
              command: "displayDirectory",
              directory: workspacePath,
            });
          }
        });
      }

      // Map of global arg keys to CLI flags. Add mappings here as the protocol grows.
      const GLOBAL_ARG_CLI_MAP: Record<string, string> = {
        model: "--model",
        api_base: "--api-base",
        temperature: "--temperature",
        max_tokens: "--max-tokens",
        relevance_filter_level: "--relevance-filter-level",
        secret_scanner_aggression: "--secret-scanner-aggression",
        fallback_grouping_strategy: "--fallback-grouping-strategy",
        chunking_level: "--chunking-level",
        verbose: "--verbose",
        auto_accept: "--yes",
        silent: "--silent",
        ask_for_commit_message: "--ask-for-commit-message",
        display_diff_type: "--display-diff-type",
        custom_language_config: "--custom-language-config",
        batching_strategy: "--batching-strategy",
        custom_embedding_model: "--custom-embedding-model",
        cluster_strictness: "--cluster-strictness",
        num_retries: "--num-retries",
      };

      // Convert a small "globalArgs" object into an argv array of global CLI args.
      // - Booleans are emitted as flags when true
      // - Arrays are repeated
      // - Unknown keys are ignored (silently), for forward compatibility
      const prepareGlobalArgs = (
        globalArgs?: Record<string, any>,
      ): string[] => {
        if (!globalArgs) return [];
        const args: string[] = [];

        for (const key of Object.keys(globalArgs)) {
          const value = globalArgs[key];
          if (value === undefined || value === null || value === "") continue;
          const cliFlag = GLOBAL_ARG_CLI_MAP[key];
          if (!cliFlag) continue; // unknown mapping - skip to remain extensible

          if (typeof value === "boolean") {
            if (value) args.push(cliFlag);
            continue;
          }

          if (Array.isArray(value)) {
            for (const v of value) {
              args.push(cliFlag, String(v));
            }
            continue;
          }

          args.push(cliFlag, String(value));
        }

        return args;
      };

      const runVibeCommandCommit = async (params: {
        repoPath: string;
        branch?: string;
        globalArgs?: Record<string, any>;
        commandArgs?: Record<string, any>;
      }) => {
        const { repoPath, branch, globalArgs, commandArgs } = params;
        if (!repoPath)
          throw new Error("Repository path is required for commit command");

        // Global args first, then the subcommand.
        const args = [...prepareGlobalArgs(globalArgs)];
        args.push("commit");

        // Add guidance message if present
        if (commandArgs?.message) {
          args.push("-m", commandArgs.message);
        }

        // Add intent if present
        if (commandArgs?.intent) {
          args.push("--intent", commandArgs.intent);
        }

        panel.webview.postMessage({
          command: "displayOutput",
          data: `Executing: cst ${args.join(" ")}`,
        });

        const executable = await getExecutablePath(cstManager, panel);
        await runCstInTerminal(
          `Codestory: commit`,
          repoPath,
          executable,
          args,
          context,
          panel,
          globalArgs?.api_key,
          branch,
        );
      };

      const runVibeCommandFix = async (params: {
        repoPath: string;
        branch?: string;
        commandArgs?: Record<string, any>;
        globalArgs?: Record<string, any>;
      }) => {
        const { repoPath, branch, commandArgs, globalArgs } = params;
        if (!repoPath)
          throw new Error("Repository path is required for fix command");

        // Subcommand is implied by the message type; default to 'fix'.
        const subcommand = "fix";

        // Start with global args, then the subcommand, and then command-specific args in the order desired for this command.
        const args = [...prepareGlobalArgs(globalArgs)];
        args.push(subcommand);

        // Command-specific expansion: for fix/expand commands, a commit_hash is a positional arg after the subcommand.
        const commitHash = commandArgs?.commit_hash;
        if (commitHash) args.push(commitHash);

        panel.webview.postMessage({
          command: "displayOutput",
          data: `Executing: cst ${args.join(" ")}`,
        });

        const executable = await getExecutablePath(cstManager, panel);
        await runCstInTerminal(
          `Codestory: ${subcommand}`,
          repoPath,
          executable,
          args,
          context,
          panel,
          globalArgs?.api_key,
          branch,
        );
      };

      // Helper to (re)load repository and manage watchers.
      async function handleLoadRepo(
        panel: vscode.WebviewPanel,
        repoPath: string,
        branch?: string,
        isManual = true,
      ) {
        if (!repoPath) throw new Error("Please specify a directory path.");

        // Setup file system watchers if path changed
        if (watchedRepoPath !== repoPath) {
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

          // Watch for any changes in the .git directory (to trigger an automatic refresh)
          const gitPattern = new vscode.RelativePattern(repoPath, ".git/**");
          repoWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);

          const refresh = () => {
            if (debounceTimer) {
              clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
              if (activePanel) {
                activePanel.webview.postMessage({ command: "refreshGraph" });
              }
            }, 1000); // 1 second debounce
          };

          repoWatcher.onDidChange(refresh);
          repoWatcher.onDidCreate(refresh);
          repoWatcher.onDidDelete(refresh);

          // Watch for changes outside of .git and show a small 'reload' notification
          // Only setup if not ignored by user
          const ignoreNotifications = context.globalState.get<boolean>(
            "codestory.ignoreFileChangeNotifications",
            false,
          );

          if (!ignoreNotifications) {
            const allPattern = new vscode.RelativePattern(repoPath, "**");
            nonRepoWatcher =
              vscode.workspace.createFileSystemWatcher(allPattern);

            const nonRepoRefresh = (uri?: vscode.Uri) => {
              const fsPath = uri?.fsPath || repoPath;
              // If the change is inside .git, ignore it here
              const rel = path.relative(repoPath, fsPath);
              if (rel.split(path.sep)[0] === ".git") return;

              if (nonRepoDebounceTimer) {
                clearTimeout(nonRepoDebounceTimer);
              }

              nonRepoDebounceTimer = setTimeout(async () => {
                // Only show notification when the panel is open
                if (!activePanel) return;

                // Re-check in case it was changed while debouncing
                if (
                  context.globalState.get<boolean>(
                    "codestory.ignoreFileChangeNotifications",
                    false,
                  )
                ) {
                  return;
                }

                const selection = await vscode.window.showInformationMessage(
                  "File changes detected outside .git. Reload?",
                  "Reload",
                  "Don't show again",
                );

                if (selection === "Reload") {
                  // Trigger a manual reload just like clicking the branch reload button
                  // Use last known branch if available
                  const branchToUse =
                    lastState?.currentBranch || branch || "HEAD";
                  await handleLoadRepo(panel, repoPath, branchToUse, true);
                } else if (selection === "Don't show again") {
                  await context.globalState.update(
                    "codestory.ignoreFileChangeNotifications",
                    true,
                  );
                  // Dispose watcher since we won't need it anymore
                  if (nonRepoWatcher) {
                    nonRepoWatcher.dispose();
                    nonRepoWatcher = undefined;
                  }
                }
              }, 1000);
            };

            nonRepoWatcher.onDidChange(nonRepoRefresh);
            nonRepoWatcher.onDidCreate(nonRepoRefresh);
            nonRepoWatcher.onDidDelete(nonRepoRefresh);
          }

          watchedRepoPath = repoPath;
          lastState = undefined;
        }

        // Fetch branches and commits as before
        const branches = await fetchBranches(repoPath);
        let currentBranch = await getCurrentBranch(repoPath);
        const isDetached = currentBranch === "(not on a branch)";

        if (isDetached && branches.length > 0) {
          currentBranch = branches[0];
        }

        const commits = await fetchCommits(repoPath, branch || "HEAD");

        const newState = {
          branches,
          currentBranch,
          isDetached,
          commits,
        };

        const stateChanged =
          !lastState ||
          JSON.stringify(lastState.branches) !==
            JSON.stringify(newState.branches) ||
          lastState.currentBranch !== newState.currentBranch ||
          lastState.isDetached !== newState.isDetached ||
          JSON.stringify(lastState.commits) !==
            JSON.stringify(newState.commits);

        if (!isManual && !stateChanged) {
          // No changes and not a manual refresh, skip updating webview
          return;
        }

        lastState = newState;

        panel.webview.postMessage({
          command: "displayOutput",
          data: `Loading repository: ${repoPath} (branch: ${branch || "HEAD"})`,
        });

        panel.webview.postMessage({
          command: "displayBranches",
          branches,
          currentBranch,
          isDetached,
          shouldUpdate: !branch,
          isManual: isManual,
        });

        panel.webview.postMessage({
          command: "displayCommits",
          commits,
        });

        panel.webview.postMessage({
          command: "displayOutput",
          data: `Successfully loaded ${commits.length} commits.`,
        });
      }

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "selectDirectory":
              const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                openLabel: "Select Repository",
                canSelectFiles: false,
                canSelectFolders: true,
              };

              const fileUri = await vscode.window.showOpenDialog(options);
              if (fileUri && fileUri[0]) {
                panel.webview.postMessage({
                  command: "displayDirectory",
                  directory: fileUri[0].fsPath,
                });
              }
              return;

            case "requestWorkspaceDirectory":
              {
                const folders = vscode.workspace.workspaceFolders;
                if (folders && folders.length > 0) {
                  const workspacePath = folders[0].uri.fsPath;
                  const isRepo = await isGitRepo(workspacePath);
                  if (isRepo) {
                    panel.webview.postMessage({
                      command: "displayDirectory",
                      directory: workspacePath,
                    });
                  }
                }
              }
              return;

            case "runTest":
              try {
                const directory = message.directory || "Not specified";
                const branch = message.branch;
                const command = "-SL";
                const executable = await getExecutablePath(cstManager, panel);

                const configStr =
                  await context.secrets.get("vibe_global_config");
                let apiKey: string | undefined;
                if (configStr) {
                  try {
                    const config = JSON.parse(configStr);
                    apiKey = config.api_key;
                  } catch (e) {}
                }

                await runCstInTerminal(
                  "Codestory Test",
                  directory,
                  executable,
                  [command],
                  context,
                  panel,
                  apiKey,
                  branch,
                );
              } catch (error) {
                isExecuting = false;
                panel.webview.postMessage({ command: "resetExecuting" });
                panel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;

            case "loadRepo":
              // Delegate to helper so other places can trigger the same behavior
              try {
                await handleLoadRepo(
                  panel,
                  message.directory,
                  message.branch,
                  message.isManual !== false,
                );
              } catch (error) {
                panel.webview.postMessage({
                  command: "loadError",
                  message: (error as Error).message,
                });
                panel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;

            case "fetchDiff":
              try {
                const { repoPath, commitHash } = message;
                const diff = await fetchDiff(repoPath, commitHash);
                panel.webview.postMessage({
                  command: "displayDiff",
                  diff,
                  commitHash,
                });
              } catch (error) {
                console.error("Failed to fetch diff:", error);
              }
              return;

            case "getGlobalConfig":
              const configStr = await context.secrets.get("vibe_global_config");
              let config = {};
              if (configStr) {
                try {
                  config = JSON.parse(configStr);
                } catch (e) {
                  console.error("Failed to parse global config", e);
                }
              }
              const ignoreBranchPrompt = context.globalState.get<boolean>(
                "codestory.ignoreBranchPrompt",
                false,
              );
              panel.webview.postMessage({
                command: "globalConfig",
                config,
                ignoreBranchPrompt,
              });
              return;

            case "setIgnoreBranchPrompt":
              await context.globalState.update(
                "codestory.ignoreBranchPrompt",
                message.value,
              );
              return;

            case "setGlobalConfig":
              if (message.config) {
                await context.secrets.store(
                  "vibe_global_config",
                  JSON.stringify(message.config),
                );
              } else {
                await context.secrets.delete("vibe_global_config");
              }
              return;

            case "runVibeCommandCommit":
              try {
                const { repoPath, branch, globalArgs, commandArgs } = message;
                await runVibeCommandCommit({
                  repoPath,
                  branch,
                  globalArgs,
                  commandArgs,
                });
              } catch (error) {
                isExecuting = false;
                panel.webview.postMessage({ command: "resetExecuting" });
                panel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;

            case "runVibeCommandFix":
              try {
                const { repoPath, branch, globalArgs, commandArgs } = message;
                await runVibeCommandFix({
                  repoPath,
                  branch,
                  commandArgs,
                  globalArgs,
                });
              } catch (error) {
                isExecuting = false;
                panel.webview.postMessage({ command: "resetExecuting" });
                panel.webview.postMessage({
                  command: "displayOutput",
                  data: `Error: ${(error as Error).message}`,
                });
              }
              return;

            case "resetExecuting":
              isExecuting = false;
              return;
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

async function getExecutablePath(
  cstManager: CstManager,
  panel?: vscode.WebviewPanel,
): Promise<string> {
  const config = vscode.workspace.getConfiguration("codestoryView");
  const customPath = config.get<string>("executablePath");
  if (customPath && customPath.trim().length > 0) {
    return customPath;
  }

  const resolvedPath = await cstManager.get_exe((status) => {
    if (panel) {
      panel.webview.postMessage({ command: "cstStatus", status });
    }
  });
  return resolvedPath || "cst";
}

async function runCstTool(
  cstManager: CstManager,
  args: string[],
): Promise<string> {
  const executable = await getExecutablePath(cstManager);
  return new Promise((resolve, reject) => {
    cp.exec(`"${executable}" ${args.join(" ")}`, (err, stdout, stderr) => {
      if (err) {
        if (
          (err as any).code === 127 ||
          (err as any).code === "ENOENT" ||
          stderr.includes("not recognized")
        ) {
          vscode.window
            .showErrorMessage(
              `Could not find 'cst' executable. Is it installed?`,
              "Open Settings",
            )
            .then((selection) => {
              if (selection === "Open Settings") {
                vscode.commands.executeCommand(
                  "workbench.action.openSettings",
                  "codestoryView.executablePath",
                );
              }
            });
          reject(new Error("Codestory not found"));
          return;
        }
        vscode.window.showErrorMessage(
          `Codestory Error: ${stderr || err.message}`,
        );
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.css"),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
): Promise<void> {
  if (isExecuting) {
    vscode.window.showWarningMessage(
      "A Codestory command is already running in the terminal.",
    );
    return Promise.resolve();
  }

  try {
    let configPath: string | undefined;
    if (apiKey) {
      const configContent = `api_key = "${apiKey}"\n`;
      const storagePath = context.globalStorageUri.fsPath;
      if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
      }
      configPath = path.join(storagePath, ".codestory.toml");
      fs.writeFileSync(configPath, configContent);
    }

    if (!codestoryTerminal || codestoryTerminal.exitStatus !== undefined) {
      codestoryTerminal = vscode.window.createTerminal({
        name: "Codestory",
        cwd: cwd,
      });
    }

    codestoryTerminal.show();

    const shell = (vscode.env.shell || "").toLowerCase();
    const isPowerShell = shell.includes("powershell") || shell.includes("pwsh");

    // Prepend the --repo and --branch arguments to ensure the command runs against the correct directory
    // and branch without needing to 'cd' or 'checkout' first.
    const finalArgs = ["--repo", cwd];
    if (configPath) {
      finalArgs.push("--custom-config", configPath);
    }
    if (branch && branch !== "(not on a branch)") {
      finalArgs.push("--branch", branch);
    }
    finalArgs.push(...args);

    // Quote arguments that contain spaces to ensure they are parsed correctly across all shells.
    const escapedArgs = finalArgs.map((arg) =>
      arg.includes(" ") && !arg.startsWith('"') ? `"${arg}"` : arg,
    );
    const joinedArgs = escapedArgs.join(" ");

    // PowerShell requires the call operator '&' to execute a quoted path.
    // Other shells (Bash, CMD, Zsh) handle quoted paths directly.
    const fullCommand = isPowerShell
      ? `& "${executable}" ${joinedArgs}`
      : `"${executable}" ${joinedArgs}`;

    isExecuting = true;
    codestoryTerminal.sendText(fullCommand);
  } catch (error) {
    isExecuting = false;
    if (panel) {
      panel.webview.postMessage({ command: "resetExecuting" });
    }
    throw error;
  }

  // Resolve immediately to fix the "never finishing" issue.
  // The terminal will handle the execution and the listener we added in activate
  // will handle the completion logic (refreshing graph, etc.)
  return Promise.resolve();
}
