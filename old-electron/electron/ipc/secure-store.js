const keytar = require("keytar");
const { app } = require("electron");

const ACCOUNT = "GOOGLE_API_KEY";

function getServiceName() {
  try {
    return app.getName() || "VibeCommitVisualizer";
  } catch {
    return "VibeCommitVisualizer";
  }
}

async function getApiKey() {
  const service = getServiceName();
  try {
    const key = await keytar.getPassword(service, ACCOUNT);
    return key || null;
  } catch {
    return null;
  }
}

async function setApiKey(value) {
  const service = getServiceName();
  try {
    await keytar.setPassword(service, ACCOUNT, value);
    return true;
  } catch (error) {
    console.error("Failed to set API key:", error);
    return false;
  }
}

async function clearApiKey() {
  const service = getServiceName();
  try {
    await keytar.deletePassword(service, ACCOUNT);
    return true;
  } catch {
    return false;
  }
}

function registerSecureStoreHandlers(ipcMain) {
  ipcMain.handle("secure-get-api-key", async () => {
    const key = await getApiKey();
    return { key };
  });
  ipcMain.handle("secure-set-api-key", async (_event, { key }) => {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key");
    }
    await setApiKey(key);
    return { ok: true };
  });
  ipcMain.handle("secure-clear-api-key", async () => {
    const ok = await clearApiKey();
    return { ok };
  });
}

module.exports = {
  getApiKey,
  setApiKey,
  clearApiKey,
  registerSecureStoreHandlers,
};
