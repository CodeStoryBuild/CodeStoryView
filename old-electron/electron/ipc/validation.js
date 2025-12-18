const { z } = require("zod");

// Security-focused validation patterns
const absolutePathRegex = /^(?:[A-Za-z]:\\[^<>:"|?*\n\r\t]+|\/[^\n\r\t]+)$/;
const branchRegex = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/;
const commitHashRegex = /^[0-9a-fA-F]{40}$/;
const dangerousChars = /[;&|`$(){}\[\]<>"'\n\r\t]/;
const allowedCommands = ["generate", "expand", "improve", "help", "commit"]; // list of codestory commands

// Validation helpers
function validatePath(path) {
  if (!path || typeof path !== "string") return false;
  if (path.includes("..") || path.includes("~")) return false;
  if (dangerousChars.test(path)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(path.split(/[\\/]/).pop()))
    return false;
  return absolutePathRegex.test(path);
}

function validateArg(arg) {
  if (typeof arg !== "string") return false;
  if (dangerousChars.test(arg)) return false;
  if (arg.includes("..")) return false;
  return true;
}

// Git schemas
const RepoPathSchema = z.object({
  repoPath: z
    .string()
    .refine(validatePath, "Invalid or dangerous repository path"),
});

const BranchSchema = z.object({
  repoPath: z.string().refine(validatePath, "Invalid repository path"),
  branch: z.string().regex(branchRegex, "Invalid branch name").max(200),
});

const DiffSchema = z.object({
  repoPath: z.string().refine(validatePath, "Invalid repository path"),
  commitHash: z
    .string()
    .refine(
      (v) => v === "WORKING_DIR" || commitHashRegex.test(v),
      "Invalid commit hash format",
    ),
});

// Vibe command schemas
const VibeExecuteSchema = z.object({
  root_args: z
    .array(z.string().refine(validateArg, "Invalid argument"))
    .default([]),
  command: z
    .string()
    .refine(
      (cmd) => allowedCommands.includes(cmd),
      "Command not in allowed list",
    ),
  args: z.array(z.string().refine(validateArg, "Invalid argument")).default([]),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(10 * 60 * 1000)
    .optional(),
  workingDirectory: z
    .string()
    .refine(validatePath, "Invalid working directory")
    .optional(),
});

module.exports = {
  RepoPathSchema,
  BranchSchema,
  DiffSchema,
  VibeExecuteSchema,
};
