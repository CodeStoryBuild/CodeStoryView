/**
 * Utility functions for interacting with the Vibe API
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { apiService } from "@/lib/ipc-api";

// API Key management
const API_KEY_STORAGE_KEY = "vibe_gemini_api_key";

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setStoredApiKey(apiKey: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  // Persist securely via IPC when available
  try {
    if (window.electronAPI?.secureStore?.setApiKey) {
      // Fire and forget; main will persist securely
      window.electronAPI.secureStore.setApiKey(apiKey).catch(() => {});
    }
  } catch {}
}

export function clearStoredApiKey(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  try {
    if (window.electronAPI?.secureStore?.clearApiKey) {
      window.electronAPI.secureStore.clearApiKey().catch(() => {});
    }
  } catch {}
}

export interface VibeCompatibilityResponse {
  compatible: boolean;
  platform: string;
  arch: string;
  release: string;
  executablePath: string | null;
  message: string;
}

export interface VibeExecuteResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  timestamp: string;
  error?: string;
  code?: number;
  signal?: string;
}

export interface VibeStreamEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data?: string;
  code?: number;
  signal?: string;
  error?: string;
  timestamp: string;
}

/**
 * Check if the system is compatible with vibe.exe
 */
export async function checkVibeCompatibility(): Promise<VibeCompatibilityResponse> {
  return await apiService.vibe.getCompatibility();
}

/**
 * Execute a vibe command and get the complete output
 */
export async function executeVibeCommand(
  root_args: string[],
  command: string,
  args: string[] = [],
  options?: { timeout?: number; workingDirectory?: string },
): Promise<VibeExecuteResponse> {
  try {
    const result = await apiService.vibe.executeCommand({
      root_args,
      command,
      args,
      timeout: options?.timeout,
      workingDirectory: options?.workingDirectory,
    });

    // Check if API key is needed (this handles cases where the command runs but fails due to API key)
    if (
      result.needsApiKey ||
      (result.error && result.error.includes("API key"))
    ) {
      const error = new Error(result.error || "API key required") as any;
      error.needsApiKey = true;
      throw error;
    }

    return result;
  } catch (error: any) {
    // If the IPC call itself throws an error with needsApiKey, preserve it
    if (error.needsApiKey) {
      throw error;
    }

    // Check if the error message indicates API key is needed
    if (error.message && error.message.includes("API key")) {
      const apiKeyError = new Error(error.message) as any;
      apiKeyError.needsApiKey = true;
      throw apiKeyError;
    }

    throw error;
  }
}

/**
 * Execute a vibe command with streaming output
 */
