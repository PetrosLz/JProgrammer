import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { initializeDatabase } from "./database";
import { registerDatabaseIpc } from "./ipc/databaseIpc";

const isWindows = process.platform === "win32";

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "JProgrammer",
    backgroundColor: "#f8fafc",
    autoHideMenuBar: isWindows,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
    return;
  }

  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("app:getVersion", () => app.getVersion());

app.whenReady().then(() => {
  try {
    initializeDatabase();
    registerDatabaseIpc();
    createMainWindow();
  } catch (error) {
    console.error("JProgrammer failed to start:", error);
    dialog.showErrorBox(
      "Database initialization failed",
      getStartupErrorMessage(error)
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function getStartupErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "The local SQLite database could not be initialized.";
}
