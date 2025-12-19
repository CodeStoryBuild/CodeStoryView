import { useEffect, useMemo, useState } from "react";
import { html as renderDiff } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Clock, GitCommit, RotateCcw, GitBranch, Save } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { getVsCodeApi } from "@/lib/vscode";

export function DiffDialog({
  open,
  onOpenChange,
  repoPath,
  branch,
  commit,
  apiConfiguration,
  onOpenApiManager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  branch: string;
  commit: any | null;
  apiConfiguration?: { provider: string; model: string; apiKey: string } | null;
  onOpenApiManager?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vscode = getVsCodeApi();

  const [view, setView] = useState<"line-by-line" | "side-by-side">("line-by-line");
  const [rawDiff, setRawDiff] = useState<string>("");
  const [localApiConfiguration, setLocalApiConfiguration] = useState<{
    provider: string;
    model: string;
    apiKey: string;
  } | null>(apiConfiguration || null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Handle API configuration changes
  const handleApiConfigurationChange = (config: {
    provider: string;
    model: string;
    apiKey: string;
  }) => {
    setLocalApiConfiguration(config);
  };

  // Update local configuration when prop changes
  useEffect(() => {
    setLocalApiConfiguration(apiConfiguration || null);
  }, [apiConfiguration]);

  useEffect(() => {
    if (open && commit && repoPath) {
      setLoading(true);
      setError(null);
      vscode.postMessage({
        command: 'fetchDiff',
        repoPath,
        commitHash: commit.hash
      });
    }
  }, [open, commit, repoPath, vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'displayDiff' && message.commitHash === commit?.hash) {
        try {
          setRawDiff(message.diff);
          setLoading(false);
        } catch (err) {
          setError("Failed to parse diff");
          setLoading(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [commit]);

  // Render diff HTML when view or rawDiff changes
  const diffHtml = useMemo(() => {
    if (!rawDiff) return "";
    try {
      return renderDiff(rawDiff, {
        drawFileList: true,
        matching: 'lines',
        outputFormat: view,
        colorScheme: 'dark' as any,
      });
    } catch (err) {
      console.error("Failed to render diff", err);
      return "";
    }
  }, [rawDiff, view]);

  const title = useMemo(() => {
    if (!commit) return "Commit";
    return `${commit.message || "Commit"}`;
  }, [commit]);

  const handleVibeCommand = (command: string) => {
    // Close the dialog immediately, regardless of whether we run or not
    onOpenChange(false);

    // Require provider and model separately. API key is optional.
    if (!localApiConfiguration || !localApiConfiguration.model || !localApiConfiguration.provider) {
      if (onOpenApiManager) onOpenApiManager();
      return;
    }

    setIsExecuting(true);

    // Use command-specific backend commands so we can add args per-command later.
    const isCommit = command === "commit";

    // Build a small, extensible "globalArgs" object which the extension will map to CLI args
    const globalArgs: Record<string, any> = {
      model: `${localApiConfiguration.provider}:${localApiConfiguration.model}`,
    };

    if (localApiConfiguration.apiKey && localApiConfiguration.apiKey.trim().length > 0) {
      globalArgs.api_key = localApiConfiguration.apiKey;
    }

    const payload: any = {
      command: isCommit ? 'runVibeCommandCommit' : 'runVibeCommandFix',
      repoPath,
      globalArgs,
    };

    // For non-commit commands include a command-specific args object
    if (!isCommit) {
      payload.commandArgs = {
        commit_hash: commit?.hash,
      };
    }

    vscode.postMessage(payload);
  };


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent fullScreen className="flex flex-col p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl">
          <DialogHeader className="p-4 border-b border-border shrink-0 bg-muted/20 pr-12">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-mono text-[10px] h-5 px-1.5">
                    {commit?.hash?.substring(0, 7)}
                  </Badge>
                  <DialogTitle className="text-base font-semibold line-clamp-1">
                    {commit?.message || "Commit Details"}
                  </DialogTitle>
                </div>
                <DialogDescription className="flex items-center gap-4 text-muted-foreground text-[11px]">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 opacity-70" />
                    {commit?.date ? format(new Date(commit.date), "MMM d, yyyy HH:mm") : "Unknown date"}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitCommit className="h-3 w-3 opacity-70" />
                    {commit?.author || "Unknown author"}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3 opacity-70" />
                    {branch}
                  </span>
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2">
                <ButtonGroup>
                  <Button
                    variant={view === "line-by-line" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setView("line-by-line")}
                    className="text-[10px] h-7 px-2.5"
                  >
                    Unified
                  </Button>
                  <Button
                    variant={view === "side-by-side" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setView("side-by-side")}
                    className="text-[10px] h-7 px-2.5"
                  >
                    Split
                  </Button>
                </ButtonGroup>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              {commit?.isWorkingDir ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                  onClick={() => handleVibeCommand("commit")}
                  disabled={isExecuting}
                >
                  <Save className="h-3 w-3" />
                  Commit
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                  onClick={() => handleVibeCommand("expand")}
                  disabled={isExecuting}
                >
                  <RotateCcw className={`h-3 w-3 ${isExecuting ? "animate-spin" : ""}`} />
                  Fix
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-4 bg-background custom-scrollbar">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mr-3"></div>
                Loading diff...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-destructive text-xs">
                {error}
              </div>
            ) : (
              <div 
                key={view}
                className="diff-container text-xs"
                dangerouslySetInnerHTML={{ __html: diffHtml }} 
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <style dangerouslySetInnerHTML={{ __html: `
        .diff-container .d2h-code-linenumber,
        .diff-container .d2h-code-side-linenumber {
          position: sticky !important;
          left: 0 !important;
          z-index: 30 !important;
          background-color: var(--background) !important;
          border-color: var(--border) !important;
          opacity: 0.8;
        }

        .diff-container .d2h-code-line,
        .diff-container .d2h-code-side-line {
          position: relative !important;
          z-index: 1 !important;
        }

        .diff-container .d2h-file-header {
          background-color: var(--muted) !important;
          border-color: var(--border) !important;
          padding: 4px 8px !important;
        }

        .diff-container .d2h-file-name {
          font-size: 11px !important;
        }
      ` }} />
    </>
  );
}
