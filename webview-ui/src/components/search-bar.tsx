"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";

interface CommitNode {
    id: string;
    label: string;
    hash: string;
    message: string;
    author: string;
    date: string;
}

interface SearchBarProps {
    commits: CommitNode[];
    onCommitSelect: (commit: CommitNode) => void;
    className?: string;
}

export function SearchBar({ commits, onCommitSelect, className }: SearchBarProps) {
    const [open, setOpen] = React.useState(false);

    return (
        <div className={cn("relative w-[320px]", className)}>
            <Command
                className="rounded-md border border-border/50 shadow-sm overflow-visible bg-background/80 backdrop-blur-sm [&_[data-slot=command-input-wrapper]]:border-b-0"
            >
                <CommandInput
                    placeholder="Search commits..."
                    className="h-8 text-xs"
                    onFocus={() => setOpen(true)}
                    onBlur={() => {
                        // Small delay to allow selection click to register
                        setTimeout(() => setOpen(false), 150);
                    }}
                />
                {open && (
                    <div className="absolute top-[calc(100%+4px)] left-0 w-full z-50">
                        <CommandList className="rounded-md border border-border bg-popover/95 backdrop-blur-md text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 max-h-[240px] overflow-y-auto">
                            <CommandEmpty className="py-2 text-center text-xs">No commit found.</CommandEmpty>
                            <CommandGroup heading="Commits" className="px-1">
                                {commits.map((commit) => (
                                    <CommandItem
                                        key={commit.id}
                                        value={`${commit.id} ${commit.message}`}
                                        onSelect={() => {
                                            onCommitSelect(commit);
                                            setOpen(false);
                                        }}
                                        className="px-2 py-1.5"
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-mono text-[10px] font-bold opacity-70">
                                                {commit.id.substring(0, 7)}
                                            </span>
                                            <span className="truncate text-xs">
                                                {commit.message}
                                            </span>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </div>
                )}
            </Command>
        </div>
    );
}
