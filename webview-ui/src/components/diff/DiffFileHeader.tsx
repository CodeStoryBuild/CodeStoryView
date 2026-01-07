import React from "react";

interface DiffFileHeaderProps {
  filePath: string;
  isNew: boolean;
  isDeleted: boolean;
  fileTypeLabel: "added" | "deleted" | "modified";
}

export function DiffFileHeader({
  filePath,
  isNew,
  isDeleted,
  fileTypeLabel,
}: DiffFileHeaderProps) {
  return (
    <div className="bg-muted/50 px-3 py-1.5 border-b border-border flex items-center justify-between">
      <span className="font-mono text-[11px] truncate opacity-80">
        {filePath}
      </span>
      <span
        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
          isNew
            ? "bg-emerald-500/20 text-emerald-400"
            : isDeleted
              ? "bg-rose-500/20 text-rose-400"
              : "bg-blue-500/10 text-blue-400"
        }`}
      >
        {fileTypeLabel}
      </span>
    </div>
  );
}
