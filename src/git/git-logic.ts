import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Commit {
  id: string;
  label: string;
  hash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  isWorkingDir: boolean;
  kind?: string;
  status?: string;
}

export interface GitDiff {
  diff: string;
}

export interface GitBranches {
  branches: string[];
}

// Helper function to execute a git command safely using argument arrays
export function runGit(
  repoPath: string,
  args: string[],
  { allowErrors = false, maxBuffer = 1024 * 1024 * 10 } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = cp.execFile(
      "git",
      args,
      {
        cwd: repoPath,
        env: { ...process.env, GIT_PAGER: "" },
        maxBuffer,
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

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      return false;
    }
    await runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function fetchCommits(
  repoPath: string,
  branch: string = "HEAD",
): Promise<Commit[]> {
  try {
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
      const msg = (error && (error as any).message) || "";
      if (
        msg.includes("unknown revision") ||
        msg.includes("ambiguous argument")
      ) {
        return [];
      }
      throw error;
    }

    if (!logOutput.trim()) {
      return [];
    }

    const commits: Commit[] = logOutput
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
          isWorkingDir: false,
        };
      });

    // Detect uncommitted working directory changes and append a pseudo-commit at the end
    try {
      const status = await runGit(repoPath, ["status", "--porcelain"], {
        allowErrors: true,
      });
      const trimmedStatus = status.trim();
      const hasChanges = trimmedStatus.length > 0;
      if (hasChanges && commits.length > 0) {
        const head = commits[0]; // git log lists HEAD first
        commits.unshift({
          id: "WORKING_DIR",
          label: "WORK",
          hash: "WORKING_DIR",
          message: "Working directory (uncommitted changes)",
          author: "workspace",
          date: new Date(0).toISOString(), // Use a stable date
          parents: [head.hash],
          // extra metadata for the client to style differently
          kind: "working",
          isWorkingDir: true,
          // Add status to ensure change detection works when working dir changes
          status: trimmedStatus,
        });
      }
    } catch {
      // If status fails (e.g., not a git repo), ignore silently
    }

    return commits;
  } catch (error) {
    throw new Error((error as any).message || "Failed to fetch commits");
  }
}

export async function fetchBranches(repoPath: string): Promise<string[]> {
  try {
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
      return [];
    }

    const allBranches = branchOutput
      .split("\n")
      .map((b) => b.trim())
      .filter(
        (b) =>
          b &&
          !b.startsWith("origin/") &&
          !b.startsWith("remotes/") &&
          !b.includes("HEAD detached"),
      )
      .filter((b, idx, arr) => arr.indexOf(b) === idx); // deduplicate

    if (allBranches.length === 0) {
      return [];
    }

    // Sort branches to prioritize main-like branches
    const priorityBranches = ["main", "master", "develop", "dev"];
    const sortedBranches = allBranches.sort((a, b) => {
      const aPriority = priorityBranches.indexOf(a.toLowerCase());
      const bPriority = priorityBranches.indexOf(b.toLowerCase());

      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority;
      }
      if (aPriority !== -1) {
        return -1;
      }
      if (bPriority !== -1) {
        return 1;
      }
      return a.localeCompare(b);
    });

    return sortedBranches;
  } catch (error) {
    throw new Error((error as any).message || "Failed to fetch branches");
  }
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  try {
    const branch = await runGit(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const trimmed = branch.trim();
    if (trimmed === "HEAD") {
      return "(not on a branch)";
    }
    return trimmed;
  } catch {
    return "(not on a branch)";
  }
}

export async function fetchDiff(
  repoPath: string,
  commitHash: string,
): Promise<string> {
  try {
    let diffText = "";
    if (commitHash === "WORKING_DIR") {
      // Base diff: tracked changes vs HEAD (staged + unstaged)
      diffText = await runGit(
        repoPath,
        ["diff", "HEAD", "--no-color", "--no-ext-diff"],
        { allowErrors: true },
      );

      // Append diffs for untracked files
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
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codestory-"));
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
              if (diffText && !diffText.endsWith("\n")) {
                diffText += "\n";
              }
              diffText += perFile;
            }
          }
        } finally {
          try {
            fs.unlinkSync(emptyPath);
          } catch {}
          try {
            fs.rmdirSync(tmpDir);
          } catch {}
        }
      }
    } else {
      diffText = await runGit(
        repoPath,
        ["show", commitHash, "--no-color", "--no-ext-diff"],
        { allowErrors: true },
      );
    }

    return diffText;
  } catch (error) {
    throw new Error((error as any).message || "Failed to get diff");
  }
}
