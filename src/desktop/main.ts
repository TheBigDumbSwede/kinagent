import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, shell, Tray, ipcMain } from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { ensureSessionDir, storageStatePath } from "../auth/tokenStore.js";
import { loadConfig } from "../config/loadConfig.js";
import { readCapturedKin } from "../capture/captureReader.js";
import { BridgeRuntime, type BridgeRuntimeEvent } from "../runtime/bridgeRuntime.js";
import { createLogger } from "../util/logger.js";
import {
  loadKinVoicePreference,
  openAiVoiceOptions,
  saveKinVoicePreference,
  voiceProvidersConfigured,
  type KinVoicePreference
} from "../voice/voicePreferences.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = loadConfig();
const logger = createLogger(config.bridge.logLevel, { logPath: config.bridge.logPath });

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let loginSession: { browser: Browser; context: BrowserContext } | null = null;
let runtime: BridgeRuntime | null = null;

app.setName("Kinagent");

void app.whenReady().then(async () => {
  runtime = await BridgeRuntime.create({
    config,
    logger,
    shouldSkipSessionWarm: () => Boolean(loginSession),
    onVoicePlayback: (chunk) => sendVoicePlayback(chunk),
    onEvent: (event) => sendRuntimeEvent(event)
  });
  createMainWindow();
  createTray();
  registerIpcHandlers();
  runtime.start();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  runtime?.stop();
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
      { label: "Refresh Kins", click: () => void requireRuntime().refreshKins() },
      { label: "Refresh Groups", click: () => void requireRuntime().refreshGroups() },
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
  ipcMain.handle("monitor:stop", async () => requireRuntime().stopAllKins("manual"));
  ipcMain.handle("kins:set-enabled", async (_event, input: { kinId: string; enabled: boolean }) =>
    setKinSubscriptionEnabled(input)
  );
  ipcMain.handle("kins:refresh", async () => {
    await requireRuntime().refreshKins();
    return { ok: true };
  });
  ipcMain.handle("groups:set-enabled", async (_event, input: { groupId: string; enabled: boolean }) =>
    setGroupSubscriptionEnabled(input)
  );
  ipcMain.handle("groups:refresh", async () => {
    await requireRuntime().refreshGroups();
    return { ok: true };
  });
  ipcMain.handle("capture:get-kin", async (_event, input: { kinId?: string } = {}) => {
    const kinId = input.kinId ?? "";
    const startedAt = Date.now();
    logger.info("Reading captured Kin state for desktop.", { kinId });
    try {
      const result = await readCapturedKin(kinId);
      logger.info("Read captured Kin state for desktop.", {
        kinId,
        ok: result.ok,
        fields: result.fields.length,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      logger.error("Failed to read captured Kin state for desktop.", {
        kinId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  });
  ipcMain.handle("voice:get-kin-preference", async (_event, input: { kinId?: string } = {}) =>
    getKinVoicePreference(input.kinId ?? "")
  );
  ipcMain.handle(
    "voice:set-kin-preference",
    async (_event, input: { kinId?: string; preference?: Partial<KinVoicePreference> } = {}) =>
      setKinVoicePreference(input.kinId ?? "", input.preference ?? {})
  );
}

async function getDesktopStatus() {
  return {
    ...requireRuntime().status(),
    loginOpen: Boolean(loginSession)
  };
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
  await requireRuntime().refreshKins();
  await requireRuntime().refreshGroups();
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

  requireRuntime().startKnownKin(input.kinId, input.pageSize);
  return { ok: true };
}

async function setKinSubscriptionEnabled(input: { kinId: string; enabled: boolean }) {
  await requireRuntime().setKinEnabled(input.kinId, input.enabled);
  return { ok: true };
}

async function setGroupSubscriptionEnabled(input: { groupId: string; enabled: boolean }) {
  await requireRuntime().setGroupEnabled(input.groupId, input.enabled);
  return { ok: true };
}

function getKinVoicePreference(kinId: string) {
  if (!kinId) {
    throw new Error("Select a Kin before editing voice.");
  }

  return {
    ok: true,
    globalEnabled: config.voice.enabled,
    configuredProviders: voiceProvidersConfigured(config),
    openAiVoiceOptions,
    preference: loadKinVoicePreference(config, kinId)
  };
}

function setKinVoicePreference(kinId: string, preference: Partial<KinVoicePreference>) {
  if (!kinId) {
    throw new Error("Select a Kin before editing voice.");
  }

  const saved = saveKinVoicePreference(config, kinId, preference);
  logger.info("Saved Kin voice preference.", {
    kinId,
    enabled: saved.enabled,
    provider: saved.provider,
    openaiVoice: saved.openaiVoice,
    elevenLabsVoiceConfigured: Boolean(saved.elevenLabsVoiceId)
  });
  return {
    ok: true,
    globalEnabled: config.voice.enabled,
    configuredProviders: voiceProvidersConfigured(config),
    openAiVoiceOptions,
    preference: saved
  };
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

function sendRuntimeEvent(event: BridgeRuntimeEvent): void {
  sendRendererEvent(event.channel, event.payload);
}

function sendVoicePlayback(chunk: unknown): void {
  sendRendererEvent("voice-audio", chunk);
}

function requireRuntime(): BridgeRuntime {
  if (!runtime) {
    throw new Error("Bridge runtime is not ready.");
  }

  return runtime;
}

function desktopIconPath(fileName: string): string {
  return path.join(__dirname, "assets", fileName);
}
