"use client";

import * as React from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";

interface SystemThemeProviderProps
  extends Omit<ThemeProviderProps, "defaultTheme" | "enableSystem"> {
  children: React.ReactNode;
}

export function ThemeProvider({
  children,
  ...props
}: SystemThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
