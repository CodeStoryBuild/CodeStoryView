# Codestory View

A Visual Studio Code extension that visualizes and helps manage Git repositories using the [Codestory CLI](https://cli.codestory.build). Codestory View provides a fast, interactive visual interface for cleaning up your repository history directly inside VS Code.

---

## Demo

Watch a short youtube demo of Codestory View — click the thumbnail to play the video.

[![Demo Video](https://img.youtube.com/vi/ofRYPWpe5Yk/hqdefault.jpg)](https://youtu.be/ofRYPWpe5Yk)


---

## Key features ✅

- Visualize repository history and branches with an interactive graph
- Inspect diffs and open file changes in a dedicated dialog
- Runs the Codestory CLI under the hood to clean repository history

---

## Why use Codestory View

Codestory View is focused on visual repository hygiene — not just seeing history but making it cleaner. It lets you perform the same core workflows as the Codestory CLI (commit, fix, clean) through a visual, interactive interface so you can inspect, split, and fix commits with confidence.

---

## How it maps to the Codestory CLI

The extension mirrors the main Codestory workflows so you can work visually:

- Committing new changes: run `cst commit` → webview helps stage and review grouped changes before committing.
- Fixing past commits: run `cst fix <commit>` → open a commit in the UI to split or reorder changes visually.

---

## Usage

- Open the **Command Palette** (Ctrl/Cmd+Shift+P) and run `Codestory View: Start` to open the visualizer.
- Use the branch selector and controls in the webview to navigate branches and commits.
- Click the diff entries to open the Diff dialog for file-by-file comparisons.

## Troubleshooting

If you run into any issues, please email support@codestory.build

---

## License

The code is licensed under GPLv2 — see `LICENSE` for details.

---


