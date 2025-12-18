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
        <div className={cn("relative w-[400px]", className)}>
            <Command
                className="rounded-lg border shadow-md overflow-visible bg-background [&_[data-slot=command-input-wrapper]]:border-b-0"
            >
                <CommandInput
                    placeholder="Search commit hash or message..."
                    onFocus={() => setOpen(true)}
                    onBlur={() => {
                        // Small delay to allow selection click to register
                        setTimeout(() => setOpen(false), 150);
                    }}
                />
                {open && (
                    <div className="absolute top-[calc(100%+4px)] left-0 w-full z-50">
                        <CommandList className="rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 max-h-[300px] overflow-y-auto">
                            <CommandEmpty>No commit found.</CommandEmpty>
                            <CommandGroup heading="Commits">
                                {commits.map((commit) => (
                                    <CommandItem
                                        key={commit.id}
                                        value={`${commit.id} ${commit.message}`}
                                        onSelect={() => {
                                            onCommitSelect(commit);
                                            setOpen(false);
                                        }}
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-mono text-xs font-bold">
                                                {commit.id.substring(0, 7)}
                                            </span>
                                            <span className="truncate text-xs text-muted-foreground">
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