export async function* streamVibeCommand(
  root_args: string[],
  command: string,
  args: string[] = [],
  options?: { workingDirectory?: string; apiKey?: string },
): AsyncGenerator<VibeStreamEvent, void, unknown> {
  // Check if we're in Electron environment for real streaming
  if (typeof window !== "undefined" && window.electronAPI) {
    // Use real streaming with IPC
    const events: VibeStreamEvent[] = [];
    let isComplete = false;
    let error: Error | null = null;
    let resolveSetup: ((value: void | PromiseLike<void>) => void) | undefined;
    const setupPromise = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });

    // Set up the output listener
    const cleanup = apiService.vibe.onCommandOutput((data: any) => {
      const event: VibeStreamEvent = {
        type: data.type,
        data: data.data,
        code: data.code,
        signal: data.signal,
        error: data.error,
        timestamp: data.timestamp,
      };

      events.push(event);

      // Check if this is the end of the stream
      if (data.type === "exit" || data.type === "error") {
        isComplete = true;
        cleanup();

        // Check for API key errors
        if (
          data.needsApiKey ||
          (data.error && data.error.includes("API key"))
        ) {
          const apiKeyError = new Error(
            data.error || "API key required",
          ) as any;
          apiKeyError.needsApiKey = true;
          error = apiKeyError;
        }
      }
    });

    // Start the streaming command
    try {
      await apiService.vibe.startStreamingCommand({
        root_args,
        command,
        args,
        workingDirectory: options?.workingDirectory,
      });

      resolveSetup?.();
    } catch (startError: any) {
      cleanup();
      // If the start command itself throws an error with needsApiKey, preserve it
      if (startError.needsApiKey) {
        throw startError;
      } else if (startError.message && startError.message.includes("API key")) {
        const apiKeyError = new Error(startError.message) as any;
        apiKeyError.needsApiKey = true;
        throw apiKeyError;
      } else {
        throw startError;
      }
    }

    // Wait for setup to complete
    await setupPromise;

    // Yield events as they come in
    let eventIndex = 0;
    while (!isComplete || eventIndex < events.length) {
      if (eventIndex < events.length) {
        yield events[eventIndex];
        eventIndex++;
      } else {
        // Wait a bit before checking again
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Throw error if there was one
    if (error) {
      throw error;
    }

    return;
  }

  // Fallback to old behavior for non-Electron environments
  let result;

  try {
    result = await apiService.vibe.runCommand({
      root_args,
      command,
      args,
      workingDirectory: options?.workingDirectory,
    });
  } catch (error: any) {
    // If the IPC call itself throws an error with needsApiKey, preserve it
    if (error.needsApiKey) {
      throw error;
    }

    // Check if the error message indicates API key is needed
    if (error.message && error.message.includes("API key")) {
      const apiKeyError = new Error(error.message) as any;
      apiKeyError.needsApiKey = true;
      throw apiKeyError;
    }

    throw error;
  }

  // Check if API key is needed (this handles cases where the command runs but fails due to API key)
  if (
    result.needsApiKey ||
    (result.error && result.error.includes("API key"))
  ) {
    const error = new Error(result.error || "API key required") as any;
    error.needsApiKey = true;
    throw error;
  }

  // For non-Electron, simulate streaming by yielding the complete result
  if (result.success) {
    // Yield stdout as a single event
    if (result.stdout) {
      yield {
        type: "stdout",
        data: result.stdout,
        timestamp: result.timestamp || new Date().toISOString(),
      };
    }
    // Yield stderr as a single event if present
    if (result.stderr) {
      yield {
        type: "stderr",
        data: result.stderr,
        timestamp: result.timestamp || new Date().toISOString(),
      };
    }
  } else {
    // Yield error event
    yield {
      type: "error",
      data: result.error || "Command failed",
      timestamp: result.timestamp || new Date().toISOString(),
    };
  }
}

/**
 * Execute a vibe command silently (without opening console) and return success status
 */
export async function executeVibeCommandSilently(
  root_args: string[],
  command: string,
  args: string[] = [],
  options?: { timeout?: number; workingDirectory?: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await apiService.vibe.executeCommand({
      root_args,
      command,
      args,
      timeout: options?.timeout,
      workingDirectory: options?.workingDirectory,
    });

    // Check if API key is needed (this handles cases where the command runs but fails due to API key)
    if (
      result.needsApiKey ||
      (result.error && result.error.includes("API key"))
    ) {
      const error = new Error(result.error || "API key required") as any;
      error.needsApiKey = true;
      throw error;
    }

    return { success: result.success, error: result.error };
  } catch (error: any) {
    // If the IPC call itself throws an error with needsApiKey, preserve it
    if (error.needsApiKey) {
      throw error;
    }

    // Check if the error message indicates API key is needed
    if (error.message && error.message.includes("API key")) {
      const apiKeyError = new Error(error.message) as any;
      apiKeyError.needsApiKey = true;
      throw apiKeyError;
    }

    return { success: false, error: error.message || "Unknown error" };
  }
}

/**
 * Get information about the Vibe API
 */
export async function getVibeApiInfo() {
  return await apiService.vibe.getInfo();
}

/**
 * React hook for checking vibe compatibility
 */
export function useVibeCompatibility() {
  const [compatibility, setCompatibility] =
    useState<VibeCompatibilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkVibeCompatibility()
      .then(setCompatibility)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { compatibility, loading, error };
}

/**
 * React hook for executing vibe commands
 */
export function useVibeCommand() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (
      root_args: string[],
      command: string,
      args: string[] = [],
      options?: {
        timeout?: number;
        workingDirectory?: string;
      },
    ): Promise<VibeExecuteResponse> => {
      setLoading(true);
      setError(null);

      try {
        const result = await executeVibeCommand(
          root_args,
          command,
          args,
          options,
        );
        return result;
      } catch (err: any) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        // Re-throw with needsApiKey information if present
        if (err.needsApiKey) {
          err.needsApiKey = true;
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { execute, loading, error };
}
