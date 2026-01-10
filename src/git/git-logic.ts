import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export async function isGitLocked(repoPath: string): Promise<boolean> {
  try {
    const gitDir = path.join(repoPath, ".git");
    if (!fs.existsSync(gitDir)) {
      return false;
    }

    const lockFiles = [
      "index.lock",
      "HEAD.lock",
      "FETCH_HEAD.lock",
      "ORIG_HEAD.lock",
      "config.lock",
      "packed-refs.lock",
      "MERGE_HEAD.lock",
      "CHERRY_PICK_HEAD.lock",
      "BISECT_HEAD.lock",
      "REBASE_HEAD.lock",
    ];

    // Check main lock files
    for (const file of lockFiles) {
      if (fs.existsSync(path.join(gitDir, file))) {
        console.log(`[GitLogic] Git lock detected: ${file}`);
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

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

export async function hasGitChanges(repoPath: string): Promise<boolean> {
  try {
    const status = await runGit(repoPath, ["status", "--porcelain"]);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

export async function fetchCommits(
  repoPath: string,
  branch: string = "HEAD",
  limit: number = 100,
): Promise<{ commits: Commit[]; hasMore: boolean; status?: string }> {
  try {
    // Include parent hashes (%P) to build a proper DAG client-side
    let logOutput = "";
    try {
      logOutput = await runGit(
        repoPath,
        [
          "log",
          branch,
          "--pretty=format:%H\x1f%h\x1f%B\x1f%an\x1f%ai\x1f%P%n\x1e",
          `--max-count=${limit + 1}`,
        ],
        { allowErrors: false },
      );
    } catch (error) {
      const msg = (error && (error as any).message) || "";
      if (
        msg.includes("unknown revision") ||
        msg.includes("ambiguous argument") ||
        msg.includes("does not have any commits yet")
      ) {
        logOutput = ""; // Handle empty repo or invalid branch
      } else {
        throw error;
      }
    }

    const sections = logOutput
      ? logOutput.split("\x1e").filter((s) => s.trim())
      : [];
    const hasMore = sections.length > limit;
    const sectionsToProcess = hasMore ? sections.slice(0, limit) : sections;

    const commits: Commit[] = sectionsToProcess.map((section) => {
      const [hash, shortHash, message, author, date, parentsStr] =
        section.trim().split("\x1f");
      const parents = (parentsStr || "")
        .split(" ")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      return {
        id: hash,
        label: shortHash,
        hash,
        message: message || "",
        author,
        date,
        parents,
        isWorkingDir: false,
      };
    });

    // Detect uncommitted working directory changes and append a pseudo-commit at the beginning
    try {
      const status = await runGitWithTempIndex(repoPath, [
        "status",
        "--porcelain",
      ]);
      const trimmedStatus = status.trim();
      const hasChanges = trimmedStatus.length > 0;
      if (hasChanges) {
        const head = commits[0]; // git log lists HEAD first
        commits.unshift({
          id: "WORKING_DIR",
          label: "WORK",
          hash: "WORKING_DIR",
          message: "Working directory (uncommitted changes)",
          author: "workspace",
          date: new Date(0).toISOString(), // Use a stable date
          parents: head ? [head.hash] : [],
          // extra metadata for the client to style differently
          kind: "working",
          isWorkingDir: true,
          // Add status to ensure change detection works when working dir changes
          status: trimmedStatus,
        });
      }
      return { commits, hasMore, status: trimmedStatus };
    } catch {
      // If status fails (e.g., not a git repo), ignore silently
      return { commits, hasMore };
    }
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
      // Use a temporary index to include untracked files in the diff
      let hasCommits = true;
      try {
        await runGit(repoPath, ["rev-parse", "HEAD"]);
      } catch {
        hasCommits = false;
      }

      const diffArgs = [
        "diff",
        hasCommits ? "HEAD" : "4b825dc642cb6eb9a060e54bf8d69288fbee4904", // empty tree hash
        "--no-color",
        "--no-ext-diff",
      ];

      diffText = await runGitWithTempIndex(repoPath, diffArgs);
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

// Internal helper for running commands with custom env
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile(
      command,
      args,
      {
        cwd,
        env: env || process.env,
        maxBuffer: 1024 * 1024 * 10,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(stderr ? new Error(stderr.trim()) : error);
        }
        resolve(stdout);
      },
    );
  });
}

// Cache for git directories to avoid repeated rev-parse calls
const gitDirCache = new Map<string, string>();

/**
 * Runs a git command using a temporary index for robust untracked changes detection.
 * This is useful for status/diff commands where we want to include untracked files.
 */
async function runGitWithTempIndex(
  repoPath: string,
  args: string[],
): Promise<string> {
  const tempIndexFile = path.join(
    os.tmpdir(),
    `cst_index_${Math.random().toString(36).substring(7)}`,
  );

  try {
    // Find the real .git dir (cached)
    let gitDir = gitDirCache.get(repoPath);
    if (!gitDir) {
      const gitDirRelative = (
        await runGit(repoPath, ["rev-parse", "--git-dir"])
      ).trim();
      gitDir = path.isAbsolute(gitDirRelative)
        ? gitDirRelative
        : path.join(repoPath, gitDirRelative);
      gitDirCache.set(repoPath, gitDir);
    }
    const currentIndex = path.join(gitDir, "index");

    const env = { ...process.env, GIT_INDEX_FILE: tempIndexFile };

    // 1. Initialize temp index from HEAD (if it exists)
    try {
      await runCommand("git", ["read-tree", "HEAD"], repoPath, env);
    } catch {
      // If no HEAD (empty repo), leave index empty
    }

    // 2. Add all files as "intent-to-add" in the temporary index
    await runCommand("git", ["add", "-N", "."], repoPath, env);

    // 3. Run the actual command
    return await runCommand("git", args, repoPath, env);
  } finally {
    // Cleanup temp index
    if (fs.existsSync(tempIndexFile)) {
      fs.unlinkSync(tempIndexFile);
    }
  }
}
