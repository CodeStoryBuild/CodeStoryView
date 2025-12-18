const fs = require("fs");
const path = require("path");
const { app } = require("electron");

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.VCV_LOG_LEVEL || "info";
    this.component = options.component || "main";
    this.logDir = options.logDir || path.join(app.getPath("userData"), "logs");
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.telemetryQueue = [];
    this.telemetryEndpoint = process.env.VCV_TELEMETRY_ENDPOINT;
    this.telemetryOptOut = process.env.VCV_TELEMETRY_OPTOUT === "true";

    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };

    this.currentLevel = this.levels[this.level] || this.levels.info;

    // Ensure log directory exists
    this._ensureLogDir();

    // Set up log rotation
    this._setupRotation();
  }

  _ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error("Failed to create log directory:", error);
    }
  }

  _setupRotation() {
    try {
      const logFile = path.join(this.logDir, "app.log");
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > this.maxFileSize) {
          this._rotateFiles();
        }
      }
    } catch (error) {
      console.error("Failed to setup log rotation:", error);
    }
  }

  _rotateFiles() {
    try {
      const logFile = path.join(this.logDir, "app.log");

      // Remove oldest log file if we're at max files
      const oldestLog = path.join(this.logDir, `app.log.${this.maxFiles - 1}`);
      if (fs.existsSync(oldestLog)) {
        fs.unlinkSync(oldestLog);
      }

      // Rotate existing files
      for (let i = this.maxFiles - 2; i >= 0; i--) {
        const currentFile =
          i === 0 ? logFile : path.join(this.logDir, `app.log.${i}`);
        const nextFile = path.join(this.logDir, `app.log.${i + 1}`);

        if (fs.existsSync(currentFile)) {
          fs.renameSync(currentFile, nextFile);
        }
      }
    } catch (error) {
      console.error("Failed to rotate log files:", error);
    }
  }

  _writeLog(level, message, meta = {}) {
    if (this.levels[level] > this.currentLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      component: this.component,
      message,
      ...meta,
    };

    const logLine = JSON.stringify(logEntry) + "\n";

    try {
      const logFile = path.join(this.logDir, "app.log");
      fs.appendFileSync(logFile, logLine);

      // Also log to console in development
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[${timestamp}] ${level.toUpperCase()} [${this.component}] ${message}`,
          meta,
        );
      }

      // Queue for telemetry if enabled
      if (
        level === "error" &&
        !this.telemetryOptOut &&
        this.telemetryEndpoint
      ) {
        this.telemetryQueue.push({
          ...logEntry,
          sessionId: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
        });

        // Flush telemetry queue periodically
        if (this.telemetryQueue.length >= 10) {
          this._flushTelemetry();
        }
      }

      // Check if we need to rotate after writing
      const stats = fs.statSync(logFile);
      if (stats.size > this.maxFileSize) {
        this._rotateFiles();
      }
    } catch (error) {
      console.error("Failed to write log:", error);
    }
  }

  _flushTelemetry() {
    if (
      this.telemetryOptOut ||
      !this.telemetryEndpoint ||
      this.telemetryQueue.length === 0
    ) {
      return;
    }

    // In a real implementation, you would send this to your telemetry endpoint
    // For now, we'll just clear the queue
    const batch = [...this.telemetryQueue];
    this.telemetryQueue = [];

    // TODO: Implement actual telemetry sending
    console.debug(
      `Would send ${batch.length} telemetry events to ${this.telemetryEndpoint}`,
    );
  }

  error(message, meta = {}) {
    this._writeLog("error", message, meta);
  }

  warn(message, meta = {}) {
    this._writeLog("warn", message, meta);
  }

  info(message, meta = {}) {
    this._writeLog("info", message, meta);
  }

  debug(message, meta = {}) {
    this._writeLog("debug", message, meta);
  }

  // Flush any remaining telemetry on shutdown
  flush() {
    this._flushTelemetry();
  }
}

// Factory function for creating loggers
function createLogger(options = {}) {
  return new Logger(options);
}

module.exports = { Logger, createLogger };
