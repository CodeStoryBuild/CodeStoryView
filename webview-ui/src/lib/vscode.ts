interface WebviewApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

declare function acquireVsCodeApi(): WebviewApi;

let vscode: WebviewApi | undefined;

export function getVsCodeApi() {
    if (!vscode) {
        if (typeof acquireVsCodeApi === 'function') {
            vscode = acquireVsCodeApi();
        } else {
            // Mock for development in browser
            vscode = {
                postMessage: (msg) => console.log('VSCode PostMessage:', msg),
                getState: () => ({}),
                setState: (s) => console.log('VSCode SetState:', s)
            };
        }
    }
    return vscode;
}
