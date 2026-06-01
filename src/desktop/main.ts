import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, shell, Tray, ipcMain } from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { extractFirebaseAppCheckState, loadBrowserSession, summarizeSessionAuth } from "../auth/firebaseSession.js";
import { ensureSessionDir, storageStatePath } from "../auth/tokenStore.js";
import { loadConfig } from "../config/loadConfig.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { mapKindroidMessage } from "../firestore/messageMapper.js";
import { KindroidApiClient, type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { GroupSubscriptionSupervisor } from "../runtime/groupSubscriptionSupervisor.js";
import { KindroidSessionKeepAlive } from "../runtime/kindroidSessionKeepAlive.js";
import { KinSubscriptionSupervisor } from "../runtime/kinSubscriptionSupervisor.js";
import { createLogger } from "../util/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = loadConfig();
const logger = createLogger(config.bridge.logLevel);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let loginSession: { browser: Browser; context: BrowserContext } | null = null;

const sessionKeepAlive = new KindroidSessionKeepAlive({
  config,
  logger,
  shouldSkipWarm: () => Boolean(loginSession),
  onKeepAlive: (event) => {
    sendRendererEvent("session-keepalive", event);
  }
});
const kinSubscriptionSupervisor = new KinSubscriptionSupervisor({
  config,
  logger,
  startKin: async (kin, options) => startKinMonitor(kin, options),
  onKinsUpdated: (statuses) => {
    sendRendererEvent("kins-updated", statuses);
  },
  onRefreshError: (error) => {
    sendRendererEvent("kins-refresh-error", error);
  },
  onMonitorStarted: (kin) => {
    sendRendererEvent("monitor-started", { kinId: kin.aiId, kinName: kin.name });
  },
  onMonitorStopped: (kinId, reason) => {
    sendRendererEvent("monitor-stopped", { kinId, reason });
  },
  onMonitorExited: (kinId, aborted) => {
    sendRendererEvent("monitor-exit", { kinId, aborted });
  },
  onMonitorError: (kin, error) => {
    sendRendererEvent("monitor-error", { kinId: kin.aiId, kinName: kin.name, error });
  }
});
const groupSubscriptionSupervisor = new GroupSubscriptionSupervisor({
  config,
  logger,
  startGroup: async (group, options) => startGroupMonitor(group, options),
  onGroupsUpdated: (statuses) => {
    sendRendererEvent("groups-updated", statuses);
  },
  onRefreshError: (error) => {
    sendRendererEvent("groups-refresh-error", error);
  },
  onMonitorStarted: (group) => {
    sendRendererEvent("group-monitor-started", { groupId: group.groupId, groupName: group.name });
  },
  onMonitorStopped: (groupId, reason) => {
    sendRendererEvent("group-monitor-stopped", { groupId, reason });
  },
  onMonitorExited: (groupId, aborted) => {
    sendRendererEvent("group-monitor-exit", { groupId, aborted });
  },
  onMonitorError: (group, error) => {
    sendRendererEvent("group-monitor-error", { groupId: group.groupId, groupName: group.name, error });
  }
});

app.setName("Kinagent");

void app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerIpcHandlers();
  sessionKeepAlive.start();
  kinSubscriptionSupervisor.start();
  groupSubscriptionSupervisor.start();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  kinSubscriptionSupervisor.stop();
  groupSubscriptionSupervisor.stop();
  sessionKeepAlive.stop();
  void closeLoginSession();
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
      { label: "Refresh Kins", click: () => void kinSubscriptionSupervisor.refresh() },
      { label: "Refresh Groups", click: () => void groupSubscriptionSupervisor.refresh() },
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
  ipcMain.handle("monitor:stop", async () => kinSubscriptionSupervisor.stopAll("manual"));
  ipcMain.handle("kins:set-enabled", async (_event, input: { kinId: string; enabled: boolean }) =>
    setKinSubscriptionEnabled(input)
  );
  ipcMain.handle("kins:refresh", async () => {
    await kinSubscriptionSupervisor.refresh();
    return { ok: true };
  });
  ipcMain.handle("groups:set-enabled", async (_event, input: { groupId: string; enabled: boolean }) =>
    setGroupSubscriptionEnabled(input)
  );
  ipcMain.handle("groups:refresh", async () => {
    await groupSubscriptionSupervisor.refresh();
    return { ok: true };
  });
}

