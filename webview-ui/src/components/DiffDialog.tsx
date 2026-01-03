import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Clock,
  GitCommit,
  RotateCcw,
  GitBranch,
  Save,
  HelpCircle,
  AlertCircle,
  CheckSquare,
  Square,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { getVsCodeApi } from "@/lib/vscode";

export function DiffDialog({
  open,
  onOpenChange,
  repoPath,
  branch,
  commit,
  apiConfiguration,
  onOpenApiManager,
  onExecute,
  isAnyExecuting = false,
  isCurrentExecuting = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  branch: string;
  commit: any | null;
  apiConfiguration?: {
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
  } | null;
  onOpenApiManager?: () => void;
  onExecute?: (hash: string) => void;
  isAnyExecuting?: boolean;
  isCurrentExecuting?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vscode = getVsCodeApi();

  const [view, setView] = useState<"line-by-line" | "side-by-side">(
    "line-by-line",
  );
  const [rawDiff, setRawDiff] = useState<string>("");
  const [guidanceMessage, setGuidanceMessage] = useState("");
  const [showIntentDialog, setShowIntentDialog] = useState(false);
  const [intentMessage, setIntentMessage] = useState("");
  const [localApiConfiguration, setLocalApiConfiguration] = useState<{
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
  } | null>(apiConfiguration || null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  // Ref to preserve selection state across working dir reloads
  const preservedSelectionRef = useRef<Set<string> | null>(null);

  // Parse files from the raw diff
  const parsedFiles = useMemo(() => {
    if (!rawDiff) return [];
    const files: string[] = [];
    const lines = rawDiff.split("\n");
    for (const line of lines) {
      // Match lines like "diff --git a/path/to/file b/path/to/file"
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        files.push(match[2]); // Use the "b" path (after changes)
      }
    }
    return [...new Set(files)]; // Deduplicate
  }, [rawDiff]);

  // Initialize selected files when parsedFiles changes (for working dir commits)
  useEffect(() => {
    if (commit?.isWorkingDir && parsedFiles.length > 0) {
      // If we have a preserved selection from a reload, restore it for files that still exist
      if (preservedSelectionRef.current) {
        const preserved = preservedSelectionRef.current;
        const restoredSelection = new Set(
          parsedFiles.filter((file) => preserved.has(file)),
        );
        // If preserved selection had files but none remain, select all new ones
        // Otherwise keep the intersection (could be empty if user had deselected all)
        setSelectedFiles(restoredSelection);
        preservedSelectionRef.current = null; // Clear after restoration
      } else {
        // First load: select all files by default
        setSelectedFiles(new Set(parsedFiles));
      }
    }
  }, [parsedFiles, commit?.isWorkingDir]);

  const isRoot =
    commit && (commit.isRoot || !commit.parents || commit.parents.length === 0);
  const isMerge = commit && commit.isMerge;
  const isMergeAncestor = commit && commit.isMergeAncestor;
  const isIneligible = isRoot || isMerge || isMergeAncestor;

  // File selection helpers
  const toggleFileSelection = (file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  const selectAllFiles = () => {
    setSelectedFiles(new Set(parsedFiles));
  };

  const deselectAllFiles = () => {
    setSelectedFiles(new Set());
  };

  const allFilesSelected =
    parsedFiles.length > 0 && selectedFiles.size === parsedFiles.length;
  const noFilesSelected = selectedFiles.size === 0;
  const someFilesSelected =
    selectedFiles.size > 0 && selectedFiles.size < parsedFiles.length;

  // Handle API configuration changes
  const handleApiConfigurationChange = (config: {
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
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
      setRawDiff("");
      setSelectedFiles(new Set());
      setGuidanceMessage("");
      setIntentMessage("");
      vscode.postMessage({
        command: "fetchDiff",
        repoPath,
        commitHash: commit.hash,
      });
    }
  }, [open, commit, repoPath, vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        message.command === "displayDiff" &&
        message.commitHash === commit?.hash
      ) {
        try {
          setRawDiff(message.diff);
          setLoading(false);
        } catch (err) {
          setError("Failed to parse diff");
          setLoading(false);
        }
      } else if (
        message.command === "reloadWorkingDirDiff" &&
        open &&
        commit?.isWorkingDir
      ) {
        // Preserve current selection before refetching
        preservedSelectionRef.current = new Set(selectedFiles);
        // Refetch the working directory diff
        setLoading(true);
        setError(null);
        vscode.postMessage({
          command: "fetchDiff",
          repoPath,
          commitHash: commit.hash,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [commit, open, repoPath, vscode, selectedFiles]);

  // Render diff HTML when view or rawDiff changes
  const diffHtml = useMemo(() => {
    if (!rawDiff) return "";
    try {
      return renderDiff(rawDiff, {
        drawFileList: true,
        matching: "lines",
        outputFormat: view,
        colorScheme: "dark" as any,
      });
    } catch (err) {
      console.error("Failed to render diff", err);
      return "";
    }
  }, [rawDiff, view]);

  // Memoize the dangerouslySetInnerHTML object to prevent React from
  // re-parsing/re-rendering the large diff HTML on unrelated state changes
  const diffHtmlProps = useMemo(() => ({ __html: diffHtml }), [diffHtml]);

  const title = useMemo(() => {
    if (!commit) return "Commit";
    return `${commit.message || "Commit"}`;
  }, [commit]);

  const handleVibeCommand = (command: string, intent?: string) => {
    const isCommit = command === "commit";

    // For commit commands with partial file selection, ensure at least one file is selected
    if (isCommit && parsedFiles.length > 0 && noFilesSelected) {
      // Don't proceed - UI will show the error
      return;
    }

    // If relevance filtering is enabled, we MUST have an intent for commit commands
    if (
      isCommit &&
      !intent &&
      localApiConfiguration?.globalConfig?.relevance_filtering
    ) {
      setShowIntentDialog(true);
      return;
    }

    // Close the dialog immediately, regardless of whether we run or not
    onOpenChange(false);
    setShowIntentDialog(false);

    // Require provider and model separately. API key is optional.
    if (
      !localApiConfiguration ||
      !localApiConfiguration.model ||
      !localApiConfiguration.provider
    ) {
      if (onOpenApiManager) onOpenApiManager();
      return;
    }

    if (commit?.hash && onExecute) {
      onExecute(commit.hash);
    }

    // Build a small, extensible "globalArgs" object which the extension will map to CLI args
    const globalArgs: Record<string, any> = {
      model: `${localApiConfiguration.provider}:${localApiConfiguration.model}`,
      ...localApiConfiguration.globalConfig,
    };

    const payload: any = {
      command: isCommit ? "runVibeCommandCommit" : "runVibeCommandFix",
      repoPath,
      branch,
      globalArgs,
    };

    // For commit commands, include guidance message, intent, and pathspec
    if (isCommit) {
      // Build pathspec if not all files are selected
      const pathspec = someFilesSelected ? Array.from(selectedFiles) : null;
      payload.commandArgs = {
        message: guidanceMessage || null,
        intent: intent || null,
        pathspec: pathspec,
      };
    } else {
      // For non-commit (fix) commands include a command-specific args object with message support
      payload.commandArgs = {
        commit_hash: commit?.hash,
        message: guidanceMessage || null,
      };
    }

    vscode.postMessage(payload);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          fullScreen
          className="flex flex-col p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl"
        >
          <DialogHeader className="p-3 sm:p-4 border-b border-border shrink-0 bg-muted/20 pr-12">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-primary/5 text-primary border-primary/20 font-mono text-[10px] h-5 px-1.5"
                  >
                    {commit?.hash?.substring(0, 7)}
                  </Badge>
                  {isRoot && (
                    <Badge
                      variant="destructive"
                      className="text-[10px] h-5 px-1.5"
                    >
                      Root
                    </Badge>
                  )}
                  {isMerge && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 border-warning text-warning"
                    >
                      Merge
                    </Badge>
                  )}
                  {isMergeAncestor && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 border-warning/80 text-warning/80"
                    >
                      Merge-Downstream
                    </Badge>
                  )}
                  <DialogTitle className="text-base font-semibold line-clamp-1">
                    {commit?.message || "Commit Details"}
                  </DialogTitle>
                </div>
                <DialogDescription className="flex flex-wrap items-center gap-2 sm:gap-4 text-muted-foreground text-[10px] sm:text-[11px]">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 opacity-70" />
                    {commit?.date
                      ? format(new Date(commit.date), "MMM d, yyyy HH:mm")
                      : "Unknown date"}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitCommit className="h-3 w-3 opacity-70" />
                    <span className="max-w-[100px] sm:max-w-none truncate">
                      {commit?.author || "Unknown author"}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3 opacity-70" />
                    <span className="max-w-[80px] sm:max-w-none truncate">
                      {branch}
                    </span>
                  </span>
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <ButtonGroup>
                  <Button
                    variant={view === "line-by-line" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setView("line-by-line")}
                    className="text-[9px] sm:text-[10px] h-6 sm:h-7 px-1.5 sm:px-2.5"
                  >
                    Unified
                  </Button>
                  <Button
                    variant={view === "side-by-side" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setView("side-by-side")}
                    className="text-[9px] sm:text-[10px] h-6 sm:h-7 px-1.5 sm:px-2.5"
                  >
                    Split
                  </Button>
                </ButtonGroup>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-2 sm:mt-3">
              {commit?.isWorkingDir ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full">
                  {/* Left side: Input + Commit button */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="Guidance for LLM..."
                        value={guidanceMessage}
                        onChange={(e) => setGuidanceMessage(e.target.value)}
                        className="h-7 text-[11px] w-32 sm:w-48 bg-background/50 border-border/50 focus:border-primary/50"
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[250px]">
                          Optionally provide a guidance message to the LLM so it
                          can better understand the "why" behind your changes
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                            onClick={() => handleVibeCommand("commit")}
                            disabled={
                              isAnyExecuting ||
                              (parsedFiles.length > 0 && noFilesSelected)
                            }
                          >
                            <Save className="h-3 w-3" />
                            Commit
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {isAnyExecuting && !isCurrentExecuting && (
                        <TooltipContent side="bottom">
                          Another operation is currently executing
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </div>

                  {/* Right side: File selection bar (horizontally scrollable) */}
                  {parsedFiles.length > 0 && (
                    <div className="flex items-center gap-2 flex-1 min-w-0 max-w-full sm:max-w-none justify-start sm:justify-end overflow-hidden">
                      {/* Select All toggle */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (allFilesSelected) {
                                deselectAllFiles();
                              } else {
                                selectAllFiles();
                              }
                            }}
                            className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium hover:bg-accent transition-colors shrink-0"
                          >
                            {allFilesSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            ) : someFilesSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary opacity-50" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {allFilesSelected
                            ? "Deselect all files"
                            : "Select all files"}{" "}
                          ({selectedFiles.size}/{parsedFiles.length})
                        </TooltipContent>
                      </Tooltip>

                      {/* No files selected warning */}
                      {noFilesSelected && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center shrink-0 text-destructive">
                              <AlertCircle className="h-3.5 w-3.5" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            You must select at least one file to commit
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Horizontal scrollable file list */}
                      <div
                        className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar-horizontal min-w-0 flex-1 py-0.5"
                        style={{ maxWidth: "calc(100vw - 180px)" }}
                      >
                        {parsedFiles.map((file) => (
                          <button
                            key={file}
                            onClick={() => toggleFileSelection(file)}
                            className={`
                              flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap
                              border transition-all cursor-pointer shrink-0
                              ${
                                selectedFiles.has(file)
                                  ? "bg-primary/10 border-primary/30 text-primary"
                                  : "bg-muted/30 border-border/50 text-muted-foreground hover:border-border"
                              }
                            `}
                          >
                            {selectedFiles.has(file) ? (
                              <CheckSquare className="h-2.5 w-2.5" />
                            ) : (
                              <Square className="h-2.5 w-2.5" />
                            )}
                            <span className="max-w-[100px] sm:max-w-[150px] truncate">
                              {file.split("/").pop()}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : !isIneligible ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      placeholder="Guidance for LLM..."
                      value={guidanceMessage}
                      onChange={(e) => setGuidanceMessage(e.target.value)}
                      className="h-7 text-[11px] w-32 sm:w-48 bg-background/50 border-border/50 focus:border-primary/50"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[250px]">
                        Optionally provide a guidance message to the LLM so it
                        can better understand the "why" behind your changes
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                          onClick={() => handleVibeCommand("expand")}
                          disabled={isAnyExecuting}
                        >
                          <RotateCcw
                            className={`h-3 w-3 ${
                              isCurrentExecuting ? "animate-spin" : ""
                            }`}
                          />
                          Fix
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {isAnyExecuting && !isCurrentExecuting && (
                      <TooltipContent side="bottom">
                        Another operation is currently executing
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
              ) : null}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-2 sm:p-4 bg-background custom-scrollbar">
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
                dangerouslySetInnerHTML={diffHtmlProps}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showIntentDialog} onOpenChange={setShowIntentDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Relevance Filtering Enabled</DialogTitle>
            <DialogDescription>
              You have enabled relevance filtering (note you can disable in API
              Key Manager), and must provide an intent for the changes so that
              the AI models can have a reference for what is relevant and what
              is not.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="Describe the intent of your changes..."
              value={intentMessage}
              onChange={(e) => setIntentMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && intentMessage.trim()) {
                  handleVibeCommand("commit", intentMessage);
                }
              }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowIntentDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!intentMessage.trim()}
              onClick={() => handleVibeCommand("commit", intentMessage)}
            >
              Run Commit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <style
        dangerouslySetInnerHTML={{
          __html: `
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
      `,
        }}
      />
    </>
  );
}
