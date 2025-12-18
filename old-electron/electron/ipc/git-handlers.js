const { execFile, spawn } = require("child_process");
const { RepoPathSchema, BranchSchema, DiffSchema } = require("./validation");
const { ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Helper to execute a git command safely using argument arrays
function runGit(
  repoPath,
  args,
  { allowErrors = false, maxBuffer = 1024 * 1024 * 10 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: repoPath,
        env: { ...process.env, GIT_PAGER: "" },
        maxBuffer,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        if (error) {
          if (allowErrors) {
            // Return whatever stdout produced for partial results
            return resolve(stdout || "");
          }
          return reject(stderr ? new Error(stderr.trim()) : error);
        }
        resolve(stdout);
      },
    );
    // Safety timeout (5 min) to avoid hanging on huge repos
    setTimeout(
      () => {
        if (!child.killed) {
          child.kill("SIGTERM");
          reject(new Error("git command timeout"));
        }
      },
      5 * 60 * 1000,
    );
  });
}

// Register Git IPC handlers
function registerGitHandlers() {
  // Get branches handler
  ipcMain.handle("git-get-branches", async (event, payload) => {
    try {
      const parsed = RepoPathSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      const { repoPath } = parsed.data;

      // Validate repo path exists and is a directory
      if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
        throw new Error("Invalid repository path");
      }

      let branchOutput = "";
      try {
        branchOutput = await runGit(
          repoPath,
          ["branch", "--format=%(refname:short)"],
          { allowErrors: true },
        );
      } catch {
        return { branches: [] };
      }

      const allBranches = branchOutput
        .split("\n")
        .map((b) => b.trim())
        .filter(
          (b) =>
            b &&
            !b.startsWith("origin/") &&
            !b.startsWith("remotes/") &&
            !b.startsWith("backup- "),
        )
        .filter((b, idx, arr) => arr.indexOf(b) === idx); // deduplicate

      if (allBranches.length === 0) {
        return { branches: [] };
      }

      // Sort branches to prioritize main-like branches
      const priorityBranches = ["main", "master", "develop", "dev"];
      const sortedBranches = allBranches.sort((a, b) => {
        const aPriority = priorityBranches.indexOf(a.toLowerCase());
        const bPriority = priorityBranches.indexOf(b.toLowerCase());

        // If both are priority branches, sort by priority order
        if (aPriority !== -1 && bPriority !== -1) {
          return aPriority - bPriority;
        }
        // If only one is priority, put it first
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;
        // Otherwise, alphabetical
        return a.localeCompare(b);
      });

      return { branches: sortedBranches };
    } catch (error) {
      throw new Error(error.message || "Failed to fetch branches");
    }
  });

  // Get commits handler
  ipcMain.handle("git-get-commits", async (event, payload) => {
    try {
      const parsed = BranchSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      const { repoPath, branch } = parsed.data;

      // Include parent hashes (%P) to build a proper DAG client-side
      let logOutput = "";
      try {
        logOutput = await runGit(
          repoPath,
          [
            "log",
            branch,
            "--pretty=format:%H|%h|%s|%an|%ai|%P",
            "--max-count=100", // max 100 commits
          ],
          { allowErrors: false },
        );
      } catch (error) {
        const msg = (error && error.message) || "";
        if (
          msg.includes("unknown revision") ||
          msg.includes("ambiguous argument")
        ) {
          return {
            commits: [],
            error: `Branch '${branch}' not found in repository`,
          };
        }
        throw error;
      }

      if (!logOutput.trim()) {
        return { commits: [] };
      }

      const commits = logOutput
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [hash, shortHash, message, author, date, parentsStr] =
            line.split("|");
          const parents = (parentsStr || "")
            .split(" ")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);

          return {
            id: hash,
            label: shortHash,
            hash,
            message,
            author,
            date,
            parents,
          };
        });

      // Detect uncommitted working directory changes and append a pseudo-commit at the end
      try {
        const status = await runGit(repoPath, ["status", "--porcelain"], {
          allowErrors: true,
        });
        const hasChanges = status.trim().length > 0;
        if (hasChanges && commits.length > 0) {
          const head = commits[0]; // git log lists HEAD first
          commits.unshift({
            id: "WORKING_DIR",
            label: "WORK",
            hash: "WORKING_DIR",
            message: "Working directory (uncommitted changes)",
            author: "workspace",
            date: new Date().toISOString(),
            parents: [head.hash],
            // extra metadata for the client to style differently
            kind: "working",
            isWorkingDir: true,
          });
        }
      } catch {
        // If status fails (e.g., not a git repo), ignore silently
      }

      return { commits };
    } catch (error) {
      throw new Error(error.message || "Failed to fetch commits");
    }
  });

  // Get diff handler
  ipcMain.handle("git-get-diff", async (event, payload) => {
    try {
      const parsed = DiffSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      const { repoPath, commitHash } = parsed.data;

      // If the special working directory node is requested, return the working tree diff vs HEAD
      let diffText = "";
      if (commitHash === "WORKING_DIR") {
        // Base diff: tracked changes vs HEAD (staged + unstaged)
        diffText = await runGit(
          repoPath,
          ["diff", "HEAD", "--no-color", "--no-ext-diff"],
          { allowErrors: true },
        );

        // Append diffs for untracked files using no-index against an empty temp file
        const listArgs = ["ls-files", "--others", "--exclude-standard", "-z"];
        let untrackedRaw = "";
        try {
          untrackedRaw = await runGit(repoPath, listArgs, {
            allowErrors: true,
          });
        } catch {
          untrackedRaw = "";
        }
        const files = untrackedRaw
          .split("\u0000")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (files.length > 0) {
          // Create a temporary empty file
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vcv-"));
          const emptyPath = path.join(tmpDir, "empty");
          fs.writeFileSync(emptyPath, "");
          try {
            for (const f of files) {
              const perFile = await runGit(
                repoPath,
                [
                  "diff",
                  "--no-index",
                  "--no-color",
                  "--no-ext-diff",
                  "--",
                  emptyPath,
                  f,
                ],
                { allowErrors: true },
              );
              if (perFile && perFile.trim().length > 0) {
                if (diffText && !diffText.endsWith("\n")) diffText += "\n";
                diffText += perFile;
              }
            }
          } finally {
            // Cleanup temp file and dir
            try {
              fs.unlinkSync(emptyPath);
            } catch { }
            try {
              fs.rmdirSync(tmpDir);
            } catch { }
          }
        }
      } else {
        // Use git show to get the patch for a single commit. Disable color and pager for clean parsing.
        diffText = await runGit(
          repoPath,
          ["show", commitHash, "--no-color", "--no-ext-diff"],
          { allowErrors: true },
        );
      }

      return { diff: diffText };
    } catch (error) {
      throw new Error(error.message || "Failed to get diff");
    }
  });
}

module.exports = { registerGitHandlers };
