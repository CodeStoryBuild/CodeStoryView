import React from "react";
import { DiffLine } from "./DiffLine";
import { DiffHighlighter } from "@/lib/diffHighlighter";

interface DiffBlockProps {
  header: string;
  lines: Array<{
    content: string;
    type: string; // "insert" | "delete" | "context"
    oldNumber?: number;
    newNumber?: number;
  }>;
  filePath: string;
  view: "line-by-line" | "side-by-side";
}

export function DiffBlock({ header, lines, filePath, view }: DiffBlockProps) {
  const isUnified = view === "line-by-line";

  if (isUnified) {
    return (
      <div className="bg-muted/5">
        <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono bg-muted/10 italic border-y border-border/20">
          {header}
        </div>
        {lines.map((line, idx) => (
          <DiffLine
            key={idx}
            oldNumber={line.oldNumber}
            newNumber={line.newNumber}
            content={DiffHighlighter.highlight(line.content, filePath)}
            type={line.type as any}
            view={view}
          />
        ))}
      </div>
    );
  }

  // Split View Implementation
  // We need to group lines into pairs (left/right)
  const leftLines: any[] = [];
  const rightLines: any[] = [];

  // This is a simplified approach for now
  lines.forEach((line) => {
    if (line.type === "delete") {
      leftLines.push(line);
      rightLines.push(null);
    } else if (line.type === "insert") {
      leftLines.push(null);
      rightLines.push(line);
    } else {
      leftLines.push(line);
      rightLines.push(line);
    }
  });

  return (
    <div className="bg-muted/5">
      <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono bg-muted/10 italic border-y border-border/20">
        {header}
      </div>
      <div className="grid grid-cols-2 divide-x divide-border/20">
        <div className="overflow-hidden">
          {leftLines.map((line, idx) => (
            <SideLine key={idx} line={line} filePath={filePath} side="left" />
          ))}
        </div>
        <div className="overflow-hidden">
          {rightLines.map((line, idx) => (
            <SideLine key={idx} line={line} filePath={filePath} side="right" />
          ))}
        </div>
      </div>
    </div>
  );
}

function SideLine({
  line,
  filePath,
  side,
}: {
  line: any;
  filePath: string;
  side: "left" | "right";
}) {
  if (!line)
    return <div className="h-[21px] bg-muted/5 border-b border-border/5" />;

  const typeClass =
    line.type === "insert"
      ? "bg-emerald-500/10 text-emerald-300/90"
      : line.type === "delete"
        ? "bg-rose-500/10 text-rose-300/90"
        : "hover:bg-muted/10";

  return (
    <div
      className={`flex font-mono text-[11px] leading-relaxed group border-b border-border/5 ${typeClass}`}
    >
      <div className="w-10 shrink-0 text-right px-2 py-0.5 text-muted-foreground/30 border-r border-border/20 select-none bg-muted/20 group-hover:bg-muted/30 transition-colors">
        {side === "left" ? line.oldNumber : line.newNumber}
      </div>
      <div
        className="px-4 py-0.5 whitespace-pre break-all overflow-x-auto flex-1 font-syntax transition-opacity"
        dangerouslySetInnerHTML={{
          __html: DiffHighlighter.highlight(line.content, filePath),
        }}
      />
    </div>
  );
}