async function getDesktopStatus() {
  const session = loadSessionSummary();
  const appCheck = session.available
    ? extractFirebaseAppCheckState(loadBrowserSession(config.bridge.sessionDir).storageState)
    : null;

  return {
    monitorRunning: kinSubscriptionSupervisor.runningCount() + groupSubscriptionSupervisor.runningCount() > 0,
    loginOpen: Boolean(loginSession),
    config: {
      firebaseProjectId: config.kindroid.firebaseProjectId,
      sessionDir: config.bridge.sessionDir,
      configuredKins: config.kindroid.kins
    },
    session,
    appCheckPresent: Boolean(appCheck?.token),
    kins: kinSubscriptionSupervisor.statuses().map((subscription) => subscription.kin),
    subscriptions: kinSubscriptionSupervisor.statuses(),
    kinRefresh: kinSubscriptionSupervisor.refreshState(),
    groups: groupSubscriptionSupervisor.statuses().map((subscription) => subscription.group),
    groupSubscriptions: groupSubscriptionSupervisor.statuses(),
    groupRefresh: groupSubscriptionSupervisor.refreshState()
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
  await kinSubscriptionSupervisor.refresh();
  await groupSubscriptionSupervisor.refresh();
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

  kinSubscriptionSupervisor.startKnownKin(input.kinId, input.pageSize);
  return { ok: true };
}

async function startKinMonitor(kin: KindroidKin, options: { pageSize: number; signal: AbortSignal }) {
  const monitor = new KindroidLiveMonitor(config, logger);
  await monitor.start({
    kinId: kin.aiId,
    pageSize: options.pageSize,
    signal: options.signal,
    onMessage: (message) => {
      sendRendererEvent("monitor-line", { ...message, kinName: kin.name });
    }
  });
}

async function setKinSubscriptionEnabled(input: { kinId: string; enabled: boolean }) {
  await kinSubscriptionSupervisor.setKinEnabled(input.kinId, input.enabled);
  return { ok: true };
}

async function startGroupMonitor(group: KindroidGroup, options: { pageSize: number; signal: AbortSignal }) {
  const client = new KindroidApiClient(config, logger);
  const decryptionKey = resolveDecryptionKey();
  await client.groupChats.listenMessages({
    groupId: group.groupId,
    pageSize: options.pageSize,
    signal: options.signal,
    onDocument: (document) => {
      const data = document.data();
      const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
      const aiId = typeof record.ai_id === "string" && record.ai_id.length > 0 ? record.ai_id : group.groupId;
      const message = mapKindroidMessage(document, aiId, { decryptionKey });
      sendRendererEvent("monitor-line", {
        type: "kindroid.chat.message",
        id: message.id,
        kinId: message.kinId,
        groupId: group.groupId,
        groupName: group.name,
        timestamp: message.timestamp,
        sender: message.sender,
        role: message.role,
        text: message.text,
        textEncrypted: message.textEncrypted,
        textDecrypted: message.textDecrypted,
        textDecryptionError: message.textDecryptionError,
        source: "firestore"
      });
    }
  });
}

async function setGroupSubscriptionEnabled(input: { groupId: string; enabled: boolean }) {
  await groupSubscriptionSupervisor.setGroupEnabled(input.groupId, input.enabled);
  return { ok: true };
}

function resolveDecryptionKey(): string {
  if (config.kindroid.uid) {
    return config.kindroid.uid;
  }

  const session = loadBrowserSession(config.bridge.sessionDir);
  const uid = session.firebaseAuth?.uid;
  if (!uid) {
    throw new Error(
      "Cannot decrypt live messages without a Firebase UID. Run npm run session-info to verify the saved session."
    );
  }

  return uid;
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
