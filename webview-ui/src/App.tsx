import { useState, useEffect, useCallback } from "react";
import { GitVisualizer } from "./components/GitVisualizer";
import { GitRepoSelector } from "./components/GitRepoSelector";
import { BranchSelector } from "./components/BranchSelector";
import { getVsCodeApi } from "./lib/vscode";

function App() {
  const vscode = getVsCodeApi();
  const prevState = vscode.getState();

  const [repoPath, setRepoPath] = useState(prevState?.repoPath || "");
  const [branch, setBranch] = useState(prevState?.branch || "main");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(!!prevState?.repoPath);

  const handleLoadRepo = useCallback((path: string) => {
    setRepoPath(path);
    setIsLoaded(true);
    vscode.setState({ repoPath: path, branch });
    // Fetch branches too
    vscode.postMessage({ command: 'loadRepo', directory: path, branch });
  }, [branch, vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'displayCommits':
          break;
        case 'displayBranches':
          if (message.branches) setBranches(message.branches);
          break;
        case 'displayDiff':
          // For now, log the diff. We could add a side panel or modal here.
          console.log('Received diff:', message.diff);
          break;
        case 'displayDirectory':
          if (message.directory) handleLoadRepo(message.directory);
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleLoadRepo]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#020617] text-slate-50 overflow-hidden font-sans">
      {/* Header / Top Bar */}
      {isLoaded && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-4 bg-slate-900/50 backdrop-blur-md border border-slate-800 p-2 rounded-lg shadow-xl">
          <BranchSelector
            branches={branches.length > 0 ? branches : [branch]}
            selectedBranch={branch}
            onBranchSelect={(b) => {
              setBranch(b);
              vscode.postMessage({ command: 'loadRepo', directory: repoPath, branch: b });
            }}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 relative flex items-center justify-center">
        {!isLoaded ? (
          <GitRepoSelector
            repoPath={repoPath}
            setRepoPath={setRepoPath}
            onLoad={handleLoadRepo}
          />
        ) : (
          <GitVisualizer
            repoPath={repoPath}
            branch={branch}
            onCommitSelect={(commit) => {
              console.log('Selected commit:', commit);
              // Future: show diff/details
            }}
          />
        )}
      </main>

      {/* Footer / Tucked Selector */}
      {isLoaded && (
        <GitRepoSelector
          repoPath={repoPath}
          setRepoPath={setRepoPath}
          onLoad={handleLoadRepo}
          isTucked={true}
        />
      )}
    </div>
  );
}

export default App;
