import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  CSSProperties,
} from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import { SearchBar } from "@/components/search-bar";
import { getVsCodeApi } from "@/lib/vscode";
import { DiffDialog } from "./DiffDialog";
import { cn } from "@/lib/utils";
import { Spinner } from "./ui/spinner";
import { Plus, Minus } from "lucide-react";
import { Button } from "./ui/button";

// Register layout plugin (client-only)
if (typeof window !== "undefined") {
  try {
    cytoscape.use(dagre);
  } catch {
    // no-op if already registered
  }
}

interface CommitNode {
  id: string;
  label: string;
  hash: string;
  message: string;
  author: string;
  date: string;
  parents?: string[];
  kind?: string;
  isWorkingDir?: boolean;
  isMerge?: boolean;
  isMergeAncestor?: boolean;
  isRoot?: boolean;
}

interface GitVisualizerProps {
  repoPath: string;
  branch: string;
  onCommitSelect: (commit: any) => void;
  selectedCommit: any;
  isLoading?: boolean;
  apiConfiguration?: {
    provider: string;
    model: string;
    globalConfig: Record<string, any>;
  } | null;
  onOpenApiManager?: () => void;
}

export function GitVisualizer({
  repoPath,
  branch,
  onCommitSelect,
  selectedCommit,
  isLoading = false,
  apiConfiguration = null,
  onOpenApiManager,
}: GitVisualizerProps) {
  type ReloadSource = "initial" | "manual" | "git" | "workdir" | "load_more";
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const cyRef = useRef<Core | null>(null);
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [executingCommits, setExecutingCommits] = useState<Set<string>>(
    new Set(),
  );
  const [commitLimit, setCommitLimit] = useState(100);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const lastReloadSourceRef = useRef<ReloadSource>("initial");
  const anchorNodeIdRef = useRef<string | null>(null);
  const vscode = getVsCodeApi();

  const fetchCommits = useCallback(
    (source: ReloadSource = "manual", limit = 100) => {
      if (!repoPath) return;
      setLoading(true);
      setIsLayoutReady(false);
      setIsDiffOpen(false);
      const message: any = {
        command: "loadRepo",
        directory: repoPath,
        source,
        limit,
      };
      if (branch) message.branch = branch;
      vscode.postMessage(message);
    },
    [repoPath, branch, vscode],
  );

  useEffect(() => {
    if (repoPath) {
      setCommitLimit(100);
      fetchCommits("initial", 100);
    }
  }, [repoPath, branch, fetchCommits]);

  // Effect to handle commitLimit changes specifically for LOAD_MORE
  useEffect(() => {
    // Skip initial load which is handled above
    if (commitLimit > 100 && repoPath) {
      fetchCommits("load_more", commitLimit);
    }
  }, [commitLimit, repoPath, fetchCommits]);

  // Handle messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "displayCommits":
          {
            const incoming: CommitNode[] = message.commits || [];
            if (incoming.length === 0) {
              setCommits([]);
              setLoading(false);
              return;
            }

            // Create a map for O(1) lookup
            const commitMap = new Map<string, CommitNode>();
            for (const c of incoming) commitMap.set(c.id, c);

            // Identify merge commits and their ancestors using O(N) traversal
            const mergeCommits = new Set<string>();
            const mergeAncestors = new Set<string>();

            for (const c of incoming) {
              if (c.parents && c.parents.length > 1) {
                mergeCommits.add(c.id);
                // Traverse parents to find all merge ancestors
                const stack = [...c.parents];
                while (stack.length > 0) {
                  const pid = stack.pop()!;
                  if (!mergeAncestors.has(pid)) {
                    mergeAncestors.add(pid);
                    const parent = commitMap.get(pid);
                    if (parent?.parents) {
                      stack.push(...parent.parents);
                    }
                  }
                }
              }
            }

            const processed = incoming.map((c) => ({
              ...c,
              isMerge: mergeCommits.has(c.id),
              isMergeAncestor: mergeAncestors.has(c.id),
              isRoot: !c.parents || c.parents.length === 0,
            }));

            // Add "Load More" node if the backend says more exist
            if (message.hasMore) {
              const oldestCommit = processed[processed.length - 1];
              if (oldestCommit) {
                // Add LOAD_MORE as a node
                processed.push({
                  id: "LOAD_MORE",
                  label: "LOAD MORE...",
                  hash: "LOAD_MORE",
                  message: "Load more commits",
                  author: "system",
                  date: "",
                  parents: [],
                  kind: "load_more",
                } as any);
                // Make it a parent of the oldest commit in the current batch
                oldestCommit.parents = [
                  ...(oldestCommit.parents || []),
                  "LOAD_MORE",
                ];
              }
            }

            setCommits(processed);
            lastReloadSourceRef.current = message.source || "manual";
            setLoading(false);
            setIsLayoutReady(false);
            setIsDiffOpen(false);
          }
          break;
        case "loadError":
          setLoading(false);
          setIsLayoutReady(true);
          break;
        case "displayOutput":
          // console.log(message.data);
          break;
        case "resetExecuting":
          setExecutingCommits(new Set());
          setExecutionTime(0);

          // Reset node data and styles immediately
          if (cyRef.current) {
            cyRef.current.nodes().forEach((node: any) => {
              node.data("isExecuting", "false");
              node.removeStyle();
              node.removeClass("was-pulsing");
            });
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const elements = useMemo(() => {
    if (!commits?.length) return [];
    const ids = new Set(commits.map((c) => c.id));
    const nodes = commits.map((c, index) => {
      let label = c.label;
      return {
        data: {
          id: c.id,
          label: label,
          index: index,
          kind: (c as any).kind,
          isMerge: c.isMerge,
          isMergeAncestor: c.isMergeAncestor,
          isRoot: c.isRoot,
          ...(executingCommits.has(c.hash) ? { isExecuting: "true" } : {}),
        },
      };
    });
    const edges: any[] = [];
    for (const child of commits) {
      for (const parent of child.parents || []) {
        if (ids.has(parent)) {
          const id = `${parent}->${child.id}`;
          edges.push({ data: { id, source: parent, target: child.id } });
        }
      }
    }
    return [...nodes, ...edges];
  }, [commits, executingCommits]);

  const layout = useMemo(
    () => ({
      name: "dagre",
      rankDir: "LR",
      nodeSep: 35,
      edgeSep: 20,
      rankSep: 60,
      fit: false,
      padding: 30,
      animate: false,
    }),
    [],
  );

  const [themeColors, setThemeColors] = useState({
    foreground: "#888888",
    background: "#1e1e1e",
    primary: "#007acc",
    added: "#28a745",
    modified: "#ffc107",
  });

  useEffect(() => {
    const updateColors = () => {
      const style = window.getComputedStyle(document.body);
      setThemeColors({
        foreground:
          style.getPropertyValue("--vscode-editor-foreground").trim() ||
          "#888888",
        background:
          style.getPropertyValue("--vscode-editor-background").trim() ||
          "#1e1e1e",
        primary:
          style.getPropertyValue("--vscode-button-background").trim() ||
          "#007acc",
        added:
          style
            .getPropertyValue("--vscode-gitDecoration-addedResourceForeground")
            .trim() || "#28a745",
        modified:
          style
            .getPropertyValue(
              "--vscode-gitDecoration-modifiedResourceForeground",
            )
            .trim() || "#ffc107",
      });
    };

    updateColors();
    const observer = new MutationObserver(updateColors);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": themeColors.foreground,
          label: "data(label)",
          color: themeColors.foreground,
          "font-family":
            'var(--vscode-editor-font-family, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace)',
          "font-size": 10,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 2,
          width: 12,
          height: 12,
          "border-width": 0,
          "overlay-opacity": 0,
          "overlay-shape": "ellipse",
          "text-wrap": "wrap",
          "text-max-width": 80,
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 2,
          "border-color": themeColors.primary,
          "background-color": themeColors.primary,
          width: 12,
          height: 12,
        },
      },
      {
        selector: 'node[kind = "working"]',
        style: {
          "background-color": themeColors.modified,
        },
      },
      {
        selector: 'node[kind = "load_more"]',
        style: {
          "background-color": themeColors.primary,
          color: "#fff",
          width: 80,
          height: 24,
          shape: "round-rectangle",
          "text-valign": "center",
          "text-halign": "center",
          "font-size": 9,
          "font-weight": "bold",
        },
      },
      {
        selector: 'node[isExecuting = "true"]',
        style: {
          "border-width": 2,
          "border-color": themeColors.added,
          "border-style": "solid",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": themeColors.foreground,
          "line-opacity": 0.3,
          "target-arrow-color": themeColors.foreground,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "arrow-scale": 0.6,
        },
      },
      {
        selector: "edge:selected",
        style: {
          width: 1.5,
          "line-color": themeColors.primary,
          "target-arrow-color": themeColors.primary,
        },
      },
    ],
    [themeColors],
  );

  // Memoize inline style object to prevent re-renders
  const cytoscapeStyle = useMemo<CSSProperties>(
    () => ({ width: "100%", height: "100%" }),
    [],
  );

  const onCyInit = useCallback((cy: Core) => {
    cyRef.current = cy;
    setCyInstance(cy);
    cy.resize();
    cy.boxSelectionEnabled(false);
    cy.autoungrabify(true);
    cy.userZoomingEnabled(true);
    cy.userPanningEnabled(true);
    cy.minZoom(0.2);
    cy.maxZoom(2);

    // Limit panning to keep nodes in view
    let isClamping = false;
    cy.on("viewport", () => {
      if (isClamping || cy.nodes().empty()) return;

      const box = cy.nodes().boundingBox();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const width = cy.width();
      const height = cy.height();

      // Keep at least a small part of the graph visible
      const padding = 30;
      const minPanX = padding - box.x2 * zoom;
      const maxPanX = width - padding - box.x1 * zoom;
      const minPanY = padding - box.y2 * zoom;
      const maxPanY = height - padding - box.y1 * zoom;

      let newPanX = pan.x;
      let newPanY = pan.y;
      let changed = false;

      if (pan.x < minPanX) {
        newPanX = minPanX;
        changed = true;
      } else if (pan.x > maxPanX) {
        newPanX = maxPanX;
        changed = true;
      }

      if (pan.y < minPanY) {
        newPanY = minPanY;
        changed = true;
      } else if (pan.y > maxPanY) {
        newPanY = maxPanY;
        changed = true;
      }

      if (changed) {
        isClamping = true;
        cy.pan({ x: newPanX, y: newPanY });
        isClamping = false;
      }
    });

    // Basic pulsing animation setup
    let animationFrame: number;
    let startTime = Date.now();
    let isRunning = true;

    const animatePulsing = () => {
      if (!isRunning || cy.destroyed()) return;

      const currentTime = Date.now();
      const elapsed = currentTime - startTime;

      try {
        // Clean up nodes that stopped pulsing (only those with the marker class)
        cy.nodes(".was-pulsing")
          .filter((node: any) => node.data("isExecuting") !== "true")
          .forEach((node: any) => {
            node.removeStyle();
            node.removeClass("was-pulsing");
          });

        // Pulse executing nodes using the reference logic
        cy.nodes('[isExecuting = "true"]').forEach((node: any) => {
          const pulse = Math.sin(elapsed / 400) * 0.5 + 0.5; // 0 to 1
          const opacity = 0.3 + pulse * 0.7; // 0.3 to 1.0
          const scale = 1 + pulse * 0.3; // 1.0 to 1.3

          node.style({
            "border-opacity": opacity,
            width: 18 * scale,
            height: 18 * scale,
          });
          node.addClass("was-pulsing");
        });
      } catch (e) {
        isRunning = false;
        return;
      }
      animationFrame = requestAnimationFrame(animatePulsing);
    };

    animatePulsing();
    (cy as any).__animationCleanup = () => {
      isRunning = false;
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (selectedCommit === null) {
      setSelectedId(null);
      setIsDiffOpen(false);
      if (cyInstance) {
        cyInstance.elements().unselect();
      }
    } else {
      setSelectedId(selectedCommit.id);
    }
  }, [selectedCommit, cyInstance]);

  useEffect(() => {
    if (!cyInstance || !selectedId) return;
    const node = cyInstance.getElementById(selectedId);
    if (node.nonempty()) {
      cyInstance.elements().unselect();
      node.select();
    }
  }, [cyInstance, selectedId, elements]);

  useEffect(() => {
    if (!cyInstance) return;
    const handleNodeTap = (evt: any) => {
      const tappedId = evt.target.id();
      if (tappedId === "LOAD_MORE") {
        const anchor = commits.find((c) => c.parents?.includes("LOAD_MORE"));
        if (anchor) anchorNodeIdRef.current = anchor.id;
        setCommitLimit((prev) => prev + 100);
        return;
      }

      const commit = commits.find((c) => c.id === tappedId);
      console.log("GitVisualizer: node tapped", commit?.hash);
      if (commit) {
        setSelectedId(commit.id);
        setIsDiffOpen(true);
        onCommitSelect(commit);
      }
    };
    cyInstance.on("tap", "node", handleNodeTap);
    return () => {
      if (cyInstance && !cyInstance.destroyed())
        cyInstance.off("tap", "node", handleNodeTap);
    };
  }, [commits, onCommitSelect, cyInstance, repoPath, vscode, commitLimit]);

  useEffect(() => {
    return () => {
      const cy = cyRef.current;
      if (cy && (cy as any).__animationCleanup)
        (cy as any).__animationCleanup();
      cyRef.current = null;
    };
  }, []);

  // Layout runner
  useEffect(() => {
    if (!cyInstance || !elements.length) {
      if (elements.length === 0) setIsLayoutReady(true);
      return;
    }

    setIsLayoutReady(false);

    const onLayoutStop = () => {
      // If we are loading more, center on the anchor node instead of fitting everything
      try {
        if (
          lastReloadSourceRef.current === "load_more" &&
          anchorNodeIdRef.current &&
          cyInstance
        ) {
          const node = cyInstance.getElementById(anchorNodeIdRef.current);
          if (node.nonempty()) {
            cyInstance.center(node);
          }
          anchorNodeIdRef.current = null;
        } else {
          const recentNodes = cyInstance.nodes("[index < 10]");
          cyInstance.fit(recentNodes.nonempty() ? recentNodes : undefined, 30);
        }
      } catch {
        // Ignore fit errors
      }
      setIsLayoutReady(true);
    };

    cyInstance.one("layoutstop", onLayoutStop);

    const frame = requestAnimationFrame(() => {
      if (!cyInstance || cyInstance.destroyed()) return;
      try {
        const l = cyInstance.layout(layout as any);
        if (l && typeof l.run === "function") {
          l.run();
        } else {
          setIsLayoutReady(true);
        }
      } catch {
        setIsLayoutReady(true);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (cyInstance && !cyInstance.destroyed()) {
        cyInstance.off("layoutstop", onLayoutStop);
      }
    };
  }, [elements, layout, commits, cyInstance]);

  const showLoading = isLoading || loading || !isLayoutReady;

  // Memoized callback for SearchBar to prevent unnecessary re-renders
  const handleSearchCommitSelect = useCallback(
    (commit: CommitNode) => {
      setSelectedId(commit.id);
      setIsDiffOpen(true);
      onCommitSelect(commit);
      if (cyInstance) {
        const node = cyInstance.getElementById(commit.id);
        if (node.nonempty()) {
          cyInstance.elements().unselect();
          node.select();
          cyInstance.center(node);
        }
      }
    },
    [cyInstance, onCommitSelect],
  );

  // Memoized callback for DiffDialog onExecute to prevent unnecessary re-renders
  const handleExecute = useCallback((hash: string) => {
    // Mark this commit as executing
    setExecutionTime(Date.now());
    setExecutingCommits((prev) => {
      const next = new Set(prev);
      next.add(hash);
      return next;
    });

    // Also set the node data so the Cy instance can pick it up immediately
    if (cyRef.current) {
      const node = cyRef.current.getElementById(hash);
      if (node && node.nonempty()) node.data("isExecuting", "true");
    }
  }, []);

  if (commits.length === 0 && !showLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground bg-background text-xs font-medium tracking-wide opacity-50">
        NO REPOSITORY LOADED
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-background overflow-hidden">
      <div
        className={cn(
          "h-full w-full transition-opacity duration-300",
          showLoading ? "opacity-0" : "opacity-100",
        )}
      >
        <CytoscapeComponent
          key={`${repoPath}:${branch}`}
          elements={elements as any}
          cy={onCyInit}
          stylesheet={stylesheet as any}
          layout={layout as any}
          wheelSensitivity={0.5}
          style={cytoscapeStyle}
        />
      </div>

      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
          <div className="flex items-center text-muted-foreground text-xs">
            <Spinner className="mr-2 h-3 w-3" />
            Loading...
          </div>
        </div>
      )}

      {/* Search bar - top right, shifted past branch selector on mobile */}
      <div
        className={cn(
          "absolute top-12 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto z-10 transition-opacity duration-300",
          showLoading ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      >
        <SearchBar
          commits={commits}
          onCommitSelect={handleSearchCommitSelect}
        />
      </div>

      {/* Zoom controls - bottom right, vertical */}
      <div
        className={cn(
          "absolute bottom-4 right-4 z-10 transition-opacity duration-300",
          showLoading ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      >
        <div className="flex flex-col gap-1 bg-background/80 backdrop-blur-sm border border-border/50 p-1 rounded-md shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (cyInstance) {
                const currentZoom = cyInstance.zoom();
                cyInstance.zoom({
                  level: currentZoom * 1.2,
                  renderedPosition: {
                    x: cyInstance.width() / 2,
                    y: cyInstance.height() / 2,
                  },
                });
              }
            }}
            title="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (cyInstance) {
                const currentZoom = cyInstance.zoom();
                cyInstance.zoom({
                  level: currentZoom * 0.8,
                  renderedPosition: {
                    x: cyInstance.width() / 2,
                    y: cyInstance.height() / 2,
                  },
                });
              }
            }}
            title="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <DiffDialog
        open={isDiffOpen}
        onOpenChange={setIsDiffOpen}
        repoPath={repoPath}
        branch={branch}
        commit={selectedCommit}
        isAnyExecuting={executingCommits.size > 0}
        isCurrentExecuting={
          selectedCommit ? executingCommits.has(selectedCommit.hash) : false
        }
        apiConfiguration={apiConfiguration}
        onOpenApiManager={onOpenApiManager}
        onExecute={handleExecute}
      />
    </div>
  );
}
