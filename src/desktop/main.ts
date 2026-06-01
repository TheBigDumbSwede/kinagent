import fs from "node:fs";
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
import { FirestoreRestClient, type FirestoreKinDocument } from "../firestore/firestoreRestClient.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { createLogger } from "../util/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = loadConfig();
const logger = createLogger(config.bridge.logLevel);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let loginSession: { browser: Browser; context: BrowserContext } | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;
let keepAliveInFlight = false;
let kinRefreshTimer: NodeJS.Timeout | null = null;
let kinRefreshInFlight = false;
let knownKins = new Map<string, FirestoreKinDocument>();
const disabledKinIds = loadKinSubscriptionPreferences().disabledKinIds;
const activeKinMonitors = new Map<string, { controller: AbortController; kin: FirestoreKinDocument }>();
let lastKinRefresh:
  | { ok: true; refreshedAtIso: string; count: number }
  | { ok: false; refreshedAtIso: string; error: string }
  | null = null;

const sessionKeepAliveMs = 25 * 60 * 1000;
const kinRefreshMs = 5 * 60 * 1000;
const defaultMonitorPageSize = 50;

app.setName("Kinagent");

void app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerIpcHandlers();
  startSessionKeepAlive();
  startKinSubscriptionSupervisor();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopAllKinMonitors();
  void closeLoginSession();
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
  if (kinRefreshTimer) {
    clearInterval(kinRefreshTimer);
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
      { label: "Refresh Kins", click: () => void refreshKinSubscriptions() },
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
  ipcMain.handle("monitor:stop", async () => stopAllKinMonitors());
  ipcMain.handle("kins:set-enabled", async (_event, input: { kinId: string; enabled: boolean }) =>
    setKinSubscriptionEnabled(input)
  );
  ipcMain.handle("kins:refresh", async () => {
    await refreshKinSubscriptions();
    return { ok: true };
  });
}

