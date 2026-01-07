import React from "react";
import { cn } from "@/lib/utils";

interface DiffLineProps {
  oldNumber?: number | string;
  newNumber?: number | string;
  content: string; // Already highlighted HTML
  type: "insert" | "delete" | "context";
  view: "line-by-line" | "side-by-side";
}

export function DiffLine({
  oldNumber,
  newNumber,
  content,
  type,
  view,
}: DiffLineProps) {
  const isUnified = view === "line-by-line";

  const typeClass =
    type === "insert"
      ? "bg-emerald-500/10 text-emerald-300/90"
      : type === "delete"
        ? "bg-rose-500/10 text-rose-300/90"
        : "hover:bg-muted/10";

  if (isUnified) {
    return (
      <div
        className={cn(
          "flex font-mono text-[11px] leading-relaxed group border-b last:border-b-0 border-border/5",
          typeClass,
        )}
      >
        <div className="w-10 shrink-0 text-right px-2 py-0.5 text-muted-foreground/30 border-r border-border/20 select-none bg-muted/20 group-hover:bg-muted/30 transition-colors">
          {oldNumber || ""}
        </div>
        <div className="w-10 shrink-0 text-right px-2 py-0.5 text-muted-foreground/30 border-r border-border/20 select-none bg-muted/20 group-hover:bg-muted/30 transition-colors">
          {newNumber || ""}
        </div>
        <div
          className="px-4 py-0.5 whitespace-pre break-all overflow-x-auto flex-1 font-syntax transition-opacity"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    );
  }

  // Side-by-side handled by the parent DiffBlock for alignment,
  // but we can provide a half-line component here if needed.
  return null;
}
