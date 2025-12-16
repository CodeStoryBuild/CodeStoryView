import * as vscode from 'vscode';
import * as cp from 'child_process'; // Native Node module to run executables

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension is now active!');

    // 1. Register the command defined in package.json
    let disposable = vscode.commands.registerCommand('codestory-view.start', async () => {

        // 2. Create the Webview Panel
        // This creates a dedicated tab in the editor for your visualizer.
        const panel = vscode.window.createWebviewPanel(
            'codestory-view', // Internal ID
            'Codestory View',    // Title shown to user
            vscode.ViewColumn.One, // Show in the first column
            {
                enableScripts: true // Allow JS in the webview (crucial for visualizations)
            }
        );

        // 3. Set initial HTML state (Loading...)
        panel.webview.html = getWebviewContent("Loading data from Codestory CLI...");

        try {
            // 4. Run the CLI Tool
            const output = await runCstTool([]);

            // 5. Success! Display the output.
            panel.webview.html = getWebviewContent(output);
        } catch (error) {
            // Handle errors
            panel.webview.html = getWebviewContent(`Error: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

// Helper to get the command or path
function getExecutablePath(): string {
	const config = vscode.workspace.getConfiguration('cstVisualizer');
	const customPath = config.get<string>('executablePath');

	// If user defined a path, use it. Otherwise, assume 'cst.exe' is in global PATH
	return customPath && customPath.trim().length > 0 ? customPath : 'cst';
}

function runCstTool(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const executable = getExecutablePath();

		// Spawn the process
        // shell: true is safer for resolving PATH on Windows
        cp.exec(`"${executable}" ${args.join(' ')}`, (err, stdout, stderr) => {
            if (err) {
                // ENOENT means "Error No Entry" (File not found)
                // This is how we know they don't have the CLI installed or path is wrong
                if ((err as any).code === 127 || (err as any).code === 'ENOENT' || stderr.includes('not recognized')) {
                    vscode.window.showErrorMessage(
                        `Could not find 'cst' executable. Is it installed?`,
                        'Open Settings',
                        'Download Tool'
                    ).then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'cstVisualizer.executablePath');
                        }
                        if (selection === 'Download Tool') {
                            vscode.env.openExternal(vscode.Uri.parse('https://your-website.com/download'));
                        }
                    });
                    reject(new Error("Codestory not found"));
                    return;
                }
                
                // Generic error (tool crashed)
                vscode.window.showErrorMessage(`CST Error: ${stderr || err.message}`);
                reject(err);
                return;
            }
            resolve(stdout);
        });
    });
}

// Helper function to generate the HTML
// In a real app, this might be a separate HTML file you load.

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: sans-serif; padding: 20px; }
            button { 
                padding: 10px 20px; 
                font-size: 16px; 
                cursor: pointer; 
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
            }
            #output {
                margin-top: 20px;
                padding: 10px;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                border: 1px solid var(--vscode-input-border);
                white-space: pre-wrap; /* Preserve newlines */
                font-family: monospace;
            }
        </style>
    </head>
    <body>
        <h1>Integration Test</h1>
        <p>Click below to run "cst --version"</p>
        
        <button id="testBtn">Test CLI Connection</button>
        
        <div id="output">Waiting for input...</div>

        <script>
            // 1. Get access to VS Code API
            const vscode = acquireVsCodeApi();

            // 2. Handle Button Click
            document.getElementById('testBtn').addEventListener('click', () => {
                document.getElementById('output').textContent = "Running command...";
                
                // Send message TO Extension
                vscode.postMessage({
                    command: 'runTest'
                });
            });

            // 3. Listen for messages FROM Extension
            window.addEventListener('message', event => {
                const message = event.data; // The JSON data our extension sent
                
                if (message.command === 'displayOutput') {
                    document.getElementById('output').textContent = message.data;
                }
            });
        </script>
    </body>
    </html>`;
}