async function getDesktopStatus() {
  const session = loadSessionSummary();
  const appCheck = session.available
    ? extractFirebaseAppCheckState(loadBrowserSession(config.bridge.sessionDir).storageState)
    : null;

  return {
    monitorRunning: activeKinMonitors.size > 0,
    loginOpen: Boolean(loginSession),
    config: {
      firebaseProjectId: config.kindroid.firebaseProjectId,
      sessionDir: config.bridge.sessionDir,
      configuredKins: config.kindroid.kins
    },
    session,
    appCheckPresent: Boolean(appCheck?.token),
    kins: subscriptionStatuses().map((subscription) => subscription.kin),
    subscriptions: subscriptionStatuses(),
    kinRefresh: lastKinRefresh
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
  await refreshKinSubscriptions();
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

  disabledKinIds.delete(input.kinId);
  saveKinSubscriptionPreferences();
  const kin =
    knownKins.get(input.kinId) ??
    ({
      aiId: input.kinId,
      documentId: input.kinId,
      name: input.kinId,
      current: false
    } satisfies FirestoreKinDocument);
  knownKins.set(kin.aiId, kin);
  startKinMonitor(kin, input.pageSize ?? defaultMonitorPageSize);
  sendRendererEvent("kins-updated", subscriptionStatuses());
  return { ok: true };
}

function stopAllKinMonitors() {
  if (activeKinMonitors.size === 0) {
    return { ok: true, alreadyStopped: true };
  }

  for (const kinId of activeKinMonitors.keys()) {
    stopKinMonitor(kinId, "manual");
  }
  return { ok: true };
}

function startKinSubscriptionSupervisor(): void {
  void refreshKinSubscriptions();
  kinRefreshTimer = setInterval(() => {
    void refreshKinSubscriptions();
  }, kinRefreshMs);
}

async function refreshKinSubscriptions(): Promise<void> {
  if (kinRefreshInFlight) {
    return;
  }

  kinRefreshInFlight = true;
  try {
    const client = new FirestoreRestClient(config, logger);
    const kins = await client.listUserKins();
    const nextKnownKins = new Map(kins.map((kin) => [kin.aiId, kin]));
    const availableKinIds = new Set(nextKnownKins.keys());

    knownKins = nextKnownKins;
    for (const kinId of activeKinMonitors.keys()) {
      if (!availableKinIds.has(kinId) || disabledKinIds.has(kinId)) {
        stopKinMonitor(kinId, availableKinIds.has(kinId) ? "disabled" : "removed");
      }
    }

    for (const kin of kins) {
      if (!disabledKinIds.has(kin.aiId)) {
        startKinMonitor(kin, defaultMonitorPageSize);
      }
    }

    lastKinRefresh = { ok: true, refreshedAtIso: new Date().toISOString(), count: kins.length };
    sendRendererEvent("kins-updated", subscriptionStatuses());
    sendRendererEvent("session-updated", await getDesktopStatus());
  } catch (error) {
    lastKinRefresh = {
      ok: false,
      refreshedAtIso: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    sendRendererEvent("kins-refresh-error", lastKinRefresh.error);
    sendRendererEvent("session-updated", await getDesktopStatus());
  } finally {
    kinRefreshInFlight = false;
  }
}

function startKinMonitor(kin: FirestoreKinDocument, pageSize: number): void {
  if (activeKinMonitors.has(kin.aiId)) {
    return;
  }

  const controller = new AbortController();
  const monitor = new KindroidLiveMonitor(config, logger);
  activeKinMonitors.set(kin.aiId, { controller, kin });

  void monitor
    .start({
      kinId: kin.aiId,
      pageSize,
      signal: controller.signal,
      onMessage: (message) => {
        sendRendererEvent("monitor-line", { ...message, kinName: kin.name });
      }
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        sendRendererEvent("monitor-error", {
          kinId: kin.aiId,
          kinName: kin.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })
    .finally(() => {
      const activeMonitor = activeKinMonitors.get(kin.aiId);
      if (activeMonitor?.controller === controller) {
        activeKinMonitors.delete(kin.aiId);
      }
      sendRendererEvent("monitor-exit", { kinId: kin.aiId, aborted: controller.signal.aborted });
      sendRendererEvent("kins-updated", subscriptionStatuses());
    });

  sendRendererEvent("monitor-started", { kinId: kin.aiId, kinName: kin.name });
  sendRendererEvent("kins-updated", subscriptionStatuses());
}

function stopKinMonitor(kinId: string, reason: "disabled" | "manual" | "removed"): void {
  const activeMonitor = activeKinMonitors.get(kinId);
  if (!activeMonitor) {
    return;
  }

  activeMonitor.controller.abort();
  activeKinMonitors.delete(kinId);
  sendRendererEvent("monitor-stopped", { kinId, reason });
  sendRendererEvent("kins-updated", subscriptionStatuses());
}

async function setKinSubscriptionEnabled(input: { kinId: string; enabled: boolean }) {
  if (!input.kinId) {
    throw new Error("Missing Kin id.");
  }

  if (input.enabled) {
    disabledKinIds.delete(input.kinId);
    const kin = knownKins.get(input.kinId);
    if (kin) {
      startKinMonitor(kin, defaultMonitorPageSize);
    } else {
      await refreshKinSubscriptions();
    }
  } else {
    disabledKinIds.add(input.kinId);
    stopKinMonitor(input.kinId, "disabled");
  }

  saveKinSubscriptionPreferences();
  sendRendererEvent("kins-updated", subscriptionStatuses());
  return { ok: true };
}

function subscriptionStatuses() {
  return [...knownKins.values()]
    .sort((left, right) => left.name.localeCompare(right.name) || left.aiId.localeCompare(right.aiId))
    .map((kin) => ({
      kin,
      enabled: !disabledKinIds.has(kin.aiId),
      running: activeKinMonitors.has(kin.aiId)
    }));
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

function loadKinSubscriptionPreferences(): { disabledKinIds: Set<string> } {
  try {
    const parsed = JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(), "utf8")) as {
      disabledKinIds?: unknown;
    };
    const disabled = Array.isArray(parsed.disabledKinIds)
      ? parsed.disabledKinIds.filter((kinId): kinId is string => typeof kinId === "string" && kinId.length > 0)
      : [];
    return { disabledKinIds: new Set(disabled) };
  } catch {
    return { disabledKinIds: new Set() };
  }
}

function saveKinSubscriptionPreferences(): void {
  const preferencesPath = kinSubscriptionPreferencesPath();
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(preferencesPath, `${JSON.stringify({ disabledKinIds: [...disabledKinIds].sort() }, null, 2)}\n`);
}

function kinSubscriptionPreferencesPath(): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "kin-subscriptions.json");
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
