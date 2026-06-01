import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, shell, Tray, ipcMain } from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  applySetCookieHeaders,
  buildCookieHeader,
  extractFirebaseAppCheckState,
  loadBrowserSession,
  loadFreshFirebaseAuth,
  saveBrowserStorageState,
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
let keepAliveInFlight = false;

const config = loadConfig();
const logger = createLogger(config.bridge.logLevel);
const sessionKeepAliveMs = 25 * 60 * 1000;

app.setName("Kinagent");

void app.whenReady().then(() => {
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
    icon: desktopIconPath("icon.png"),
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
    if (process.env.KINAGENT_DESKTOP_SMOKE === "1") {
      setTimeout(() => {
        isQuitting = true;
        app.quit();
      }, 1_000);
    }
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
  const icon = nativeImage.createFromPath(desktopIconPath("icon-32.png"));

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
  ipcMain.handle("monitor:start", async (_event, input: { kinId: string; pageSize?: number }) =>
    startMonitorProcess(input)
  );
  ipcMain.handle("monitor:stop", async () => stopMonitorProcess());
}

async function getDesktopStatus() {
  const session = loadSessionSummary();
  const appCheck = session.available
    ? extractFirebaseAppCheckState(loadBrowserSession(config.bridge.sessionDir).storageState)
    : null;

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

function startMonitorProcess(input: { kinId: string; pageSize?: number }) {
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
  void runSessionKeepAlive();
  keepAliveTimer = setInterval(() => {
    void runSessionKeepAlive();
  }, sessionKeepAliveMs);
}

async function runSessionKeepAlive(): Promise<void> {
  if (keepAliveInFlight) {
    return;
  }

  keepAliveInFlight = true;
  try {
    const auth = await loadFreshFirebaseAuth(config.bridge.sessionDir);
    const warmResult = await warmKindroidSession();
    sendRendererEvent("session-keepalive", {
      ok: true,
      warmed: warmResult.warmed,
      method: warmResult.method,
      uidPresent: Boolean(auth.uid),
      expirationIso: auth.expirationTime ? new Date(auth.expirationTime).toISOString() : null
    });
  } catch (error) {
    sendRendererEvent("session-keepalive", {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    keepAliveInFlight = false;
  }
}

async function warmKindroidSession(): Promise<{ warmed: boolean; method: "http" | "browser" | "skipped" }> {
  if (loginSession) {
    return { warmed: false, method: "skipped" };
  }

  try {
    const cookieUpdates = await warmKindroidHttpSession();
    logger.debug("Kindroid session warmed over HTTP.", { cookieUpdates });
    return { warmed: true, method: "http" };
  } catch (error) {
    logger.warn("HTTP Kindroid session warm failed; falling back to browser warm.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  await warmKindroidBrowserSession();
  return { warmed: true, method: "browser" };
}

async function warmKindroidHttpSession(): Promise<number> {
  const session = loadBrowserSession(config.bridge.sessionDir);
  const cookieHeader = buildCookieHeader(session.storageState, "kindroid.ai");
  if (!cookieHeader) {
    throw new Error("Saved session has no Kindroid cookies to warm.");
  }

  const url = "https://kindroid.ai/";
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: cookieHeader,
      "user-agent": "Kinagent session warmer"
    }
  });

  if (!response.ok) {
    throw new Error(`Kindroid HTTP warm failed with HTTP ${response.status}.`);
  }

  const setCookieHeaders = responseSetCookieHeaders(response.headers);
  const cookieUpdates = applySetCookieHeaders(session.storageState, setCookieHeaders, response.url || url);
  if (cookieUpdates > 0) {
    saveBrowserStorageState(config.bridge.sessionDir, session.storageState);
  }

  return cookieUpdates;
}

async function warmKindroidBrowserSession(): Promise<void> {
  const statePath = storageStatePath(config.bridge.sessionDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    await page.goto("https://kindroid.ai/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await context.storageState({ path: statePath, indexedDB: true });
    logger.debug("Kindroid browser session warmed.", { url: page.url() });
  } finally {
    await browser.close();
  }
}

function responseSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieHeaders = withGetSetCookie.getSetCookie?.();
  if (setCookieHeaders && setCookieHeaders.length > 0) {
    return setCookieHeaders;
  }

  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

function splitCombinedSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,\s]+=)/).map((header) => header.trim());
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

function desktopIconPath(fileName: string): string {
  return path.join(__dirname, "assets", fileName);
}
