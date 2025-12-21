import { useState, useEffect, useCallback } from "react";
import { GitVisualizer } from "./components/GitVisualizer";
import { GitRepoSelector } from "./components/GitRepoSelector";
import { BranchSelector } from "./components/BranchSelector";
import { ApiKeyManager, ApiKeyManagerToggle } from "./components/ApiKeyManager";
import { getVsCodeApi } from "./lib/vscode";
import { Spinner } from "./components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";

function App() {
  const vscode = getVsCodeApi();
  const prevState = vscode.getState();

  const [repoPath, setRepoPath] = useState(prevState?.repoPath || "");
  const [draftRepoPath, setDraftRepoPath] = useState(prevState?.repoPath || "");
  const [branch, setBranch] = useState(prevState?.branch || "");
  const [branches, setBranches] = useState<string[]>([]);
  const [isDetached, setIsDetached] = useState(false);
  const [isLoaded, setIsLoaded] = useState(!!prevState?.repoPath);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cstStatus, setCstStatus] = useState<
    "idle" | "downloading" | "extracting" | "ready" | "error"
  >("idle");

  const [showApiManager, setShowApiManager] = useState(false);
  const [apiConfiguration, setApiConfiguration] = useState<{
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
  } | null>(null);

  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [lastPromptedBranch, setLastPromptedBranch] = useState<string | null>(
    prevState?.lastPromptedBranch || null,
  );
  const [selectedCommit, setSelectedCommit] = useState<any>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // Initialize API configuration from localStorage and extension SecretStorage
  useEffect(() => {
    const savedProvider = localStorage.getItem("vibe_selected_provider") || "";
    const savedModel = localStorage.getItem("vibe_selected_model") || "";

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "globalConfig") {
        const config = message.config || {};
        setApiConfiguration({
          provider: savedProvider,
          model: savedModel,
          globalConfig: config,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    // Ask the extension for the stored global config (SecretStorage)
    vscode.postMessage({ command: "getGlobalConfig" });

    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const handleRepoPathChange = (path: string) => {
    setDraftRepoPath(path);
    if (loadError) setLoadError(null);
  };

  useEffect(() => {
    // Sync theme with VS Code
    const updateTheme = () => {
      const isDark =
        document.body.classList.contains("vscode-dark") ||
        document.body.classList.contains("vscode-high-contrast");
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Request the workspace directory from the extension in case the extension's initial
  // postMessage fired before the webview finished mounting.
  useEffect(() => {
    vscode.postMessage({ command: "requestWorkspaceDirectory" });
  }, [vscode]);

  const handleLoadRepo = useCallback(
    (path: string) => {
      setRepoPath(path);
      setDraftRepoPath(path);
      setIsLoaded(true);
      setLoadError(null);
      setIsFirstLoad(true);
      vscode.setState({
        ...vscode.getState(),
        repoPath: path,
        branch,
        lastPromptedBranch,
      });
    },
    [branch, lastPromptedBranch, vscode],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "displayCommits":
          setLoadError(null);
          break;
        case "loadError":
          setLoadError(message.message || "Failed to load repository");
          setIsLoaded(false);
          break;
        case "displayBranches":
          if (message.branches) setBranches(message.branches);
          if (message.isDetached !== undefined)
            setIsDetached(message.isDetached);

          if (isFirstLoad && message.currentBranch) {
            setIsFirstLoad(false);
            setBranch(message.currentBranch);
            setLastPromptedBranch(message.currentBranch);
            vscode.setState({
              ...vscode.getState(),
              branch: message.currentBranch,
              lastPromptedBranch: message.currentBranch,
            });
            return;
          }

          if (
            !message.isManual &&
            message.currentBranch &&
            message.currentBranch !== branch &&
            message.currentBranch !== lastPromptedBranch &&
            branch !== "" &&
            !selectedCommit
          ) {
            setPendingBranch(message.currentBranch);
            setLastPromptedBranch(message.currentBranch);
            vscode.setState({
              ...vscode.getState(),
              lastPromptedBranch: message.currentBranch,
            });
          } else if (
            message.currentBranch &&
            (message.shouldUpdate || !branch)
          ) {
            setBranch(message.currentBranch);
            setLastPromptedBranch(message.currentBranch);
            vscode.setState({
              ...vscode.getState(),
              branch: message.currentBranch,
              lastPromptedBranch: message.currentBranch,
            });
          }
          break;
        case "displayDiff":
          // For now, log the diff. We could add a side panel or modal here.
          console.log("Received diff:", message.diff);
          break;
        case "displayDirectory":
          if (message.directory) {
            setDraftRepoPath(message.directory);
            // If we haven't loaded anything yet, try to load the workspace dir
            if (!repoPath) {
              handleLoadRepo(message.directory);
            }
          }
          break;
        case "refreshGraph":
          vscode.postMessage({
            command: "loadRepo",
            directory: repoPath,
            branch: branch,
            isManual: false,
          });
          break;
        case "cstStatus":
          setCstStatus(message.status);
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    handleLoadRepo,
    repoPath,
    branch,
    vscode,
    isFirstLoad,
    lastPromptedBranch,
    selectedCommit,
  ]);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Header / Top Bar */}
      {isLoaded && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-4 bg-card/80 backdrop-blur-md border border-border p-1 rounded-lg shadow-sm">
          <BranchSelector
            branches={
              branches.length > 0 ? branches : [branch || "(not on a branch)"]
            }
            selectedBranch={branch || "(not on a branch)"}
            isDetached={isDetached}
            onBranchSelect={(b) => {
              setBranch(b);
              setLastPromptedBranch(b);
              setSelectedCommit(null);
              vscode.setState({
                ...vscode.getState(),
                branch: b,
                lastPromptedBranch: b,
              });
            }}
            onReload={() => {
              vscode.postMessage({
                command: "loadRepo",
                directory: repoPath,
                branch: branch,
              });
            }}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 relative flex items-center justify-center">
        {!isLoaded ? (
          <GitRepoSelector
            repoPath={draftRepoPath}
            setRepoPath={handleRepoPathChange}
            onLoad={handleLoadRepo}
            error={loadError}
          />
        ) : (
          <GitVisualizer
            repoPath={repoPath}
            branch={branch}
            selectedCommit={selectedCommit}
            apiConfiguration={apiConfiguration}
            onOpenApiManager={() => setShowApiManager(true)}
            onCommitSelect={(commit) => {
              setSelectedCommit(commit);
              console.log("Selected commit:", commit);
              // Future: show diff/details
            }}
          />
        )}
      </main>

      <AlertDialog
        open={!!pendingBranch}
        onOpenChange={(open) => !open && setPendingBranch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Visualizer?</AlertDialogTitle>
            <AlertDialogDescription>
              Your local repository switched to branch{" "}
              <strong>{pendingBranch}</strong>. Would you like to update the
              visualizer to show this branch?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (pendingBranch) {
                  setLastPromptedBranch(pendingBranch);
                  vscode.setState({
                    ...vscode.getState(),
                    lastPromptedBranch: pendingBranch,
                  });
                }
                setPendingBranch(null);
              }}
            >
              Keep {branch}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingBranch) {
                  setBranch(pendingBranch);
                  setLastPromptedBranch(pendingBranch);
                  setSelectedCommit(null);
                  vscode.setState({
                    ...vscode.getState(),
                    branch: pendingBranch,
                    lastPromptedBranch: pendingBranch,
                  });
                  setPendingBranch(null);
                }
              }}
            >
              Switch to {pendingBranch}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer / Tucked Selector */}
      {isLoaded && (
        <GitRepoSelector
          repoPath={draftRepoPath}
          setRepoPath={handleRepoPathChange}
          onLoad={handleLoadRepo}
          isTucked={true}
        />
      )}

      <ApiKeyManager
        open={showApiManager}
        onOpenChange={setShowApiManager}
        onConfigurationChange={setApiConfiguration}
        currentProvider={apiConfiguration?.provider}
        currentModel={apiConfiguration?.model}
        currentGlobalConfig={apiConfiguration?.globalConfig}
      />

      <ApiKeyManagerToggle
        onClick={() => setShowApiManager(!showApiManager)}
        isConfigured={!!apiConfiguration?.globalConfig?.api_key}
      />

      {/* CST Download Overlay */}
      {(cstStatus === "downloading" || cstStatus === "extracting") && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 p-6 bg-card border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200">
            <Spinner className="h-10 w-10 text-primary" />
            <div className="flex flex-col items-center gap-1">
              <h3 className="text-lg font-semibold">
                {cstStatus === "downloading"
                  ? "Downloading Codestory CLI..."
                  : "Extracting CLI..."}
              </h3>
              <p className="text-sm text-muted-foreground">
                This will only take a moment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
