import { useEffect, useMemo, useRef, useState } from "react";
import { parse as parseDiff } from "diff2html";
import { DiffHighlighter } from "@/lib/diffHighlighter";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { getVsCodeApi } from "@/lib/vscode";

const getCanonicalPath = (file: { newName?: string; oldName?: string }) => {
  if (file.newName === "/dev/null") {
    return file.oldName || "unknown";
  }
  return file.newName || file.oldName || "unknown";
};

export function DiffDialog({
  open,
  onOpenChange,
  repoPath,
  branch,
  commit,
  apiConfiguration,
  shellIntegrationStatus,
  executionState,
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
  shellIntegrationStatus?: {
    enabled: boolean;
    ready: boolean;
  };
  executionState?: {
    isExecuting: boolean;
    hash?: string;
    name?: string;
  };
  onOpenApiManager?: () => void;
  onExecute?: (hash: string) => void;
  isAnyExecuting?: boolean;
  isCurrentExecuting?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vscode = getVsCodeApi();

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
  const [visibleFiles, setVisibleFiles] = useState(10);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  // Ref to preserve selection state across working dir reloads
  const preservedSelectionRef = useRef<Set<string> | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Parse files from the raw diff
  const parsedFiles = useMemo(() => {
    if (!rawDiff) return [];
    try {
      const files = parseDiff(rawDiff);
      return files
        .map((f) => getCanonicalPath(f))
        .filter((f) => f !== "unknown");
    } catch {
      return [];
    }
  }, [rawDiff]);

  // Reset visible files when rawDiff changes
  useEffect(() => {
    setVisibleFiles(10);
    setExpandedBlocks(new Set());
  }, [rawDiff]);

  // Infinite scroll for files
  useEffect(() => {
    if (!open || !rawDiff) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleFiles((prev) => prev + 10);
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [open, rawDiff]);

  // Initialize selected files when parsedFiles changes (for working dir commits)
  useEffect(() => {
    if (commit?.isWorkingDir && parsedFiles.length > 0) {
      if (preservedSelectionRef.current) {
        const preserved = preservedSelectionRef.current;
        const restoredSelection = new Set(
          parsedFiles.filter((file) => preserved.has(file)),
        );
        setSelectedFiles(restoredSelection);
        preservedSelectionRef.current = null;
      } else if (selectedFiles.size === 0) {
        setSelectedFiles(new Set(parsedFiles));
      }
    }
  }, [parsedFiles, commit?.isWorkingDir]);

  const isRoot =
    commit && (commit.isRoot || !commit.parents || commit.parents.length === 0);
  const isMerge = commit && commit.isMerge;
  const isMergeAncestor = commit && commit.isMergeAncestor;
  const isIneligible = isRoot || isMerge || isMergeAncestor;

  const isShellIntegrationEnabled = shellIntegrationStatus?.enabled ?? true;
  const isShellReady = shellIntegrationStatus?.ready ?? true;

  const effectivelyExecuting =
    isAnyExecuting || executionState?.isExecuting || false;

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
        preservedSelectionRef.current = new Set(selectedFiles);
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

  // Memoize the fully parsed diff structure (including blocks/lines) for rendering
  const fullyParsedDiff = useMemo(() => {
    if (!open || !rawDiff) return [];
    try {
      return parseDiff(rawDiff);
    } catch (err) {
      console.error("Failed to parse diff", err);
      return [];
    }
  }, [rawDiff, open]);

  // Render custom highlighted diff
  const renderedDiffItems = useMemo(() => {
    if (!open || !rawDiff || fullyParsedDiff.length === 0) {
      if (open && rawDiff && fullyParsedDiff.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground/50">
            <div className="text-[11px] font-medium tracking-wider uppercase">
              No files modified
            </div>
          </div>
        );
      }
      return null;
    }

    const displayedFiles = fullyParsedDiff.slice(0, visibleFiles);

    return displayedFiles.map((file, fileIdx) => {
      const filePath = getCanonicalPath(file);
      const isDeleted = file.isDeleted || file.newName === "/dev/null";
      const isNew = file.isNew || file.oldName === "/dev/null";
      const isRename =
        file.isRename ||
        (file.oldName !== file.newName && !isNew && !isDeleted);

      const fileTypeLabel = isDeleted
        ? "deleted"
        : isNew
          ? "added"
          : isRename
            ? "renamed"
            : "modified";

      return (
        <div
          key={`${filePath}-${fileIdx}`}
          className="mb-6 border border-border rounded-md overflow-hidden bg-background shadow-sm"
        >
          <div className="bg-muted/50 px-3 py-1.5 border-b border-border flex items-center justify-between">
            <span className="font-mono text-[11px] truncate opacity-80">
              {filePath}
            </span>
            <span
              className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                isNew
                  ? "bg-emerald-500/20 text-emerald-400"
                  : isDeleted
                    ? "bg-rose-500/20 text-rose-400"
                    : isRename
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-blue-500/10 text-blue-400"
              }`}
            >
              {fileTypeLabel}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {file.blocks.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground/40 italic text-[10px] uppercase">
                (no file changes)
              </div>
            ) : (
              file.blocks.map((block, blockIdx) => (
                <div key={blockIdx} className="bg-muted/5">
                  <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono bg-muted/10 italic border-y border-border/20">
                    {block.header}
                  </div>
                  {(() => {
                    const blockLines = block.lines;
                    const blockId = `${fileIdx}-${blockIdx}`;
                    const isExpanded = expandedBlocks.has(blockId);
                    const limit = 1000;
                    const shouldTruncate =
                      blockLines.length > limit && !isExpanded;
                    const displayedLines = shouldTruncate
                      ? blockLines.slice(0, limit)
                      : blockLines;

                    return (
                      <>
                        {displayedLines.map((line, lineIdx) => {
                          const highlitContent = DiffHighlighter.highlight(
                            line.content,
                          );
                          const typeClass =
                            line.type === "insert"
                              ? "bg-emerald-500/10 text-emerald-300/90"
                              : line.type === "delete"
                                ? "bg-rose-500/10 text-rose-300/90"
                                : "hover:bg-muted/10";

                          return (
                            <div
                              key={lineIdx}
                              className={`flex font-mono text-[11px] leading-relaxed group border-b last:border-b-0 border-border/5 ${typeClass}`}
                            >
                              <div className="w-10 shrink-0 text-right px-2 py-0.5 text-muted-foreground/30 border-r border-border/20 select-none bg-muted/20 group-hover:bg-muted/30 transition-colors">
                                {line.oldNumber || ""}
                              </div>
                              <div className="w-10 shrink-0 text-right px-2 py-0.5 text-muted-foreground/30 border-r border-border/20 select-none bg-muted/20 group-hover:bg-muted/30 transition-colors">
                                {line.newNumber || ""}
                              </div>
                              <div
                                className="px-4 py-0.5 whitespace-pre break-all overflow-x-auto flex-1 font-syntax transition-opacity"
                                dangerouslySetInnerHTML={{
                                  __html: highlitContent,
                                }}
                              />
                            </div>
                          );
                        })}
                        {shouldTruncate && (
                          <div className="py-2 px-3 bg-muted/10 border-t border-border/5 flex items-center justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setExpandedBlocks((prev) => {
                                  const next = new Set(prev);
                                  next.add(blockId);
                                  return next;
                                });
                              }}
                            >
                              Show {blockLines.length - limit} more lines...
                            </Button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))
            )}
          </div>
        </div>
      );
    });
  }, [fullyParsedDiff, open, rawDiff, visibleFiles]);

  const hasMoreFiles = useMemo(() => {
    return fullyParsedDiff.length > visibleFiles;
  }, [fullyParsedDiff, visibleFiles]);

  const handleCodestoryCommand = (command: string, intent?: string) => {
    const isCommit = command === "commit";

    if (isCommit && parsedFiles.length > 0 && noFilesSelected) {
      return;
    }

    if (
      isCommit &&
      !intent &&
      localApiConfiguration?.globalConfig?.relevance_filtering
    ) {
      setShowIntentDialog(true);
      return;
    }

    onOpenChange(false);
    setShowIntentDialog(false);

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

    const globalArgs: Record<string, any> = {
      model: `${localApiConfiguration.provider}:${localApiConfiguration.model}`,
      ...localApiConfiguration.globalConfig,
    };

    const payload: any = {
      command: isCommit
        ? "runCodestoryCommandCommit"
        : "runCodestoryCommandFix",
      repoPath,
      branch,
      globalArgs,
    };

    if (isCommit) {
      const pathspec = someFilesSelected ? Array.from(selectedFiles) : null;
      payload.commandArgs = {
        message: guidanceMessage || null,
        intent: intent || null,
        pathspec: pathspec,
      };
    } else {
      payload.commandArgs = {
        commit_hash: commit?.hash,
        message: guidanceMessage || null,
      };
    }

    vscode.postMessage(payload);
  };

  const handleOpenChangeInternal = (newOpen: boolean) => {
    if (!newOpen) {
      setRawDiff("");
      setLoading(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChangeInternal}>
        <DialogContent
          fullScreen
          className="flex flex-col p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl"
        >
          <DialogHeader className="p-3 sm:p-4 border-b border-border shrink-0 bg-muted/20 pr-12">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
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
                  <DialogTitle className="text-base font-semibold leading-tight flex-1 min-w-0">
                    <div className="max-w-[calc(100vw-180px)] sm:max-w-[calc(100vw-150px)] overflow-x-auto custom-scrollbar-horizontal whitespace-nowrap pr-2 py-1 font-sans">
                      {commit?.message || "Commit Details"}
                    </div>
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
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-2 sm:mt-3">
              {commit?.isWorkingDir ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      <Textarea
                        placeholder="Guidance for LLM..."
                        value={guidanceMessage}
                        onChange={(e) => setGuidanceMessage(e.target.value)}
                        className="h-7 min-h-[28px] max-h-32 text-[11px] w-32 sm:w-48 bg-background/50 border-border/50 focus:border-primary/50 py-1 px-2 resize-none overflow-y-auto custom-scrollbar leading-tight"
                        rows={1}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            handleCodestoryCommand("commit");
                          }
                        }}
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            className="max-w-[250px]"
                          >
                            Optionally provide a guidance message to the LLM so
                            it can better understand the "why" behind your
                            changes
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                              onClick={() => handleCodestoryCommand("commit")}
                              disabled={
                                effectivelyExecuting ||
                                (parsedFiles.length > 0 && noFilesSelected) ||
                                !isShellIntegrationEnabled
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
                        {!isShellIntegrationEnabled && (
                          <TooltipContent side="bottom">
                            Shell Integration must be enabled to run commands
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {parsedFiles.length > 0 && (
                    <div className="flex items-center gap-2 flex-1 min-w-0 max-w-full sm:max-w-none justify-start sm:justify-end overflow-hidden">
                      <TooltipProvider>
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
                      </TooltipProvider>

                      {noFilesSelected && (
                        <TooltipProvider>
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
                        </TooltipProvider>
                      )}

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
                    <Textarea
                      placeholder="Guidance for LLM..."
                      value={guidanceMessage}
                      onChange={(e) => setGuidanceMessage(e.target.value)}
                      className="h-7 min-h-[28px] max-h-32 text-[11px] w-32 sm:w-48 bg-background/50 border-border/50 focus:border-primary/50 py-1 px-2 resize-none overflow-y-auto custom-scrollbar leading-tight"
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          handleCodestoryCommand("fix");
                        }
                      }}
                    />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[250px]">
                          Optionally provide a guidance message to the LLM so it
                          can better understand the "why" behind your changes
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] gap-1.5 border-border hover:bg-accent"
                            onClick={() => handleCodestoryCommand("expand")}
                            disabled={
                              effectivelyExecuting || !isShellIntegrationEnabled
                            }
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
                      {!isShellIntegrationEnabled && (
                        <TooltipContent side="bottom">
                          Shell Integration must be enabled to run commands
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : null}
            </div>

            {!isShellIntegrationEnabled && (
              <div className="mx-3 sm:mx-4 mb-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p className="text-[10px] font-medium">
                  VS Code Shell Integration is disabled. Please enable it in
                  settings to use Codestory commands.
                </p>
              </div>
            )}
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
              <div className="space-y-4">
                {renderedDiffItems}
                {hasMoreFiles && (
                  <div
                    ref={loadMoreRef}
                    className="py-12 flex flex-col items-center justify-center gap-3 opacity-60 hover:opacity-100 transition-opacity border-t border-border/30 mt-8"
                  >
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    <span className="text-[10px] uppercase tracking-widest font-bold">
                      Loading more files...
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleFiles((prev) => prev + 10)}
                      className="h-7 text-[10px] mt-2"
                    >
                      Show More
                    </Button>
                  </div>
                )}
              </div>
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
                  handleCodestoryCommand("commit", intentMessage);
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowIntentDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleCodestoryCommand("commit", intentMessage)}
              disabled={!intentMessage.trim()}
            >
              Run Commit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
