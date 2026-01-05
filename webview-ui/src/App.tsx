import { useState, useEffect, useCallback, useMemo } from "react";
import { GitVisualizer } from "./components/GitVisualizer";
import { GitRepoSelector } from "./components/GitRepoSelector";
import { BranchSelector } from "./components/BranchSelector";
import { ApiKeyManager } from "./components/ApiKeyManager";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { getVsCodeApi } from "./lib/vscode";
import { Spinner } from "./components/ui/spinner";
import { Settings } from "lucide-react";
import { cn } from "./lib/utils";
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
  const [repoBranch, setRepoBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [isDetached, setIsDetached] = useState(false);
  const [isLoaded, setIsLoaded] = useState(!!prevState?.repoPath);
  const [isLoading, setIsLoading] = useState(false);
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
  const [branchUpdateStrategy, setBranchUpdateStrategy] = useState<
    "prompt" | "update" | "ignore"
  >("prompt");
  const [tempIgnorePrompt, setTempIgnorePrompt] = useState(false);

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
        if (message.branchUpdateStrategy !== undefined) {
          setBranchUpdateStrategy(message.branchUpdateStrategy);
        }
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
      setIsLoading(true);
      setLoadError(null);
      setIsFirstLoad(true);
      setSelectedCommit(null);
      vscode.setState({
        ...vscode.getState(),
        repoPath: path,
        branch,
        lastPromptedBranch,
      });
      vscode.postMessage({
        command: "loadRepo",
        directory: path,
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
          setIsLoading(false);
          break;
        case "loading":
          setIsLoading(true);
          break;
        case "loadError":
          setLoadError(message.message || "Failed to load repository");
          setIsLoaded(false);
          setIsLoading(false);
          break;
        case "displayBranches":
          if (message.branches) setBranches(message.branches);
          if (message.isDetached !== undefined)
            setIsDetached(message.isDetached);

          const newRepoBranch = message.currentBranch;
          const repoBranchChanged =
            repoBranch !== null && newRepoBranch !== repoBranch;
          setRepoBranch(newRepoBranch);

          if (isFirstLoad && newRepoBranch) {
            setIsFirstLoad(false);
            setBranch(newRepoBranch);
            setLastPromptedBranch(newRepoBranch);
            setSelectedCommit(null);
            vscode.setState({
              ...vscode.getState(),
              branch: newRepoBranch,
              lastPromptedBranch: newRepoBranch,
            });
            return;
          }

          if (
            !message.isManual &&
            branchUpdateStrategy === "prompt" &&
            repoBranchChanged &&
            newRepoBranch &&
            newRepoBranch !== branch &&
            newRepoBranch !== lastPromptedBranch &&
            branch !== "" &&
            !selectedCommit
          ) {
            setPendingBranch(newRepoBranch);
            setLastPromptedBranch(newRepoBranch);
            vscode.setState({
              ...vscode.getState(),
              lastPromptedBranch: newRepoBranch,
            });
          } else if (
            newRepoBranch &&
            (message.shouldUpdate ||
              !branch ||
              (branchUpdateStrategy === "update" && repoBranchChanged))
          ) {
            const oldBranch = branch;
            setBranch(newRepoBranch);
            setLastPromptedBranch(newRepoBranch);
            setSelectedCommit(null);
            vscode.setState({
              ...vscode.getState(),
              branch: newRepoBranch,
              lastPromptedBranch: newRepoBranch,
            });

            // If we auto-updated because the branch changed and strategy is "update",
            // we now rely on GitVisualizer's effect to trigger the reload when the prop changes.
            if (
              branchUpdateStrategy === "update" &&
              newRepoBranch !== oldBranch &&
              oldBranch !== ""
            ) {
              setIsLoading(true);
            }

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

  // Memoized fallback branches array to prevent new array on every render
  const displayBranches = useMemo(
    () => (branches.length > 0 ? branches : [branch || "(not on a branch)"]),
    [branches, branch],
  );

  // Memoized callbacks for BranchSelector
  const handleBranchSelect = useCallback(
    (b: string) => {
      setBranch(b);
      setLastPromptedBranch(b);
      setSelectedCommit(null);
      setIsLoading(true);
      vscode.setState({
        ...vscode.getState(),
        branch: b,
        lastPromptedBranch: b,
      });
      // Removed redundant vscode.postMessage as GitVisualizer's effect handles branch changes
    },
    [vscode], // repoPath removed from deps as it's not used now
  );

  const handleReload = useCallback(() => {
    setSelectedCommit(null);
    setIsLoading(true);
    vscode.postMessage({
      command: "loadRepo",
      directory: repoPath,
      branch: branch,
    });
  }, [repoPath, branch, vscode]);

  // Memoized callbacks for GitVisualizer
  const handleOpenApiManager = useCallback(() => setShowApiManager(true), []);

  const handleCommitSelect = useCallback((commit: any) => {
    setSelectedCommit(commit);
    console.log("Selected commit:", commit);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Branch Selector - Top Left (minimal) */}
      {isLoaded && (
        <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-20">
          <div className="flex items-center gap-1 bg-card/80 backdrop-blur-md border border-border p-1 rounded-lg shadow-sm">
            <BranchSelector
              branches={displayBranches}
              selectedBranch={branch || "(not on a branch)"}
              isDetached={isDetached}
              onBranchSelect={handleBranchSelect}
              onReload={handleReload}
            />
          </div>
        </div>
      )}

      {/* API Settings Button - Bottom Left */}
      {isLoaded && (
        <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 z-20">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowApiManager(!showApiManager)}
            className={cn(
              "h-8 gap-1.5 bg-card/80 backdrop-blur-md border-border shadow-sm",
              !!apiConfiguration?.globalConfig?.api_key
                ? "text-primary border-primary/30"
                : "text-muted-foreground",
            )}
            title="API Settings"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="text-[11px]">Config</span>
          </Button>
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
            isLoading={isLoading}
            apiConfiguration={apiConfiguration}
            onOpenApiManager={handleOpenApiManager}
            onCommitSelect={handleCommitSelect}
          />
        )}
      </main>

      <AlertDialog
        open={!!pendingBranch}
        onOpenChange={(open) => {
          if (!open) {
            setPendingBranch(null);
            setTempIgnorePrompt(false);
          }
        }}
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
          <AlertDialogFooter className="flex-col items-end gap-3">
            <div className="flex gap-2">
              <AlertDialogCancel
                onClick={() => {
                  if (tempIgnorePrompt) {
                    vscode.postMessage({
                      command: "setBranchUpdateStrategy",
                      value: "ignore",
                    });
                    setBranchUpdateStrategy("ignore");
                  }
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
                  if (tempIgnorePrompt) {
                    vscode.postMessage({
                      command: "setBranchUpdateStrategy",
                      value: "update",
                    });
                    setBranchUpdateStrategy("update");
                  }
                  if (pendingBranch) {
                    setBranch(pendingBranch);
                    setLastPromptedBranch(pendingBranch);
                    setSelectedCommit(null);
                    setIsLoading(true);
                    vscode.setState({
                      ...vscode.getState(),
                      branch: pendingBranch,
                      lastPromptedBranch: pendingBranch,
                    });
                    vscode.postMessage({
                      command: "loadRepo",
                      directory: repoPath,
                      branch: pendingBranch,
                    });
                    setPendingBranch(null);
                  }
                }}
              >
                Switch to {pendingBranch}
              </AlertDialogAction>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                id="ask-to-update-branch"
                checked={tempIgnorePrompt}
                onCheckedChange={(checked) => setTempIgnorePrompt(!!checked)}
              />
              <Label
                htmlFor="ask-to-update-branch"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Remember my choice
              </Label>
            </div>
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
