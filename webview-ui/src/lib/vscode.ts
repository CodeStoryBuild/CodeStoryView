interface WebviewApi<T = unknown> {
  postMessage(message: T): void;
  getState(): T | undefined;
  setState(state: T): void;
}

declare const acquireVsCodeApi: (() => WebviewApi<unknown>) | undefined;

/**
 * A utility wrapper around the acquireVsCodeApi() function, which allows
 * us to easily communicate between the webview and the extension.
 */
class VSCodeAPI {
  private readonly vscodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current development
    // environment (it only exists in the VS Code webview context)
    if (typeof acquireVsCodeApi === "function") {
      this.vscodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the extension context.
   *
   * @param message The message to post to the extension context.
   */
  public postMessage(message: any) {
    if (this.vscodeApi) {
      this.vscodeApi.postMessage(message);
    } else {
      console.log(message);
    }
  }

  /**
   * Get the current state of the webview.
   *
   * @returns The current state of the webview.
   */
  public getState(): any {
    if (this.vscodeApi) {
      return this.vscodeApi.getState();
    } else {
      const state = localStorage.getItem("vscodeState");
      return state ? JSON.parse(state) : undefined;
    }
  }

  /**
   * Set the state of the webview.
   *
   * @param newState The new state of the webview.
   */
  public setState(newState: any) {
    if (this.vscodeApi) {
      this.vscodeApi.setState(newState);
    } else {
      localStorage.setItem("vscodeState", JSON.stringify(newState));
    }
  }
}

// Export a single instance of the VSCodeAPI class
export const getVsCodeApi = (() => {
  let instance: VSCodeAPI | undefined;
  return () => {
    if (!instance) {
      instance = new VSCodeAPI();
    }
    return instance;
  };
})();
