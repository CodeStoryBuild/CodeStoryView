const { ipcMain, app } = require("electron");
const { createLogger } = require("../logger");
const { execFile, spawn } = require("child_process");
const { VibeExecuteSchema } = require("./validation");
const { getApiKey: getStoredApiKey } = require("./secure-store");
const { promisify } = require("util");
const { existsSync } = require("fs");
const { join } = require("path");
const os = require("os");

const execFileAsync = promisify(execFile);

// Helper function to get the correct path to vibe.exe
function getVibeExecutablePath() {
  // In production, binaries should be outside the ASAR, under resources
  if (app.isPackaged) {
    return join(process.resourcesPath, "vibecommit", "win64", "dslate-windows-standalone.exe");
  }
  // In development, resolve relative to the project root
  const appPath = app.getAppPath();
  return join(appPath, "vibecommit", "win64", "dslate-windows-standalone.exe");
}

// Helper function to get command-specific timeout values
function getCommandTimeout(command) {
  switch (command) {
    case "expand":
      // Expand operations can be very large, especially for commits with many files
      return 10 * 60 * 1000; // 10 minutes
    case "commit":
    case "improve":
      // Commit operations can also be large when analyzing working directory changes
      return 5 * 60 * 1000; // 5 minutes
    case "generate":
    case "info":
    case "help":
    default:
      // Default timeout for other commands
      return 2 * 60 * 1000; // 2 minutes
  }
}

