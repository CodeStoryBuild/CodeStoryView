"use client";

import { executeVibeCommand, setStoredApiKey } from "@/lib/vibe-api";

// Global state for tracking running commands and callbacks
let runningCommands = new Set<string>();
let executingCallbacks = new Set<() => void>();
let refreshCallbacks = new Set<(isVibeRefresh: boolean) => void>();

export interface VibeCommandOptions {
  onApiKeyRequired?: (onApiKeyProvided: (apiKey: string) => void) => void;
  onExecutionStart?: (commitHash: string) => void;
  onExecutionEnd?: (commitHash: string) => void;
  onBranchRefreshNeeded?: () => void;
  model?: string;
  apiKey?: string;
}

/**
 * Execute a vibe command with proper flow:
 * 1. Show API key dialog if needed
 * 2. Start node animation
 * 3. Execute command
 * 4. Stop animation
 * 5. Trigger branch reload
 */
export async function executeVibeCommandWithFlow(
  command: string,
  args: string[],
  workingDirectory: string,
  commitHash: string,
  options: VibeCommandOptions = {},
): Promise<void> {
  const {
    onApiKeyRequired,
    onExecutionStart,
    onExecutionEnd,
    onBranchRefreshNeeded,
    model,
    apiKey,
  } = options;

  // Check if we have required configuration
  if (!model || !apiKey) {
    throw new Error(
      "Model and API key must be configured before running vibe commands",
    );
  }

  // Function to execute with API key
  const executeWithApiKey = async (execApiKey?: string) => {
    // Start animation
    runningCommands.add(commitHash);
    onExecutionStart?.(commitHash);
    notifyExecutingCallbacks();

    try {
      let result;

      // Model is already in "provider:modelname" format
      // Construct the vibe command arguments with model and API key
      const rootArgs = ["--model", model, "--api-key", execApiKey || apiKey];
      const vibeArgs = args;

      // Use streaming execution for long-running commands like expand
      if (command === "expand" || command === "commit") {
        // Import streaming function
        const { streamVibeCommand } = await import("@/lib/vibe-api");

        let lastOutput = "";
        let lastError = "";
        let hasError = false;

        try {
          // Stream the command execution - pass empty subcommand since we've constructed full args
          for await (const event of streamVibeCommand(
            rootArgs,
            command,
            vibeArgs,
            {
              workingDirectory,
            },
          )) {
            if (event.type === "stdout") {
              lastOutput += event.data || "";
            } else if (event.type === "stderr") {
              lastError += event.data || "";
            } else if (event.type === "error") {
              hasError = true;
              throw new Error(event.data || "Command failed");
            }

            // Log progress for debugging
            // if (event.type === "stdout" && event.data) {
            //   console.log(
            //     `Vibe ${command} progress:`,
            //     event.data.substring(0, 100) + "...",
            //   );
            // }
          }

          // Create a result object compatible with executeVibeCommand
          result = {
            success: !hasError,
            stdout: lastOutput,
            stderr: lastError,
            command: "",
            args: vibeArgs,
            timestamp: new Date().toISOString(),
          };
        } catch (streamError: any) {
          // If streaming fails, fall back to regular execution with longer timeout
          console.warn(
            `Streaming execution failed for ${command}, falling back to regular execution:`,
            streamError,
          );
          result = await executeVibeCommand(rootArgs, command, vibeArgs, {
            workingDirectory,
            timeout: 10 * 60 * 1000, // 10 minutes timeout for fallback
          });
        }
      } else {
        // Use regular execution for faster commands
        result = await executeVibeCommand(rootArgs, command, vibeArgs, {
          workingDirectory,
        });
      }

      console.log(`Vibe command ${command} completed:`, result);

      // Trigger branch refresh after successful execution
      onBranchRefreshNeeded?.();
      notifyRefreshCallbacks(true);
    } catch (error: any) {
      console.error(`Vibe command ${command} failed:`, error);
      throw error;
    } finally {
      // Stop animation
      runningCommands.delete(commitHash);
      onExecutionEnd?.(commitHash);
      notifyExecutingCallbacks();
      // Reset the vibe refresh flag
    }
  };

  try {
    // Execute with the provided API key from options
    await executeWithApiKey(apiKey);
  } catch (error: any) {
    // If API key is required and we have the callback, show dialog
    if (error.needsApiKey && onApiKeyRequired) {
      return new Promise((resolve, reject) => {
        onApiKeyRequired((newApiKey: string) => {
          setStoredApiKey(newApiKey);
          executeWithApiKey(newApiKey).then(resolve).catch(reject);
        });
      });
    }
    throw error;
  }
}

/**
 * Check if a commit is currently executing a command
 */
export function isCommitExecuting(commitHash: string): boolean {
  return runningCommands.has(commitHash);
}

/**
 * Get all currently executing commit hashes
 */
export function getExecutingCommits(): Set<string> {
  return new Set(runningCommands);
}

/**
 * Subscribe to execution state changes
 */
export function subscribeToExecutionState(callback: () => void): () => void {
  executingCallbacks.add(callback);
  return () => {
    executingCallbacks.delete(callback);
  };
}

/**
 * Subscribe to refresh needs
 */
export function subscribeToRefreshNeeds(
  callback: (isVibeRefresh: boolean) => void,
): () => void {
  refreshCallbacks.add(callback);
  return () => {
    refreshCallbacks.delete(callback);
  };
}

function notifyExecutingCallbacks() {
  executingCallbacks.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      console.error("Error in execution state callback:", error);
    }
  });
}

function notifyRefreshCallbacks(isVibeRefresh: boolean) {
  refreshCallbacks.forEach((callback) => {
    try {
      callback(isVibeRefresh);
    } catch (error) {
      console.error("Error in refresh callback:", error);
    }
  });
}
