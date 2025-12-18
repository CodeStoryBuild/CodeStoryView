import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import { SearchBar } from "@/components/search-bar";
import { getVsCodeApi } from "@/lib/vscode";

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
}

export function GitVisualizer({
    repoPath,
    branch,
    onCommitSelect,
    isLoading = false,
}: GitVisualizerProps) {
    const [commits, setCommits] = useState<CommitNode[]>([]);
    const [loading, setLoading] = useState(false);
    const cyRef = useRef<Core | null>(null);
    const [cyInstance, setCyInstance] = useState<Core | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
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
                    "background-color": "hsl(262, 83%, 64%)",
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
                    "border-color": "hsl(142, 76%, 36%)",
                    "border-style": "solid",
                    width: 18,
                    height: 18,
                },
            },
            {
                selector: "node[isNewNode]",
                style: {
                    "background-color": "hsl(24, 94%, 50%)",
                    "border-width": 2,
                    "border-color": "hsl(24, 94%, 60%)",
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

    const onCyInit = (cy: Core) => {
        cyRef.current = cy;
        setCyInstance(cy);
        cy.resize();
        cy.boxSelectionEnabled(false);
        cy.autoungrabify(true);
        cy.userZoomingEnabled(true);
        cy.userPanningEnabled(true);
        cy.minZoom(0.5);
        cy.maxZoom(5);

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
                        width: 18 * (1 + pulse * 0.3),
                        height: 18 * (1 + pulse * 0.3),
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
            if (commit) {
                onCommitSelect(commit);
                // Fetch diff for this commit
                vscode.postMessage({
                    command: 'fetchDiff',
                    repoPath,
                    commitHash: commit.hash
                });
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
            <div className="flex h-full w-full items-center justify-center bg-background text-muted-foreground">
                <div className="animate-spin mr-2">⟳</div> Loading commits...
            </div>
        );
    }

    if (commits.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground bg-background">
                No repository loaded.
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
                        if (selectedId !== commit.id) {
                            setSelectedId(commit.id);
                        }
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
        </div>
    );
}
