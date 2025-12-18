const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  globalShortcut,
} = require("electron");
const path = require("path");
const { registerGitHandlers } = require("./ipc/git-handlers");
const { registerVibeHandlers } = require("./ipc/vibe-handlers");
const { registerCommonHandlers } = require("./ipc/common-handlers");
const { registerSecureStoreHandlers } = require("./ipc/secure-store");
const { createLogger } = require("./logger");
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
// Allow enabling DevTools in production via env var or CLI flag
const enableDevTools =
  isDev ||
  process.env.ELECTRON_ENABLE_DEVTOOLS === "1" ||
  process.argv.includes("--enable-devtools");

const logger = createLogger({ component: "main" });

let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: !isDev,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "../public/icon.ico"), // Add an icon if you have one
    show: false, // Don't show until ready-to-show
  });

  // Load the app
  const htmlPath = path.join(__dirname, "../out/index.html");
  // const startUrl = `file://${htmlPath}`;
  const startUrl = "http://localhost:3000";
  mainWindow.loadURL(startUrl);

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    logger.info("Main window shown");
  });

  // Open DevTools in development
  if (enableDevTools) {
    mainWindow.webContents.openDevTools();
    logger.info("DevTools opened for development");
  }

  // Keyboard toggles for DevTools even without a menu
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isToggle =
      (input.key?.toUpperCase() === "I" && input.control && input.shift) ||
      input.code === "F12";
    if (isToggle) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
    logger.info("Main window closed");
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
}

// Global error handlers for logging
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    reason: reason?.toString(),
    promise: promise?.toString(),
  });
});

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  logger.info("Electron app ready, initializing...");

  // Register IPC handlers
  registerCommonHandlers();
  registerSecureStoreHandlers(require("electron").ipcMain);
  registerGitHandlers();
  registerVibeHandlers();
  logger.info("IPC handlers registered");

  createWindow();

  // Global shortcuts to toggle DevTools in production builds
  try {
    globalShortcut.register("Control+Shift+I", () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) win.webContents.toggleDevTools();
    });
    globalShortcut.register("F12", () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) win.webContents.toggleDevTools();
    });
    logger.info("Global shortcuts for DevTools registered");
  } catch (e) {
    logger.error("Failed to register global shortcuts", { error: e?.message });
  }

  // On macOS, re-create window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Unregister global shortcuts on quit
app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
    logger.info("Global shortcuts unregistered");
  } catch { }
});

// Security: Prevent new window creation
app.on("web-contents-created", (event, contents) => {
  contents.on("new-window", (event, navigationUrl) => {
    event.preventDefault();
    require("electron").shell.openExternal(navigationUrl);
  });
});

// Handle app updates and other events
app.on("ready", () => {
  // Set application menu
  if (process.platform === "darwin") {
    // macOS menu
    const template = [
      {
        label: app.getName(),
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideothers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectall" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "close" }],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux menu
    Menu.setApplicationMenu(null);
  }
});
