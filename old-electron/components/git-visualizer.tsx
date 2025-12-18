"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape, { Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import { apiService } from "@/lib/ipc-api";
import {
  subscribeToExecutionState,
  subscribeToRefreshNeeds,
  getExecutingCommits,
} from "@/lib/vibe-command-executor";
import {
  ApiKeyManager,
  ApiKeyManagerToggle,
  AVAILABLE_MODELS,
} from "@/components/api-key-manager";
import { SearchBar } from "@/components/search-bar";

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
}

export function GitVisualizer({
  repoPath,
  branch,
  onCommitSelect,
  isLoading,
  onApiConfigurationChange,
}: {
  repoPath: string;
  branch: string;
  onCommitSelect: (commit: any) => void;
  isLoading: boolean;
  onApiConfigurationChange?: (
    config: { model: string; apiKey: string } | null,
  ) => void;
}) {
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [loading, setLoading] = useState(false);
  const cyRef = useRef<Core | null>(null);
  const [cyInstance, setCyInstance] = useState<Core | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executingCommits, setExecutingCommits] = useState<Set<string>>(
    new Set(),
  );
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const previousCommitsRef = useRef<CommitNode[]>([]);

  // API key manager state
  const [showApiKeyManager, setShowApiKeyManager] = useState(false);
  const [apiConfiguration, setApiConfiguration] = useState<{
    model: string;
    apiKey: string;
  } | null>(null);

  // Check if API is configured
  const isApiConfigured = apiConfiguration?.model && apiConfiguration?.apiKey;

  const fetchCommits = useCallback(
    async (isVibeRefresh = false) => {
      try {
        setLoading(true);
        const data = await apiService.git.getCommits(repoPath, branch);
        const newCommits = data.commits || [];

        // If this is a vibe refresh, identify newly added nodes
        if (isVibeRefresh) {
          const previousDates = new Set(
            previousCommitsRef.current.map((c) => c.date),
          );
          const newIds = new Set<string>();

          // Find commits that weren't in the previous set
          newCommits.forEach((commit: CommitNode) => {
            if (!previousDates.has(commit.date) && commit.kind != "working") {
              newIds.add(commit.id);
            }
          });

          if (newIds.size > 0) {
            setNewNodeIds(newIds);
          }
        } else {
          setNewNodeIds(new Set());
        }

        setCommits(newCommits);
      } catch (error) {
        console.error("Failed to fetch commits:", error);
      } finally {
        setLoading(false);
      }
    },
    [repoPath, branch],
  );

  useEffect(() => {
    if (repoPath && branch) fetchCommits();
  }, [repoPath, branch, fetchCommits]);

  // Subscribe to execution state changes for node animations
  useEffect(() => {
    const unsubscribeExecution = subscribeToExecutionState(() => {
      setExecutingCommits(getExecutingCommits());
    });

    // Subscribe to refresh needs for branch reloading
    const unsubscribeRefresh = subscribeToRefreshNeeds(
      (isVibeRefresh: boolean) => {
        // Auto-refresh after a short delay to allow the vibe command to complete its file operations
        setTimeout(() => {
          if (repoPath && branch) {
            fetchCommits(isVibeRefresh);
          }
        }, 1000);
      },
    );

    // Initial state sync
    setExecutingCommits(getExecutingCommits());

    return () => {
      unsubscribeExecution();
      unsubscribeRefresh();
    };
  }, [repoPath, branch, fetchCommits]);

  // Track previous commits for comparison on refresh
  useEffect(() => {
    previousCommitsRef.current = commits;
  }, [commits]);

  // Load saved API configuration on mount
  useEffect(() => {
    const loadConfig = async () => {
      if (typeof window === "undefined") return;

      let savedModel = sessionStorage.getItem("vibe_selected_model");
      let savedApiKey = sessionStorage.getItem("vibe_api_key");

      // If not in session storage, try secure store
      if (!savedApiKey && window.electronAPI?.secureStore?.getApiKey) {
        try {
          const secureKey = await window.electronAPI.secureStore.getApiKey();
          if (secureKey) {
            savedApiKey = secureKey;
            // Default to first model if not set
            if (!savedModel) {
              savedModel = AVAILABLE_MODELS[0].id;
            }
            // Sync back to session storage
            sessionStorage.setItem("vibe_api_key", savedApiKey);
            sessionStorage.setItem("vibe_selected_model", savedModel);
          }
        } catch (e) {
          console.error("Failed to load API key from secure store:", e);
        }
      }

      if (savedModel && savedApiKey) {
        setApiConfiguration({ model: savedModel, apiKey: savedApiKey });
      } else {
        // No API key found, show manager automatically
        setShowApiKeyManager(true);
      }
    };

    loadConfig();
  }, []);

  // Expose API configuration for use by other components that need vibe commands
  const handleApiConfigurationChange = useCallback(
    (config: { model: string; apiKey: string }) => {
      setApiConfiguration(config);
      onApiConfigurationChange?.(config);
    },
    [onApiConfigurationChange],
  );

  const elements = useMemo(() => {
    if (!commits?.length) return [];
    const ids = new Set(commits.map((c) => c.id));
    const nodes = commits.map((c, index) => ({
      data: {
        id: c.id,
        label: c.label,
        index: index,
        kind: (c as any).kind,
        ...(executingCommits.has(c.hash) ? { isExecuting: true } : {}),
        ...(newNodeIds.has(c.id) ? { isNewNode: true } : {}),
      },
    }));
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
  }, [commits, executingCommits, newNodeIds]);

  const layout = useMemo(
    () => ({
      name: "dagre",
      rankDir: "LR", // left-to-right
      nodeSep: 35, // Increased vertical separation between nodes
      edgeSep: 20, // Increased separation between edges
      rankSep: 60, // Increased horizontal separation between ranks
      fit: false,
      padding: 30,
      animate: false,
    }),
    [],
  );

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "hsl(262, 83%, 64%)", // violet
          label: "data(label)",
          color: "hsl(262, 83%, 55%)",
          "font-family":
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          "font-size": 12,
          "text-valign": "top",
          "text-halign": "center",
          "text-margin-y": -10,
          width: 14,
          height: 14,
          "border-width": 0,
          "overlay-opacity": 0.001,
          "overlay-padding": 3,
          "overlay-color": "transparent",
          "text-wrap": "wrap",
          "text-max-width": 40,
          "text-overflow-wrap": "anywhere",
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 3,
          "border-color": "hsl(262, 83%, 80%)",
          width: 16,
          height: 16,
        },
      },
      {
        selector: 'node[kind = "working"]',
        style: {
          "background-color": "hsl(24, 94%, 80%)",
        },
      },
      {
        selector: "node[isExecuting]",
        style: {
          "border-width": 3,
          "border-color": "hsl(142, 76%, 36%)", // green pulsating ring
          "border-style": "solid",
          width: 18,
          height: 18,
        },
      },
      {
        selector: "node[isNewNode]",
        style: {
          "background-color": "hsl(24, 94%, 50%)", // orange color
          "border-width": 2,
          "border-color": "hsl(24, 94%, 60%)", // lighter orange border
          "border-style": "solid",
          width: 16,
          height: 16,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.5,
          "line-color": "hsl(215, 20%, 65%)",
          "target-arrow-color": "hsl(215, 20%, 65%)",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: "edge:selected",
        style: {
          width: 2.5,
          "line-color": "hsl(262, 83%, 64%)",
          "target-arrow-color": "hsl(262, 83%, 64%)",
        },
      },
    ],
    [],
  );

  // Theme-aware background via parent container; Cytoscape canvas is transparent

  const onCyInit = (cy: Core) => {
    cyRef.current = cy;
    setCyInstance(cy);
    // Ensure the canvas matches container on mount
    cy.resize();

    // Configure static interaction settings
    cy.boxSelectionEnabled(false);
    cy.autoungrabify(true);
    cy.userZoomingEnabled(true);
    cy.userPanningEnabled(true);
    cy.minZoom(0.5); // Set a safe initial minimum zoom
    cy.maxZoom(5); // Limit max zoom to prevent getting lost

    // Restrict panning to keep graph in view
    let isCorrectingPan = false;
    let panDebounceTimer: NodeJS.Timeout;

    cy.on('pan', () => {
      if (isCorrectingPan) return;

      clearTimeout(panDebounceTimer);
      panDebounceTimer = setTimeout(() => {
        const ext = cy.extent();
        const bounds = cy.elements().boundingBox();

        // If the graph is empty, don't restrict
        if (bounds.w === 0 || bounds.h === 0) return;

        // Check if the graph is completely out of view
        const isOutOfView =
          ext.x1 > bounds.x2 ||
          ext.x2 < bounds.x1 ||
          ext.y1 > bounds.y2 ||
          ext.y2 < bounds.y1;

        if (isOutOfView) {
          const pan = cy.pan();
          const zoom = cy.zoom();
          const w = cy.width();
          const h = cy.height();

          // Calculate rendered bounds of the graph
          const renderedX1 = bounds.x1 * zoom + pan.x;
          const renderedY1 = bounds.y1 * zoom + pan.y;
          const renderedX2 = bounds.x2 * zoom + pan.x;
          const renderedY2 = bounds.y2 * zoom + pan.y;

          let newPanX = pan.x;
          let newPanY = pan.y;

          // Correction amount
          const padding = 50; // Keep at least 50px visible

          if (renderedX2 < padding) {
            newPanX = padding - bounds.x2 * zoom;
          } else if (renderedX1 > w - padding) {
            newPanX = w - padding - bounds.x1 * zoom;
          }

          if (renderedY2 < padding) {
            newPanY = padding - bounds.y2 * zoom;
          } else if (renderedY1 > h - padding) {
            newPanY = h - padding - bounds.y1 * zoom;
          }

          if (newPanX !== pan.x || newPanY !== pan.y) {
            isCorrectingPan = true;
            cy.pan({ x: newPanX, y: newPanY });
            isCorrectingPan = false;
          }
        }
      }, 100); // Debounce delay to prevent fighting with zoom
    });




    // The animation setup can stay here as it doesn't depend on the `commits` array
    let animationFrame: number;
    let startTime = Date.now();
    let isRunning = true;

    const animatePulsing = () => {
      if (!isRunning || cy.destroyed()) {
        return;
      }

      const currentTime = Date.now();
      const elapsed = currentTime - startTime;

      try {
        const executingNodes = cy.nodes("[isExecuting]");
        executingNodes.forEach((node: any) => {
          // Create a pulsating effect using sine wave for opacity and scale
          const pulse = Math.sin(elapsed / 400) * 0.5 + 0.5; // 0 to 1
          const opacity = 0.3 + pulse * 0.7; // 0.3 to 1.0
          const scale = 1 + pulse * 0.3; // 1.0 to 1.3

          node.style({
            "border-opacity": opacity,
            width: 18 * scale,
            height: 18 * scale,
          });
        });

        // Animate new nodes with orange pulsing effect
        const newNodes = cy.nodes("[isNewNode]");
        newNodes.forEach((node: any) => {
          // Create a pulsating effect for new nodes
          const pulse = Math.sin(elapsed / 300) * 0.5 + 0.5; // 0 to 1, faster than executing
          const opacity = 0.6 + pulse * 0.4; // 0.6 to 1.0
          const scale = 1 + pulse * 0.2; // 1.0 to 1.4
          const borderOpacity = 0.5 + pulse * 0.5; // 0.5 to 1.0

          node.style({
            "background-opacity": opacity,
            "border-opacity": borderOpacity,
            width: 16 * scale,
            height: 16 * scale,
          });
        });
      } catch (e) {
        // Stop animation on error to prevent infinite error loops
        console.warn("Animation error, stopping loop:", e);
        isRunning = false;
        return;
      }

      animationFrame = requestAnimationFrame(animatePulsing);
    };

    animatePulsing();

    (cy as any).__animationCleanup = () => {
      isRunning = false;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  };

  useEffect(() => {
    if (!cyInstance) return;

    const handleNodeTap = (evt: cytoscape.EventObject) => {
      const node = evt.target;
      const id = node.id();
      const commit = commits.find((c) => c.id === id);
      if (commit) {
        onCommitSelect(commit);
      }
    };

    cyInstance.on("tap", "node", handleNodeTap);

    return () => {
      // Cleanup function removes the old listener
      if (cyInstance && !cyInstance.destroyed()) {
        cyInstance.off("tap", "node", handleNodeTap);
      }
    };
  }, [commits, onCommitSelect, cyInstance]);

  // Cleanup cytoscape reference on unmount
  useEffect(() => {
    return () => {
      const cy = cyRef.current;
      if (cy && (cy as any).__animationCleanup) {
        (cy as any).__animationCleanup();
      }
      cyRef.current = null;
    };
  }, []);

  // Handle container resize
  useEffect(() => {
    const onResize = () => {
      const cy = cyRef.current;
      if (!cy) return;
      try {
        cy.resize();
        const recentNodes = cy.nodes("[index < 10]")
        cy.fit(recentNodes.nonempty() ? recentNodes : undefined, 30);
        updateMinZoom(cy);
      } catch (error) {
        console.warn("Resize error:", error);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [commits]);

  // Helper to update minZoom based on graph size
  const updateMinZoom = (cy: Core) => {
    try {
      // Calculate the zoom level needed to fit the entire graph
      // We use a slightly larger padding (50) to ensure it's not too tight
      const bounds = cy.elements().boundingBox();
      if (bounds.w === 0 || bounds.h === 0) return;

      const width = cy.width();
      const height = cy.height();

      // Calculate zoom to fit
      const zoomW = width / (bounds.w + 100); // 50px padding on each side
      const zoomH = height / (bounds.h + 100);
      const minZoom = Math.min(zoomW, zoomH);

      // Apply minZoom, but cap it at 1 to avoid zooming in too much if the graph is tiny
      // And ensure it's not too small (e.g. 0.05)
      cy.minZoom(Math.max(0.05, Math.min(1, minZoom)));
    } catch (e) {
      console.warn("Failed to update minZoom", e);
    }
  };

  // Re-run layout when commit set changes size to avoid race conditions during rapid branch switches
  useEffect(() => {
    if (!cyInstance) return;
    const elementCount = elements.length;
    if (!elementCount) return;
    // Defer layout to next frame to ensure Cytoscape has applied React prop diff
    const frame = requestAnimationFrame(() => {
      if (!cyInstance || cyInstance.destroyed()) return;
      try {
        const l = cyInstance.layout(layout as any);
        if (l && typeof l.run === "function") {
          l.run();
          // Fit with padding if still mounted
          if (!cyInstance.destroyed()) {
            // After layout, fit to last 10 commits for focused view
            const recentNodes = cyInstance.nodes("[index < 10]")
            cyInstance.fit(recentNodes.nonempty() ? recentNodes : undefined, 30);

            // Update minZoom to prevent zooming out too far
            updateMinZoom(cyInstance);
          }
        }
      } catch {
        // Suppress noisy layout errors from race conditions
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [elements, layout, commits, cyInstance]);

  // Maintain selection without re-fitting layout when only selectedId changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedId) return;

    try {
      const el = cy.getElementById(selectedId);
      if (el.nonempty()) {
        // Don't trigger a fit here; preserve current viewport position
        cy.elements().unselect();
        el.select();
      }
    } catch (error) {
      console.warn("Selection error:", error);
    }
  }, [selectedId, elements]);

  if (isLoading || loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin text-2xl mb-2">⟳</div>
          Loading commits...
        </div>
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        No commits found for this branch
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <CytoscapeComponent
        key={`${repoPath}:${branch}`}
        elements={elements as any}
        cy={onCyInit}
        stylesheet={stylesheet as any}
        layout={layout as any}
        wheelSensitivity={2}
        style={{ width: "100%", height: "100%" }}
      />

      {/* Search Bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <SearchBar
          commits={commits}
          onCommitSelect={(commit) => {
            setSelectedId(commit.id);
            onCommitSelect(commit);
          }}
        />
      </div>

      {(isLoading || loading) && commits.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm text-sm text-muted-foreground">
          Updating commits...
        </div>
      )}

      {/* API Key Manager Toggle */}
      <ApiKeyManagerToggle
        onClick={() => setShowApiKeyManager(true)}
        isConfigured={!!isApiConfigured}
      />

      {/* API Key Manager */}
      <ApiKeyManager
        open={showApiKeyManager}
        onOpenChange={setShowApiKeyManager}
        onConfigurationChange={handleApiConfigurationChange}
        currentModel={apiConfiguration?.model}
        currentApiKey={apiConfiguration?.apiKey}
      />
    </div>
  );
}
