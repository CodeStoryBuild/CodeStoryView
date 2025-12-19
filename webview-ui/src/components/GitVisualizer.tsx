import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import { SearchBar } from "@/components/search-bar";
import { getVsCodeApi } from "@/lib/vscode";
import { DiffDialog } from "./DiffDialog";

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

interface GitVisualizerProps {
    repoPath: string;
    branch: string;
    onCommitSelect: (commit: any) => void;
    isLoading?: boolean;
    apiConfiguration?: { provider: string; model: string; globalConfig: Record<string, any> } | null;
    onOpenApiManager?: () => void;
}

export function GitVisualizer({
    repoPath,
    branch,
    onCommitSelect,
    isLoading = false,
    apiConfiguration = null,
    onOpenApiManager,
}: GitVisualizerProps) {
    const [commits, setCommits] = useState<CommitNode[]>([]);
    const [loading, setLoading] = useState(false);
    const cyRef = useRef<Core | null>(null);
    const [cyInstance, setCyInstance] = useState<Core | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null);
    const [isDiffOpen, setIsDiffOpen] = useState(false);
    const [executingCommits] = useState<Set<string>>(new Set());
    const [newNodeIds] = useState<Set<string>>(new Set());
    const vscode = getVsCodeApi();

    const fetchCommits = useCallback(() => {
        if (!repoPath) return;
        setLoading(true);
        vscode.postMessage({ command: 'loadRepo', directory: repoPath, branch });
    }, [repoPath, branch, vscode]);

    useEffect(() => {
        if (repoPath && branch) fetchCommits();
    }, [repoPath, branch, fetchCommits]);

    // Handle messages from the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'displayCommits':
                    setCommits(message.commits || []);
                    setLoading(false);
                    break;
                case 'loadError':
                    setLoading(false);
                    break;
                case 'displayOutput':
                    // console.log(message.data);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

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

    const stylesheet = useMemo(
        () => [
            {
                selector: "node",
                style: {
                    "background-color": "hsl(215, 20%, 65%)",
                    label: "data(label)",
                    color: "hsl(215, 20%, 65%)",
                    "font-family": "inherit",
                    "font-size": 8,
                    "text-valign": "bottom",
                    "text-halign": "center",
                    "text-margin-y": 4,
                    width: 10,
                    height: 10,
                    "border-width": 0,
                    "overlay-opacity": 0,
                    "text-wrap": "wrap",
                    "text-max-width": 60,
                },
            },
            {
                selector: "node:selected",
                style: {
                    "border-width": 2,
                    "border-color": "hsl(var(--primary))",
                    "background-color": "hsl(var(--primary))",
                    width: 12,
                    height: 12,
                },
            },
            {
                selector: 'node[kind = "working"]',
                style: {
                    "background-color": "hsl(24, 94%, 60%)",
                },
            },
            {
                selector: "node[isExecuting]",
                style: {
                    "border-width": 2,
                    "border-color": "hsl(142, 76%, 45%)",
                    "border-style": "solid",
                    width: 12,
                    height: 12,
                },
            },
            {
                selector: "edge",
                style: {
                    width: 1,
                    "line-color": "hsl(215, 20%, 80%)",
                    "target-arrow-color": "hsl(215, 20%, 80%)",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "arrow-scale": 0.6,
                },
            },
            {
                selector: "edge:selected",
                style: {
                    width: 1.5,
                    "line-color": "hsl(var(--primary))",
                    "target-arrow-color": "hsl(var(--primary))",
                },
            },
        ],
        [],
    );

    const onCyInit = (cy: Core) => {
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
        cy.on('viewport', () => {
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
        const startTime = Date.now();
        let isRunning = true;

        const animatePulsing = () => {
            if (!isRunning || cy.destroyed()) return;
            const elapsed = Date.now() - startTime;

            try {
                cy.nodes("[isExecuting]").forEach((node: any) => {
                    const pulse = Math.sin(elapsed / 400) * 0.5 + 0.5;
                    node.style({
                        "border-opacity": 0.3 + pulse * 0.7,
                        width: 12 * (1 + pulse * 0.2),
                        height: 12 * (1 + pulse * 0.2),
                    });
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
    };

    useEffect(() => {
        if (!cyInstance) return;
        const handleNodeTap = (evt: any) => {
            const commit = commits.find((c) => c.id === evt.target.id());
            console.log('GitVisualizer: node tapped', commit?.hash);
            if (commit) {
                setSelectedCommit(commit);
                setIsDiffOpen(true);
                onCommitSelect(commit);
            }
        };
        cyInstance.on("tap", "node", handleNodeTap);
        return () => {
            if (cyInstance && !cyInstance.destroyed()) cyInstance.off("tap", "node", handleNodeTap);
        };
    }, [commits, onCommitSelect, cyInstance, repoPath, vscode]);

    useEffect(() => {
        return () => {
            const cy = cyRef.current;
            if (cy && (cy as any).__animationCleanup) (cy as any).__animationCleanup();
            cyRef.current = null;
        };
    }, []);

    // Layout runner
    useEffect(() => {
        if (!cyInstance || !elements.length) return;
        const frame = requestAnimationFrame(() => {
            if (!cyInstance || cyInstance.destroyed()) return;
            try {
                const l = cyInstance.layout(layout as any);
                if (l && typeof l.run === "function") {
                    l.run();
                    const recentNodes = cyInstance.nodes("[index < 10]");
                    cyInstance.fit(recentNodes.nonempty() ? recentNodes : undefined, 30);
                }
            } catch { }
        });
        return () => cancelAnimationFrame(frame);
    }, [elements, layout, commits, cyInstance]);

    if (isLoading || loading) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background text-muted-foreground text-xs">
                <div className="animate-spin mr-2 h-3 w-3 border-b-2 border-primary rounded-full"></div> Loading...
            </div>
        );
    }

    if (commits.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground bg-background text-xs font-medium tracking-wide opacity-50">
                NO REPOSITORY LOADED
            </div>
        );
    }

    return (
        <div className="relative h-full w-full bg-background overflow-hidden">
            <CytoscapeComponent
                key={`${repoPath}:${branch}:${commits.length}`}
                elements={elements as any}
                cy={onCyInit}
                stylesheet={stylesheet as any}
                layout={layout as any}
                wheelSensitivity={0.5}
                style={{ width: "100%", height: "100%" }}
            />
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
                <SearchBar
                    commits={commits}
                    onCommitSelect={(commit) => {
                        setSelectedId(commit.id);
                        setSelectedCommit(commit);
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
                    }}
                />
            </div>

            <DiffDialog
                open={isDiffOpen}
                onOpenChange={setIsDiffOpen}
                repoPath={repoPath}
                branch={branch}
                commit={selectedCommit}
                apiConfiguration={apiConfiguration}
                onOpenApiManager={onOpenApiManager}
            />
        </div>
    );
}
