"use client";

import { GitBranch, RotateCcw } from "lucide-react";
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface BranchSelectorProps {
    branches: string[];
    selectedBranch: string;
    onBranchSelect: (branch: string) => void;
    onReload?: () => void;
    isLoading?: boolean;
}

export function BranchSelector({
    branches,
    selectedBranch,
    onBranchSelect,
    onReload,
    isLoading,
}: BranchSelectorProps) {
    if (!branches || branches.length === 0) return null;

    return (
        <div className="flex items-center gap-1">
            <Select value={selectedBranch} onValueChange={onBranchSelect}>
                <SelectTrigger
                    size="sm"
                    className="bg-transparent border-transparent hover:border-border/40 hover:bg-transparent focus-visible:ring-0 focus-visible:border-border/60 shadow-none text-xs font-mono px-2 py-1 h-auto"
                >
                    <GitBranch className="size-3 opacity-70" />
                    <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent className="min-w-[8rem]">
                    {branches.map((branch) => (
                        <SelectItem
                            key={branch}
                            value={branch}
                            className="text-xs font-mono"
                        >
                            {branch}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {onReload && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReload}
                    disabled={isLoading}
                    className="bg-transparent border-transparent hover:border-border/40 hover:bg-transparent focus-visible:ring-0 focus-visible:border-border/60 shadow-none px-2 py-1 h-auto"
                    title="Reload branches"
                >
                    <RotateCcw
                        className={`size-3 opacity-70 ${isLoading ? "animate-spin" : ""}`}
                    />
                </Button>
            )}
        </div>
    );
}
