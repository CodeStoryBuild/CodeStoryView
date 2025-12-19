import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { fetchCommits, fetchBranches, fetchDiff, isGitRepo } from './git/git-logic';
import { CstManager } from './cst-manager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Codestory View extension is now active!');

    const cstManager = new CstManager(context);

    let activePanel: vscode.WebviewPanel | undefined;

    let disposable = vscode.commands.registerCommand('codestory-view.start', async () => {
        const panel = vscode.window.createWebviewPanel(
            'codestory-view',
            'Codestory View',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        activePanel = panel;
        panel.onDidDispose(() => {
            if (activePanel === panel) {
                activePanel = undefined;
            }
        }, null, context.subscriptions);

        panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

        // Send initial workspace directory if available and it's a git repo
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            isGitRepo(workspacePath).then(isRepo => {
                if (isRepo) {
                    panel.webview.postMessage({
                        command: 'displayDirectory',
                        directory: workspacePath
                    });
                }
            });
        }

        // Map of global arg keys to CLI flags. Add mappings here as the protocol grows.
        const GLOBAL_ARG_CLI_MAP: Record<string, string> = {
            model: '--model',
            api_key: '--api-key',
            // provider could be used separately in the future
        };

        // Convert a small "globalArgs" object into an argv array of global CLI args.
        // - Booleans are emitted as flags when true
        // - Arrays are repeated
        // - Unknown keys are ignored (silently), for forward compatibility
        const prepareGlobalArgs = (globalArgs?: Record<string, any>): string[] => {
            if (!globalArgs) return [];
            const args: string[] = [];

            for (const key of Object.keys(globalArgs)) {
                const value = globalArgs[key];
                if (value === undefined || value === null || value === '') continue;
                const cliFlag = GLOBAL_ARG_CLI_MAP[key];
                if (!cliFlag) continue; // unknown mapping - skip to remain extensible

                if (typeof value === 'boolean') {
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

        const runVibeCommandCommit = async (params: { repoPath: string; globalArgs?: Record<string, any>; commandArgs?: Record<string, any> }) => {
            const { repoPath, globalArgs } = params;
            if (!repoPath) throw new Error('Repository path is required for commit command');

            // Global args first, then the subcommand. Commit currently takes no command-specific args.
            const args = [...prepareGlobalArgs(globalArgs)];
            args.push('commit');

            panel.webview.postMessage({ command: 'displayOutput', data: `Executing: cst ${args.join(' ')}` });

            const executable = await getExecutablePath(cstManager, panel);
            await runCstInTerminal(`Codestory: commit`, repoPath, executable, args, panel);
        };

        const runVibeCommandFix = async (params: { repoPath: string; commandArgs?: Record<string, any>; globalArgs?: Record<string, any> }) => {
            const { repoPath, commandArgs, globalArgs } = params;
            if (!repoPath) throw new Error('Repository path is required for fix command');

            // Subcommand is implied by the message type; default to 'fix'.
            const subcommand = 'fix';

            // Start with global args, then the subcommand, and then command-specific args in the order desired for this command.
            const args = [...prepareGlobalArgs(globalArgs)];
            args.push(subcommand);

            // Command-specific expansion: for fix/expand commands, a commit_hash is a positional arg after the subcommand.
            const commitHash = commandArgs?.commit_hash;
            if (commitHash) args.push(commitHash);

            panel.webview.postMessage({ command: 'displayOutput', data: `Executing: cst ${args.join(' ')}` });

            const executable = await getExecutablePath(cstManager, panel);
            await runCstInTerminal(`Codestory: ${subcommand}`, repoPath, executable, args, panel);
        };

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'selectDirectory':
                        const options: vscode.OpenDialogOptions = {
                            canSelectMany: false,
                            openLabel: 'Select Repository',
                            canSelectFiles: false,
                            canSelectFolders: true
                        };

                        const fileUri = await vscode.window.showOpenDialog(options);
                        if (fileUri && fileUri[0]) {
                            panel.webview.postMessage({
                                command: 'displayDirectory',
                                directory: fileUri[0].fsPath
                            });
                        }
                        return;

                    case 'requestWorkspaceDirectory':
                        {
                            const folders = vscode.workspace.workspaceFolders;
                            if (folders && folders.length > 0) {
                                const workspacePath = folders[0].uri.fsPath;
                                const isRepo = await isGitRepo(workspacePath);
                                if (isRepo) {
                                    panel.webview.postMessage({
                                        command: 'displayDirectory',
                                        directory: workspacePath
                                    });
                                }
                            }
                        }
                        return;

                    case 'runTest':
                        try {
                            const directory = message.directory || 'Not specified';
                            const command = '-SL';
                            const executable = await getExecutablePath(cstManager, panel);
                            
                            await runCstInTerminal(
                                "Codestory Test",
                                directory,
                                executable,
                                [command],
                                panel
                            );
                        } catch (error) {
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Error: ${(error as Error).message}` 
                            });
                        }
                        return;

                    case 'loadRepo':
                        try {
                            const repoPath = message.directory;
                            const branch = message.branch || 'HEAD';
                            if (!repoPath) {
                                throw new Error("Please specify a directory path.");
                            }

                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Loading repository: ${repoPath} (branch: ${branch})` 
                            });

                            // Fetch branches first
                            const branches = await fetchBranches(repoPath);
                            panel.webview.postMessage({ command: 'displayBranches', branches });

                            // Fetch commits
                            const commits = await fetchCommits(repoPath, branch);
                            panel.webview.postMessage({ command: 'displayCommits', commits });
                            
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Successfully loaded ${commits.length} commits.` 
                            });
                        } catch (error) {
                            panel.webview.postMessage({ 
                                command: 'loadError', 
                                message: (error as Error).message 
                            });
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Error: ${(error as Error).message}` 
                            });
                        }
                        return;

                    case 'fetchDiff':
                        try {
                            const { repoPath, commitHash } = message;
                            const diff = await fetchDiff(repoPath, commitHash);
                            panel.webview.postMessage({ command: 'displayDiff', diff, commitHash });
                        } catch (error) {
                            console.error('Failed to fetch diff:', error);
                        }
                        return;

                    case 'getApiKey':
                        const apiKey = await context.secrets.get('vibe_api_key');
                        panel.webview.postMessage({ command: 'apiKey', key: apiKey });
                        return;

                    case 'setApiKey':
                        if (message.key) {
                            await context.secrets.store('vibe_api_key', message.key);
                        } else {
                            await context.secrets.delete('vibe_api_key');
                        }
                        return;

                    case 'runVibeCommandCommit':
                        try {
                            const { repoPath, globalArgs, commandArgs } = message;
                            await runVibeCommandCommit({ repoPath, globalArgs, commandArgs });
                        } catch (error) {
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Error: ${(error as Error).message}` 
                            });
                        }
                        return;

                    case 'runVibeCommandFix':
                        try {
                            const { repoPath, globalArgs, commandArgs } = message;
                            await runVibeCommandFix({ repoPath, commandArgs, globalArgs });
                        } catch (error) {
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Error: ${(error as Error).message}` 
                            });
                        }
                        return;
                }
            },
            undefined,
            context.subscriptions
        );
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }

