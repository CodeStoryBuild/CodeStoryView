"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FolderOpen } from "lucide-react";

export function GitRepoSelector({
  onRepoSelect,
  initialValue = "",
}: {
  onRepoSelect: (path: string) => void;
  initialValue?: string;
}) {
  const [repoPath, setRepoPath] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update local state when initialValue changes
  useEffect(() => {
    setRepoPath(initialValue);
  }, [initialValue]);

  // Scroll input to end when repoPath changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.scrollLeft = inputRef.current.scrollWidth;
    }
  }, [repoPath]);

  const handleSelect = () => {
    if (repoPath.trim()) {
      onRepoSelect(repoPath.trim());
    }
  };

  const handleBrowse = async () => {
    try {
      // @ts-ignore - electronAPI is exposed via preload
      const path = await window.electronAPI.openDirectory();
      if (path) {
        setRepoPath(path);
        onRepoSelect(path);
      }
    } catch (error) {
      console.error("Failed to open directory selector:", error);
    }
  };

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Repository
          </CardTitle>
          <CardDescription>Select a local git repository</CardDescription>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={handleBrowse}
          title="Browse for repository"
          className="hover:bg-primary hover:text-primary-foreground hover:border-primary hover:shadow-[0_0_15px_var(--primary)] transition-all duration-300"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          ref={inputRef}
          placeholder="/path/to/repo"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSelect()}
          className="bg-input text-foreground"
        />
        <Button onClick={handleSelect} className="w-full">
          Load Repository
        </Button>
      </CardContent>
    </Card>
  );
}
