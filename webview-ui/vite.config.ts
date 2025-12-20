import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Use relative paths so the webview can find scripts without a web server
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Recommendation: Put this inside your extension's main output folder
    outDir: "../dist/webview",
    emptyOutDir: true,
    // VS Code is based on modern Electron; ESNext or Chrome 120+ is safe
    target: "esnext",
    rollupOptions: {
      output: {
        // Keeps filenames predictable so your extension.ts can find them
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`,
      },
    },
  },
});
