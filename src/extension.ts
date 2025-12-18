import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { fetchCommits, fetchBranches, fetchDiff } from './git/git-logic';

export function activate(context: vscode.ExtensionContext) {
    console.log('Codestory View extension is now active!');

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

        panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

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

                    case 'runTest':
                        try {
                            const directory = message.directory || 'Not specified';
                            console.log(`Received directory path: ${directory}`);
                            const command = '-SL';
                            panel.webview.postMessage({ command: 'displayOutput', data: `Directory: ${directory}\nRunning codestory ${command}...` });
                            const output = await runCstTool([command]);
                            panel.webview.postMessage({ command: 'displayOutput', data: `Success! Output:\n${output}` });
                        } catch (error) {
                            panel.webview.postMessage({ command: 'displayOutput', data: `Error: ${(error as Error).message}` });
                        }
                        return;

                    case 'loadRepo':
                        try {
                            const repoPath = message.directory;
                            const branch = message.branch || 'HEAD';
                            if (!repoPath) {
                                throw new Error("Please specify a directory path.");
                            }

                            // Fetch branches first
                            const branches = await fetchBranches(repoPath);
                            panel.webview.postMessage({ command: 'displayBranches', branches });

                            // Fetch commits
                            const commits = await fetchCommits(repoPath, branch);
                            panel.webview.postMessage({ command: 'displayCommits', commits });
                        } catch (error) {
                            panel.webview.postMessage({ command: 'displayOutput', data: `Error: ${(error as Error).message}` });
                        }
                        return;

                    case 'fetchDiff':
                        try {
                            const { repoPath, commitHash } = message;
                            const { fetchDiff } = require('./git/git-logic');
                            const diff = await fetchDiff(repoPath, commitHash);
                            panel.webview.postMessage({ command: 'displayDiff', diff, commitHash });
                        } catch (error) {
                            console.error('Failed to fetch diff:', error);
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

function getExecutablePath(): string {
    const config = vscode.workspace.getConfiguration('codestoryView');
    const customPath = config.get<string>('executablePath');
    return customPath && customPath.trim().length > 0 ? customPath : 'cst';
}

function runCstTool(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const executable = getExecutablePath();
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
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'index.css'));

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