// Register Vibe IPC handlers
function registerVibeHandlers() {
  const logger = createLogger({ component: "vibe-ipc" });
  // Execute command handler
  ipcMain.handle("vibe-execute-command", async (event, options) => {
    try {
      if (!options) throw new Error("No options provided");
      const parsed = VibeExecuteSchema.safeParse(options);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      const { root_args, command, args, timeout, workingDirectory } =
        parsed.data;

      // Set command-specific timeouts if not provided
      const defaultTimeout = timeout || getCommandTimeout(command);

      if (!Array.isArray(args)) {
        throw new Error("Args must be an array");
      }

      if (workingDirectory && typeof workingDirectory !== "string") {
        throw new Error("Working directory must be a string");
      }

      // Validate working directory exists if provided
      if (workingDirectory && !existsSync(workingDirectory)) {
        throw new Error("Working directory does not exist");
      }

      // Check system compatibility
      const platform = os.platform();
      const arch = os.arch();

      if (platform !== "win32" || !(arch === "x64" || arch === "x86_64")) {
        throw new Error(
          `Platform ${platform} ${arch} is not supported. Only Windows 64-bit is supported.`,
        );
      }

      // Check if executable exists
      const executablePath = getVibeExecutablePath();

      if (!existsSync(executablePath)) {
        throw new Error("dslate-windows-standalone.exe not found in vibecommit/win64/ directory");
      }

      try {
        // Prepare environment variables
        const { stdout, stderr } = await execFileAsync(
          executablePath,
          [...root_args, command, ...args],
          {
            timeout: defaultTimeout,
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            cwd: workingDirectory || process.cwd(),
          },
        );
        logger.info("vibe-execute-command success", {
          command,
          args,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          workingDirectory,
          timeout: defaultTimeout,
        });
        return {
          success: true,
          stdout,
          stderr,
          command,
          args,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        // Handle execution errors
        const stderr = error.stderr || "";
        const stdout = error.stdout || "";
        const errorMessage = error.message || "";

        // Check if this is an API key related error
        const isApiKeyError =
          stderr.includes("API key") ||
          stdout.includes("API key") ||
          errorMessage.includes("API key");

        const result = {
          success: false,
          error: errorMessage,
          stdout,
          stderr,
          code: error.code,
          signal: error.signal,
          command,
          args,
          timestamp: new Date().toISOString(),
        };

        // Add needsApiKey flag if it's an API key error
        if (isApiKeyError) {
          result.needsApiKey = true;
        }

        logger.warn("vibe-execute-command failure", {
          command,
          args,
          error: errorMessage,
          code: error.code,
          signal: error.signal,
          isApiKeyError,
        });
        return result;
      }
    } catch (error) {
      logger.error("vibe-execute-command handler error", {
        error: error.message,
        stack: error.stack,
      });

      // Only log command details if they're available (in case error was thrown during early validation)
      try {
        logger.debug("vibe-execute-command details", {
          command: options?.command || "undefined",
          args: options?.args || "undefined",
          workingDirectory: options?.workingDirectory || "undefined",
          executablePath: getVibeExecutablePath(),
        });
      } catch (logError) {
        logger.debug("vibe-execute-command detail logging failed", {
          error: logError.message,
        });
      }

      // Preserve the needsApiKey property if it exists
      if (error.needsApiKey) {
        const newError = new Error(
          error.message || "Failed to execute command",
        );
        newError.needsApiKey = true;
        throw newError;
      }

      throw new Error(error.message || "Failed to execute command");
    }
  });

  // Get vibe info handler
  ipcMain.handle("vibe-get-info", async (event) => {
    try {
      // Check system compatibility
      const platform = os.platform();
      const arch = os.arch();

      if (platform !== "win32" || !(arch === "x64" || arch === "x86_64")) {
        return {
          compatible: false,
          platform,
          arch,
          message: `Platform ${platform} ${arch} is not supported. Only Windows 64-bit is supported.`,
        };
      }

      // Check if executable exists
      const executablePath = getVibeExecutablePath();

      const exists = existsSync(executablePath);

      const info = {
        compatible: exists,
        platform,
        arch,
        executablePath,
        exists,
        message: exists
          ? "Vibe executable found and compatible"
          : "Vibe executable not found in vibecommit/win64/ directory",
      };
      logger.info("vibe-get-info", info);
      return info;
    } catch (error) {
      logger.error("vibe-get-info handler error", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(error.message || "Failed to get vibe info");
    }
  });

  // Get compatibility handler
  ipcMain.handle("vibe-get-compatibility", async (event) => {
    try {
      const platform = os.platform();
      const arch = os.arch();

      const isWindows = platform === "win32";
      const is64Bit = arch === "x64" || arch === "x86_64";
      const compatible = isWindows && is64Bit;

      const executablePath = getVibeExecutablePath();

      const exists = existsSync(executablePath);

      const compatibility = {
        compatible: compatible && exists,
        platform,
        arch,
        isWindows,
        is64Bit,
        executableExists: exists,
        executablePath,
        requirements: {
          platform: "win32",
          arch: ["x64", "x86_64"],
          executable: "vibecommit/win64/dslate-windows-standalone.exe",
        },
      };
      logger.info("vibe-get-compatibility", compatibility);
      return compatibility;
    } catch (error) {
      logger.error("vibe-get-compatibility handler error", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(error.message || "Failed to check compatibility");
    }
  });

  // Run command handler (alias to execute-command)
  ipcMain.handle("vibe-run-command", async (event, options) => {
    if (!options) throw new Error("No options provided");
    const parsed = VibeExecuteSchema.safeParse(options);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const { root_args, command, args, timeout, workingDirectory } = parsed.data;

    // Set command-specific timeouts if not provided
    const defaultTimeout = timeout || getCommandTimeout(command);

    if (!Array.isArray(args)) {
      throw new Error("Args must be an array");
    }

    if (workingDirectory && typeof workingDirectory !== "string") {
      throw new Error("Working directory must be a string");
    }

    // Validate working directory exists if provided
    if (workingDirectory && !existsSync(workingDirectory)) {
      throw new Error("Working directory does not exist");
    }

    // Check system compatibility
    const platform = os.platform();
    const arch = os.arch();

    if (platform !== "win32" || !(arch === "x64" || arch === "x86_64")) {
      throw new Error(
        `Platform ${platform} ${arch} is not supported. Only Windows 64-bit is supported.`,
      );
    }

    // Check if executable exists
    const executablePath = getVibeExecutablePath();

    if (!existsSync(executablePath)) {
      throw new Error("dslate-windows-standalone.exe not found in vibecommit/win64/ directory");
    }

    try {
      // Prepare environment variables
      const { stdout, stderr } = await execFileAsync(
        executablePath,
        [...root_args, command, ...args],
        {
          timeout: defaultTimeout,
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
          cwd: workingDirectory || process.cwd(),
        },
      );

      logger.info("vibe-run-command success", {
        command,
        args,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        workingDirectory,
        timeout: defaultTimeout,
      });
      return {
        success: true,
        stdout,
        stderr,
        command,
        args,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Handle execution errors
      const stderr = error.stderr || "";
      const stdout = error.stdout || "";
      const errorMessage = error.message || "";

      // Check if this is an API key related error
      const isApiKeyError =
        stderr.includes("API key") ||
        stdout.includes("API key") ||
        errorMessage.includes("API key");

      const result = {
        success: false,
        error: errorMessage,
        stdout,
        stderr,
        code: error.code,
        signal: error.signal,
        command,
        args,
        timestamp: new Date().toISOString(),
      };

      // Add needsApiKey flag if it's an API key error
      if (isApiKeyError) {
        result.needsApiKey = true;
      }

      logger.warn("vibe-run-command failure", {
        command,
        args,
        error: errorMessage,
        code: error.code,
        signal: error.signal,
        isApiKeyError,
      });
      return result;
    }
  });

  // Streaming command handler
  ipcMain.handle("vibe-start-streaming-command", async (event, options) => {
    try {
      if (!options) throw new Error("No options provided");
      const parsed = VibeExecuteSchema.safeParse(options);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      const { root_args, command, args, workingDirectory } = parsed.data;

      if (!Array.isArray(args)) {
        throw new Error("Args must be an array");
      }

      if (workingDirectory && typeof workingDirectory !== "string") {
        throw new Error("Working directory must be a string");
      }

      // Validate working directory exists if provided
      if (workingDirectory && !existsSync(workingDirectory)) {
        throw new Error("Working directory does not exist");
      }

      // Check system compatibility
      const platform = os.platform();
      const arch = os.arch();

      if (platform !== "win32" || !(arch === "x64" || arch === "x86_64")) {
        throw new Error(
          `Platform ${platform} ${arch} is not supported. Only Windows 64-bit is supported.`,
        );
      }

      // Check if executable exists
      const executablePath = getVibeExecutablePath();

      if (!existsSync(executablePath)) {
        throw new Error("vibe.exe not found in vibecommit/win64/ directory");
      }

      // Start the streaming process
      const childProcess = spawn(
        executablePath,
        [...root_args, command, ...args],
        {
          cwd: workingDirectory || process.cwd(),
          shell: false, // Don't use shell for vibe.exe
        },
      );
      logger.info("vibe-start-streaming-command started", {
        command,
        args,
        pid: childProcess.pid,
        workingDirectory,
      });

      // Handle stdout streaming
      childProcess.stdout.on("data", (data) => {
        const output = data.toString();
        event.sender.send("vibe-command-output", {
          type: "stdout",
          data: output,
          timestamp: new Date().toISOString(),
        });
        logger.debug("vibe-stream stdout", {
          command,
          chunkLength: output.length,
        });
      });

      // Handle stderr streaming
      childProcess.stderr.on("data", (data) => {
        const output = data.toString();
        event.sender.send("vibe-command-output", {
          type: "stderr",
          data: output,
          timestamp: new Date().toISOString(),
        });
        logger.debug("vibe-stream stderr", {
          command,
          chunkLength: output.length,
        });
      });

      // Handle process completion
      childProcess.on("close", (code, signal) => {
        event.sender.send("vibe-command-output", {
          type: "exit",
          code,
          signal,
          timestamp: new Date().toISOString(),
        });
        logger.info("vibe-stream exit", { command, args, code, signal });
      });

      // Handle process errors
      childProcess.on("error", (error) => {
        // Check if this is an API key related error
        const isApiKeyError = error.message.includes("API key");

        event.sender.send("vibe-command-output", {
          type: "error",
          error: error.message,
          needsApiKey: isApiKeyError,
          timestamp: new Date().toISOString(),
        });
        logger.error("vibe-stream process error", {
          command,
          args,
          error: error.message,
          isApiKeyError,
        });
      });

      // Return the process ID for potential cancellation
      logger.info("vibe-start-streaming-command ready", {
        command,
        args,
        pid: childProcess.pid,
      });
      return {
        success: true,
        pid: childProcess.pid,
        command,
        args,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("vibe-start-streaming-command handler error", {
        error: error.message,
        stack: error.stack,
      });

      // Preserve the needsApiKey property if it exists
      if (error.needsApiKey) {
        const newError = new Error(
          error.message || "Failed to start streaming command",
        );
        newError.needsApiKey = true;
        throw newError;
      }

      throw new Error(error.message || "Failed to start streaming command");
    }
  });
}

module.exports = { registerVibeHandlers };
