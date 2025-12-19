import * as React from "react";
import { FolderOpen } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getVsCodeApi } from "@/lib/vscode";

interface GitRepoSelectorProps {
    repoPath: string;
    setRepoPath: (path: string) => void;
    onLoad: (path: string) => void;
    isTucked?: boolean;
    error?: string | null;
}

export function GitRepoSelector({
    repoPath,
    setRepoPath,
    onLoad,
    isTucked = false,
    error = null,
}: GitRepoSelectorProps) {
    const vscode = getVsCodeApi();

    const handleBrowse = () => {
        vscode.postMessage({ command: "selectDirectory" });
    };

    const handleLoad = () => {
        if (repoPath.trim()) {
            onLoad(repoPath.trim());
        }
    };

    if (isTucked) {
        return (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 transition-all duration-500 hover:scale-105">
                <div className="flex items-center gap-2 bg-card/80 backdrop-blur-md border border-border p-2 rounded-full shadow-lg">
                    <Input
                        value={repoPath}
                        onChange={(e) => setRepoPath(e.target.value)}
                        placeholder="Repository path"
                        className="w-64 h-8 bg-transparent border-none shadow-none focus-visible:ring-0"
                    />
                    <Button onClick={handleLoad} size="sm" className="rounded-full h-8">
                        Load
                    </Button>
                    <Button onClick={handleBrowse} variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                        <FolderOpen className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <Card className="w-full max-w-md border border-border bg-card/50 backdrop-blur-md shadow-sm animate-in fade-in duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex flex-col gap-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-primary" />
                        Repository
                    </CardTitle>
                    <CardDescription className={`text-xs ${error ? "text-destructive font-medium" : ""}`}>
                        {error || "Select a local git repository to visualize"}
                    </CardDescription>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBrowse}
                    title="Browse for repository"
                    className="h-8 w-8 hover:bg-accent transition-colors"
                >
                    <FolderOpen className="h-4 w-4" />
                </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
                <Input
                    placeholder="/path/to/repo"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                    className={`bg-background/50 border-border focus-visible:ring-1 h-9 text-sm ${
                        error ? "border-destructive focus-visible:ring-destructive" : "focus-visible:ring-primary"
                    }`}
                />
                <Button onClick={handleLoad} className="w-full h-9 text-sm font-medium">
                    Load Repository
                </Button>
            </CardContent>
        </Card>
    );
}