async function getExecutablePath(cstManager: CstManager, panel?: vscode.WebviewPanel): Promise<string> {
    const config = vscode.workspace.getConfiguration('codestoryView');
    const customPath = config.get<string>('executablePath');
    if (customPath && customPath.trim().length > 0) {
        return customPath;
    }
    
    const resolvedPath = await cstManager.get_exe((status) => {
        if (panel) {
            panel.webview.postMessage({ command: 'cstStatus', status });
        }
    });
    return resolvedPath || 'cst';
}

async function runCstTool(cstManager: CstManager, args: string[]): Promise<string> {
    const executable = await getExecutablePath(cstManager);
    return new Promise((resolve, reject) => {
        cp.exec(`"${executable}" ${args.join(' ')}`, (err, stdout, stderr) => {
            if (err) {
                if ((err as any).code === 127 || (err as any).code === 'ENOENT' || stderr.includes('not recognized')) {
                    vscode.window.showErrorMessage(
                        `Could not find 'cst' executable. Is it installed?`,
                        'Open Settings'
                    ).then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'codestoryView.executablePath');
                        }
                    });
                    reject(new Error("Codestory not found"));
                    return;
                }
                vscode.window.showErrorMessage(`Codestory Error: ${stderr || err.message}`);
                reject(err);
                return;
            }
            resolve(stdout);
        });
    });
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.css'));

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
    panel?: vscode.WebviewPanel
): Promise<void> {
    return new Promise((resolve) => {
        const writeEmitter = new vscode.EventEmitter<string>();
        let stderr = '';
        
        const pty: vscode.Pseudoterminal = {
            onDidWrite: writeEmitter.event,
            open: () => {
                writeEmitter.fire(`> Executing: ${executable} ${args.join(' ')}\r\n\r\n`);
                
                const child = cp.spawn(`"${executable}"`, args, { 
                    cwd, 
                    shell: true,
                    env: { ...process.env }
                });

                child.stdout.on('data', (data) => {
                    writeEmitter.fire(data.toString().replace(/\r?\n/g, '\r\n'));
                });

                child.stderr.on('data', (data) => {
                    const str = data.toString();
                    stderr += str;
                    writeEmitter.fire(str.replace(/\r?\n/g, '\r\n'));
                });

                child.on('close', (code) => {
                    writeEmitter.fire(`\r\nProcess exited with code ${code}\r\n`);
                    if (code !== 0) {
                        const truncatedStderr = stderr.length > 500 ? stderr.substring(0, 500) + '...' : stderr;
                        vscode.window.showWarningMessage(`Codestory command failed (code ${code}): ${truncatedStderr}`);
                        if (panel) {
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Command failed with code: ${code}` 
                            });
                        }
                    } else {
                        if (panel) {
                            panel.webview.postMessage({ 
                                command: 'displayOutput', 
                                data: `Command finished successfully. Refreshing graph...` 
                            });
                            panel.webview.postMessage({ command: 'refreshGraph' });
                        }
                    }
                    resolve();
                });
            },
            close: () => {}
        };

        const terminal = vscode.window.createTerminal({ name, pty });
        terminal.show();
    });
}
