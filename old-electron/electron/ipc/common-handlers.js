const { ipcMain, shell, app, dialog } = require("electron");

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    // Allow only http/https protocols for external open
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function registerCommonHandlers() {
  ipcMain.handle("open-external", async (event, url) => {
    if (typeof url !== "string" || !isValidUrl(url)) {
      throw new Error("Invalid URL");
    }
    await shell.openExternal(url);
    return { opened: true };
  });

  ipcMain.handle("get-version", async () => {
    return { version: app.getVersion() };
  });

  ipcMain.handle("dialog-open-directory", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled) {
      return null;
    }
    return filePaths[0];
  });
}

module.exports = { registerCommonHandlers };
