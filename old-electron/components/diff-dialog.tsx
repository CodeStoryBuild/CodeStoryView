"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { html as renderDiff, parse as parseDiff } from "diff2html";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, GitCommit, RotateCcw, GitBranch, Save } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { apiService } from "@/lib/ipc-api";
import { ApiKeyManager } from "@/components/api-key-manager";
import { executeVibeCommandWithFlow } from "@/lib/vibe-command-executor";

export function DiffDialog({
  open,
  onOpenChange,
  repoPath,
  branch,
  commit,
  onCommitHistoryUpdate,
  refreshKey,
  apiConfiguration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  branch: string;
  commit: any | null;
  onCommitHistoryUpdate?: () => void;
  refreshKey?: number;
  apiConfiguration?: { model: string; apiKey: string } | null;
}) {
  const [diffHtml, setDiffHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const CHUNK_SIZE = 5;
  const [visibleCount, setVisibleCount] = useState<number>(CHUNK_SIZE);
  // Cache per commit (per branch lifecycle): store pre-rendered unified HTML to avoid delays
  const diffCacheRef = useRef<
    Map<
      string,
      {
        raw?: string;
        json?: any[];
        totalFiles?: number;
        // cache of rendered HTML slices by key `${view}:${count}`
        renderedByKey?: Map<string, string>;
      }
    >
  >(new Map());

  const [view, setView] = useState<"unified" | "split">("unified");
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [showApiManager, setShowApiManager] = useState(false);
  const [localApiConfiguration, setLocalApiConfiguration] = useState<{
    model: string;
    apiKey: string;
  } | null>(apiConfiguration || null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Handle API configuration changes
  const handleApiConfigurationChange = (config: {
    model: string;
    apiKey: string;
  }) => {
    setLocalApiConfiguration(config);
  };

  // Update local configuration when prop changes
  useEffect(() => {
    setLocalApiConfiguration(apiConfiguration || null);
  }, [apiConfiguration]);

  // Clear diff cache when repository, branch, or refresh key changes
  useEffect(() => {
    diffCacheRef.current.clear();
  }, [repoPath, branch, refreshKey]);

  const title = useMemo(() => {
    if (!commit) return "Commit";
    return `${commit.message || "Commit"}`;
  }, [commit]);

  // Render helpers for both views
  const renderUnified = (jsonSlice: any[]) =>
    renderDiff(
      jsonSlice as any,
      {
        inputFormat: "json",
        drawFileList: false,
        matching: "lines",
        outputFormat: "line-by-line",
        synchronisedScroll: true,
      } as any,
    );

  const renderSplit = (jsonSlice: any[]) =>
    renderDiff(
      jsonSlice as any,
      {
        inputFormat: "json",
        drawFileList: false,
        matching: "lines",
        outputFormat: "side-by-side",
        synchronisedScroll: true,
      } as any,
    );

  // Fetch raw diff once per commit and render per selected view with caching of each rendering
  useEffect(() => {
    const load = async () => {
      if (!commit || !repoPath || !open) return;
      const cacheKey = `${repoPath}::${commit.hash}`;
      const cached = diffCacheRef.current.get(cacheKey);

      setLoading(true);
      setError(null);

      try {
        let entry = cached;

        if (!entry || !entry.raw) {
          // fetch raw once
          const data = await apiService.git.getDiff(repoPath, commit.hash);
          entry = { raw: data.diff || "" };
          diffCacheRef.current.set(cacheKey, entry);
        }

        // Parse raw to JSON once for chunked rendering
        if (!entry.json) {
          try {
            entry.json = (parseDiff as any)(entry.raw || "") as any[];
          } catch {
            // Fallback: if parse API differs
            const anyParser = (parseDiff as any) || ({} as any);
            if (typeof anyParser === "function") {
              entry.json = anyParser(entry.raw || "");
            } else {
              throw new Error("Failed to parse diff for incremental rendering");
            }
          }
          entry.totalFiles = entry.json?.length || 0;
          entry.renderedByKey = new Map<string, string>();
          diffCacheRef.current.set(cacheKey, entry);
        }

        // Ensure visibleCount is initialized appropriately on first load
        setVisibleCount((prev) =>
          prev > 0
            ? prev
            : Math.min(CHUNK_SIZE, entry!.totalFiles || CHUNK_SIZE),
        );

        // Render based on current view and visibleCount using cached slices.
        // If there are no files in the diff, provide a small default HTML
        // snippet so the dialog consistently displays content instead of
        // an empty area.
        const DEFAULT_NO_DIFF_HTML = `
          <div class="d2h-wrapper">
            <div class="d2h-files">
              <div style="padding:16px;color:var(--muted-foreground,#6b7280);font-size:13px;">No changes in this commit</div>
            </div>
          </div>
        `;

        const filesSlice = (entry.json || []).slice(0, visibleCount);
        const key = `${view}:${visibleCount}`;

        if ((entry.totalFiles || 0) === 0) {
          // Ensure cache contains a default rendering for empty diffs
          entry.renderedByKey!.set(key, DEFAULT_NO_DIFF_HTML);
          diffCacheRef.current.set(cacheKey, entry);
        } else {
          if (!entry.renderedByKey!.has(key)) {
            const html =
              view === "unified"
                ? renderUnified(filesSlice)
                : renderSplit(filesSlice);
            entry.renderedByKey!.set(key, html);
            diffCacheRef.current.set(cacheKey, entry);
          }
        }

        setDiffHtml(entry.renderedByKey!.get(key) || DEFAULT_NO_DIFF_HTML);
      } catch (e: any) {
        setError(e.message || "Failed to load diff");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [commit, repoPath, open, view, visibleCount, refreshTick]);

  // Clear cache when switching branches as requested
  useEffect(() => {
    // Reset all cached diffs when branch changes
    diffCacheRef.current.clear();
    setDiffHtml("");
    setError(null);
    setVisibleCount(CHUNK_SIZE);
    // Loading will be handled by the main effect when commit/open conditions are met
  }, [branch]);

  // When switching commits, reset visible count so we start from the top
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [commit]);

  // Incrementally increase visible files on scroll near bottom
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        // try to load more files if available
        const cacheKey = commit ? `${repoPath}::${commit.hash}` : "";
        const entry = cacheKey ? diffCacheRef.current.get(cacheKey) : undefined;
        const total = entry?.totalFiles || 0;
        if (visibleCount < total) {
          setVisibleCount((c) => Math.min(c + CHUNK_SIZE, total));
        }
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [open, visibleCount, commit, repoPath]);

  // Note: Do not clear diffHtml on close to avoid expensive DOM teardown before unmount.
  // The dialog unmount will remove the large DOM; keeping state prevents an extra re-render.

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keep content mounted to avoid heavy DOM teardown on close for large diffs */}
      <DialogContent
        forceMount
        fullScreen
        className="p-0 overflow-hidden flex flex-col"
      >
        <DialogHeader className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 truncate">
                <GitCommit className="h-4 w-4 shrink-0" />
                <span className="truncate">{title}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                {commit && (
                  <>
                    <Badge variant="secondary">
                      {commit.hash?.slice(0, 7)}
                    </Badge>
                    <span>by {commit.author}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(commit.date), "PPpp")}
                    </span>
                  </>
                )}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const isWorking =
                  !!commit &&
                  (commit.isWorkingDir ||
                    commit.kind === "working" ||
                    commit.hash === "WORKING_DIR");
                const isRootCommit =
                  !!commit &&
                  !isWorking &&
                  (!commit.parents || commit.parents.length === 0);

                // Show commit/expand button based on diff type
                const handleVibeAction = async () => {
                  if (!commit) return;

                  // Close dialog immediately when command starts or to show api manager
                  onOpenChange(false);

                  // Check if API is configured
                  const currentConfig =
                    localApiConfiguration || apiConfiguration;
                  if (!currentConfig?.model || !currentConfig?.apiKey) {
                    // Show API manager if not configured
                    setShowApiManager(true);
                    return;
                  }

                  const command = isWorking ? "commit" : "expand";
                  const args = isWorking ? ["-y", "."] : ["-y", commit.hash];

                  try {
                    setIsExecuting(true);
                    await executeVibeCommandWithFlow(
                      command,
                      args,
                      repoPath,
                      commit.hash,
                      {
                        model: currentConfig.model,
                        apiKey: currentConfig.apiKey,
                        // We rely on the subscription in GitVisualizer to trigger the refresh
                        // with the correct isVibeRefresh flag, so we don't need to trigger
                        // onBranchRefreshNeeded here which would cause a double refresh
                        // and potentially reset the isVibeRefresh flag too early.
                      },
                    );
                  } catch (error: any) {
                    console.error("Failed to execute vibe command:", error);
                  } finally {
                    setIsExecuting(false);
                  }
                };

                // Only show action button if it's working dir or not a root commit
                const actionButton =
                  isWorking || !isRootCommit ? (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleVibeAction}
                      disabled={loading || isExecuting}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {isWorking ? (
                        <>
                          <Save className="h-4 w-4 mr-1" />
                          Commit
                        </>
                      ) : (
                        <>
                          <GitBranch className="h-4 w-4 mr-1" />
                          Expand
                        </>
                      )}
                    </Button>
                  ) : null;

                const reloadButton = isWorking ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!commit) return;
                      const cacheKey = `${repoPath}::${commit.hash}`;
                      diffCacheRef.current.delete(cacheKey);
                      setDiffHtml("");
                      setError(null);
                      setVisibleCount(CHUNK_SIZE);
                      // scroll to top for better UX
                      try {
                        scrollRef.current?.scrollTo?.({ top: 0 });
                      } catch { }
                      setRefreshTick((t) => t + 1);
                    }}
                    disabled={loading}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" /> Reload
                  </Button>
                ) : null;

                return (
                  <>
                    {actionButton}
                    {reloadButton}
                  </>
                );
              })()}
              <ButtonGroup>
                <Button
                  size="sm"
                  variant={view === "unified" ? "default" : "outline"}
                  onClick={() => setView("unified")}
                >
                  Unified
                </Button>
                <Button
                  size="sm"
                  variant={view === "split" ? "default" : "outline"}
                  onClick={() => setView("split")}
                >
                  Split
                </Button>
              </ButtonGroup>
            </div>
          </div>
        </DialogHeader>
        <Separator />
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {loading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Loading diff…
            </div>
          )}
          {error && <div className="p-6 text-sm text-red-500">{error}</div>}
          {/* Progress indicator and manual load-more */}
          {!loading && !error && (
            <div className="px-4 pt-4 text-xs text-muted-foreground">
              {(() => {
                const cacheKey = commit ? `${repoPath}::${commit.hash}` : "";
                const entry = cacheKey
                  ? diffCacheRef.current.get(cacheKey)
                  : undefined;
                const total = entry?.totalFiles || 0;
                return total > 0
                  ? `Showing ${Math.min(visibleCount, total)} of ${total} files`
                  : null;
              })()}
            </div>
          )}
          {!loading && !error && diffHtml && (
            // Contain heavy diff DOM to isolate layout/paint work for faster hide/close
            <div
              className="diff2html-wrapper p-4"
              style={{ contain: "content" as any }}
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          )}
          {!loading && !error && !diffHtml && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No changes in this commit
            </div>
          )}
          {!loading && !error && (
            <div className="p-4 flex items-center justify-center">
              {(() => {
                const cacheKey = commit ? `${repoPath}::${commit.hash}` : "";
                const entry = cacheKey
                  ? diffCacheRef.current.get(cacheKey)
                  : undefined;
                const total = entry?.totalFiles || 0;
                if (visibleCount < total) {
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setVisibleCount((c) => Math.min(c + CHUNK_SIZE, total))
                      }
                    >
                      Load more
                    </Button>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      </DialogContent>

      {/* API Key Manager */}
      <ApiKeyManager
        open={showApiManager}
        onOpenChange={setShowApiManager}
        onConfigurationChange={handleApiConfigurationChange}
        currentModel={localApiConfiguration?.model}
        currentApiKey={localApiConfiguration?.apiKey}
      />
    </Dialog>
  );
}
