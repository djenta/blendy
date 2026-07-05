const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { registerBackendIpc } = require("./backend.cjs");

const isDev = !app.isPackaged;
let mainWindow;

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function appIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "build/icon.ico"),
    path.join(__dirname, "../build/icon.ico"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function statePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return {
      width: 520,
      height: 820,
      pinned: true,
    };
  }
}

function normalizeWindowState(saved) {
  const width = Math.max(380, Math.min(saved.width || 520, 900));
  const height = Math.max(520, Math.min(saved.height || 820, 1000));
  const displays = screen.getAllDisplays();
  const visibleOnDisplay = displays.some((display) => {
    const area = display.workArea;
    const x = Number.isFinite(saved.x) ? saved.x : area.x + Math.round((area.width - width) / 2);
    const y = Number.isFinite(saved.y) ? saved.y : area.y + Math.round((area.height - height) / 2);
    return (
      x >= area.x + 24 &&
      y >= area.y + 24 &&
      x + width <= area.x + area.width - 24 &&
      y + height <= area.y + area.height - 24
    );
  });
  if (visibleOnDisplay && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return {
      ...saved,
      width,
      height,
    };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    ...saved,
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
  };
}

function writeWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }
  const state = {
    ...window.getBounds(),
    pinned: window.isAlwaysOnTop(),
  };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function createWindow() {
  const saved = normalizeWindowState(readWindowState());
  mainWindow = new BrowserWindow({
    width: saved.width || 520,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    minWidth: 380,
    minHeight: 520,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    show: true,
    alwaysOnTop: saved.pinned !== false,
    title: "Blendy",
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(saved.pinned !== false, "screen-saver");

  function showMainWindow() {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", showMainWindow);

  mainWindow.on("close", () => writeWindowState(mainWindow));
  mainWindow.on("resize", () => writeWindowState(mainWindow));
  mainWindow.on("move", () => writeWindowState(mainWindow));

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5187");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerBackendIpc({ app, ipcMain });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("window:get-pinned", () => {
  return mainWindow?.isAlwaysOnTop() ?? true;
});

ipcMain.handle("window:set-pinned", (_event, pinned) => {
  if (!mainWindow) {
    return false;
  }
  mainWindow.setAlwaysOnTop(Boolean(pinned), "screen-saver");
  writeWindowState(mainWindow);
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});
