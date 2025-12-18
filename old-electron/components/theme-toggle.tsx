"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export function SystemThemeIndicator() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Use a timeout to avoid synchronous setState in effect
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  const getIcon = () => {
    if (theme === "system") {
      return <Monitor className="h-4 w-4" />;
    }
    return resolvedTheme === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Sun className="h-4 w-4" />
    );
  };

  const getTooltipText = () => {
    if (theme === "system") {
      return `Following system (${resolvedTheme})`;
    }
    return `Theme: ${resolvedTheme}`;
  };

  return (
    <div
      className="flex items-center gap-2 rounded-full bg-background/50 backdrop-blur-sm border px-3 py-2 text-sm text-muted-foreground"
      title={getTooltipText()}
    >
      {getIcon()}
      <span className="hidden sm:inline">
        {theme === "system"
          ? "Auto"
          : resolvedTheme === "dark"
            ? "Dark"
            : "Light"}
      </span>
    </div>
  );
}
