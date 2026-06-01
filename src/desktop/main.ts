import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, shell, Tray, ipcMain } from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  extractFirebaseAppCheckState,
  loadBrowserSession,
  loadFreshFirebaseAuth,
  summarizeSessionAuth
} from "../auth/firebaseSession.js";
import { ensureSessionDir, storageStatePath } from "../auth/tokenStore.js";
import { loadConfig } from "../config/loadConfig.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { listKinsFromSession } from "../kindroid/sessionKins.js";
import { createLogger } from "../util/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let monitorController: AbortController | null = null;
let loginSession: { browser: Browser; context: BrowserContext } | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;

const config = loadConfig();
const logger = createLogger(config.bridge.logLevel);

app.setName("Kinagent");

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerIpcHandlers();
  startSessionKeepAlive();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopMonitorProcess();
  void closeLoginSession();
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
});

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 840,
    minHeight: 560,
    title: "Kinagent",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html")).catch((error) => {
    logger.error("Failed to load desktop renderer.", { error: error.message });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("minimize" as never, (event: ElectronEvent) => {
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#243b53"/>
        <path d="M9 22V10h3v5.1L17 10h4l-5.4 5.5L22 22h-4.1l-4.4-4.7L12 18.8V22H9z" fill="#f7f9fb"/>
      </svg>`
    )}`
  );

  tray = new Tray(icon);
  tray.setToolTip("Kinagent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Kinagent", click: showMainWindow },
      { type: "separator" },
      { label: "Stop Monitor", click: stopMonitorProcess },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("double-click", showMainWindow);
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:get-status", async () => getDesktopStatus());
  ipcMain.handle("app:open-kindroid", async () => {
    await shell.openExternal("https://kindroid.ai/");
    return { ok: true };
  });
  ipcMain.handle("login:start", async () => startLoginSession());
  ipcMain.handle("login:save", async () => saveLoginSession());
  ipcMain.handle("login:cancel", async () => closeLoginSession());
  ipcMain.handle("monitor:start", async (_event, input: { kinId: string; pollSeconds?: number; pageSize?: number }) =>
    startMonitorProcess(input)
  );
  ipcMain.handle("monitor:stop", async () => stopMonitorProcess());
}

async function getDesktopStatus() {
  const session = loadSessionSummary();
  const appCheck = session.available ? extractFirebaseAppCheckState(loadBrowserSession(config.bridge.sessionDir).storageState) : null;

  return {
    monitorRunning: Boolean(monitorController),
    loginOpen: Boolean(loginSession),
    config: {
      firebaseProjectId: config.kindroid.firebaseProjectId,
      sessionDir: config.bridge.sessionDir,
      configuredKins: config.kindroid.kins
    },
    session,
    appCheckPresent: Boolean(appCheck?.token),
    kins: safeListKins()
  };
}

function loadSessionSummary() {
  try {
    const session = loadBrowserSession(config.bridge.sessionDir);
    return {
      available: true,
      ...summarizeSessionAuth(session.storageState)
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function safeListKins() {
  try {
    return listKinsFromSession(config.bridge.sessionDir);
  } catch {
    return [];
  }
}

async function startLoginSession() {
  if (loginSession) {
    return { ok: true, alreadyOpen: true };
  }

  ensureSessionDir(config.bridge.sessionDir);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://kindroid.ai/", { waitUntil: "domcontentloaded" });

  loginSession = { browser, context };
  sendRendererEvent("login-state", { open: true });
  return { ok: true };
}

async function saveLoginSession() {
  if (!loginSession) {
    throw new Error("No Kindroid login browser is open.");
  }

  const statePath = storageStatePath(config.bridge.sessionDir);
  await loginSession.context.storageState({ path: statePath, indexedDB: true });
  await closeLoginSession();
  sendRendererEvent("session-updated", await getDesktopStatus());
  return { ok: true, path: statePath };
}

async function closeLoginSession() {
  if (!loginSession) {
    return { ok: true };
  }

  await loginSession.browser.close();
  loginSession = null;
  sendRendererEvent("login-state", { open: false });
  return { ok: true };
}

function startMonitorProcess(input: { kinId: string; pollSeconds?: number; pageSize?: number }) {
  if (!input.kinId) {
    throw new Error("Select a Kin before starting the monitor.");
  }

  stopMonitorProcess();

  const controller = new AbortController();
  const monitor = new KindroidLiveMonitor(config, logger);
  monitorController = controller;

  void monitor
    .start({
      kinId: input.kinId,
      pollSeconds: input.pollSeconds ?? 5,
      pageSize: input.pageSize ?? 50,
      signal: controller.signal,
      onMessage: (message) => {
        sendRendererEvent("monitor-line", message);
      }
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        sendRendererEvent("monitor-error", error instanceof Error ? error.message : String(error));
      }
    })
    .finally(() => {
      if (monitorController === controller) {
        monitorController = null;
      }
      sendRendererEvent("monitor-exit", { aborted: controller.signal.aborted });
    });

  sendRendererEvent("monitor-started", { kinId: input.kinId });
  return { ok: true };
}

function stopMonitorProcess() {
  if (!monitorController) {
    return { ok: true, alreadyStopped: true };
  }

  monitorController.abort();
  monitorController = null;
  sendRendererEvent("monitor-stopped", {});
  return { ok: true };
}

function startSessionKeepAlive(): void {
  keepAliveTimer = setInterval(() => {
    loadFreshFirebaseAuth(config.bridge.sessionDir)
      .then((auth) => {
        sendRendererEvent("session-keepalive", {
          ok: true,
          uidPresent: Boolean(auth.uid),
          expirationIso: auth.expirationTime ? new Date(auth.expirationTime).toISOString() : null
        });
      })
      .catch((error) => {
        sendRendererEvent("session-keepalive", {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }, 30 * 60 * 1000);
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
  }

  mainWindow?.show();
  mainWindow?.focus();
}

function sendRendererEvent(channel: string, payload: unknown): void {
  mainWindow?.webContents.send("app:event", { channel, payload });
}
