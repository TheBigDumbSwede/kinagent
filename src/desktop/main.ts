import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, Notification, shell, Tray, ipcMain, dialog } from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { ensureSessionDir, storageStatePath } from "../auth/tokenStore.js";
import { loadConfig, saveConfig } from "../config/loadConfig.js";
import type { AppConfig, LogLevel, VoiceProvider } from "../config/types.js";
import { readCapturedGroup, readCapturedKin } from "../capture/captureReader.js";
import {
  exportGroupChatTranscript,
  exportKinChatTranscript,
  type KinChatExportProgress,
  type KinChatExportResult
} from "../chatExport/chatExport.js";
import { analyzeKinDesign, type KinAnalysisProgress } from "../kinAnalysis/kinAnalysis.js";
import { BridgeRuntime, type BridgeRuntimeEvent, type KinSoundscapePreference } from "../runtime/bridgeRuntime.js";
import type { JournalSuggestion } from "../journal/journalSuggestionStore.js";
import { BrowserBridgeServer } from "../browserIntegration/browserBridgeServer.js";
import { browserBridgeAuthPath, loadOrCreateBrowserBridgeAuth } from "../browserIntegration/browserBridgeAuth.js";
import {
  browserIntegrationAllowedExtensionIds,
  readBrowserIntegrationStatus,
  registerBrowserIntegration,
  saveBrowserIntegrationSettings,
  unregisterBrowserIntegration,
  type BrowserIntegrationStatus,
  type BrowserIntegrationRegistrationPaths
} from "../browserIntegration/browserIntegrationRegistration.js";
import { nativeHostExecutablePath } from "../browserIntegration/nativeMessaging.js";
import { createLogger, type Logger } from "../util/logger.js";
import {
  loadKinVoicePreference,
  openAiVoiceOptions,
  saveKinVoicePreference,
  voiceProvidersConfigured,
  type KinVoicePreference
} from "../voice/voicePreferences.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const launchCwd = process.cwd();

let config: AppConfig;
let logger: Logger;
let desktopConfigPath = "";
let desktopUserDataDir = "";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let loginSession: { browser: Browser; context: BrowserContext } | null = null;
let runtime: BridgeRuntime | null = null;
let browserBridgeServer: BrowserBridgeServer | null = null;
let smokeWindowReady = false;
let smokeRuntimeReady = false;

app.setName("Kinagent");

if (process.env.KINAGENT_DESKTOP_SMOKE === "1") {
  app.setPath("userData", path.join(os.tmpdir(), `kinagent-desktop-smoke-${process.pid}`));
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  void app.whenReady().then(async () => {
    initializeDesktopConfig();
    const bridgeAuth = loadOrCreateBrowserBridgeAuth(browserBridgeAuthPath(desktopUserDataDir));
    browserBridgeServer = new BrowserBridgeServer({ logger, authSecret: bridgeAuth.secret });
    await refreshBrowserBridgeAllowedExtensionIds();
    void browserBridgeServer.start();
    createMainWindow();
    createTray();
    registerIpcHandlers();
    void startRuntime();

    app.on("activate", () => {
      showMainWindow();
    });
  });
}

function initializeDesktopConfig(): void {
  desktopUserDataDir = app.getPath("userData");
  desktopConfigPath = path.join(desktopUserDataDir, "config.yaml");
  fs.mkdirSync(desktopUserDataDir, { recursive: true });
  cleanupChatExportTempFiles();
  process.chdir(desktopUserDataDir);
  config = loadConfig({
    configPath: desktopConfigPath,
    createDefaultConfig: true
  });
  logger = createLogger(config.bridge.logLevel, { logPath: config.bridge.logPath });
}

app.on("before-quit", () => {
  isQuitting = true;
  runtime?.stop();
  void browserBridgeServer?.stop();
  cleanupChatExportTempFiles();
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.env.KINAGENT_DESKTOP_SMOKE === "1") {
      smokeWindowReady = true;
      maybeCompleteDesktopSmoke();
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

function isSafeExternalUrl(url: string): boolean {
  return url.startsWith("https://");
}

async function startRuntime(): Promise<void> {
  try {
    runtime = await BridgeRuntime.create({
      config,
      logger,
      shouldSkipSessionWarm: () => Boolean(loginSession),
      onVoicePlayback: (chunk) => sendVoicePlayback(chunk),
      onEvent: (event) => sendRuntimeEvent(event)
    });
    runtime.start();
    logger.info("Bridge runtime started.");
    smokeRuntimeReady = true;
    maybeCompleteDesktopSmoke();
    sendRendererEvent("session-updated", await getDesktopStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start bridge runtime.", { error: message });
    sendRendererEvent("runtime-startup-error", { error: message });
    if (process.env.KINAGENT_DESKTOP_SMOKE === "1") {
      app.exit(1);
    }
  }
}

function maybeCompleteDesktopSmoke(): void {
  if (process.env.KINAGENT_DESKTOP_SMOKE !== "1" || !smokeWindowReady || !smokeRuntimeReady) {
    return;
  }

  setTimeout(() => {
    isQuitting = true;
    app.quit();
  }, 1_000);
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
  ipcMain.handle("settings:get", async () => getDesktopSettings());
  ipcMain.handle("settings:save", async (_event, input: unknown) => saveDesktopSettings(input));
  ipcMain.handle("browser-integration:get-status", async () => getBrowserIntegrationStatus());
  ipcMain.handle("browser-integration:save-settings", async (_event, input: unknown) => {
    await saveBrowserIntegrationSettings(browserIntegrationPaths().settingsPath, input);
    await refreshBrowserBridgeAllowedExtensionIds();
    return getBrowserIntegrationStatus();
  });
  ipcMain.handle("browser-integration:register", async (_event, input: unknown) => {
    await registerBrowserIntegration(browserIntegrationPaths(), input);
    await refreshBrowserBridgeAllowedExtensionIds();
    return getBrowserIntegrationStatus();
  });
  ipcMain.handle("browser-integration:unregister", async () => {
    await unregisterBrowserIntegration(browserIntegrationPaths());
    await refreshBrowserBridgeAllowedExtensionIds();
    return getBrowserIntegrationStatus();
  });
  ipcMain.handle("browser-integration:test-notice", async () => {
    browserBridgeServer?.queueCommand("show-notice", { text: "Kinagent browser integration is connected." });
    return getBrowserIntegrationStatus();
  });
  ipcMain.handle("browser-integration:test-reload", async () => {
    browserBridgeServer?.queueCommand("reload-kindroid");
    return getBrowserIntegrationStatus();
  });
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
  ipcMain.handle("capture:get-group", async (_event, input: { groupId?: string } = {}) => {
    const groupId = input.groupId ?? "";
    const startedAt = Date.now();
    logger.info("Reading captured Group state for desktop.", { groupId });
    try {
      const result = await readCapturedGroup(groupId);
      logger.info("Read captured Group state for desktop.", {
        groupId,
        ok: result.ok,
        fields: result.fields.length,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      logger.error("Failed to read captured Group state for desktop.", {
        groupId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  });
  ipcMain.handle("journal:list-suggestions", async () => requireRuntime().pendingJournalSuggestions());
  ipcMain.handle("journal:accept-suggestion", async (_event, input: { id?: string } = {}) =>
    acceptJournalSuggestion(input.id ?? "")
  );
  ipcMain.handle("journal:delete-invalidated-suggestion", async (_event, input: { id?: string } = {}) =>
    deleteInvalidatedJournalSuggestion(input.id ?? "")
  );
  ipcMain.handle("journal:dismiss-suggestion", async (_event, input: { id?: string } = {}) =>
    dismissJournalSuggestion(input.id ?? "")
  );
  ipcMain.handle("background:list-group-suggestions", async () => requireRuntime().pendingGroupBackgroundSuggestions());
  ipcMain.handle("background:dismiss-group-suggestion", async (_event, input: { id?: string } = {}) =>
    dismissGroupBackgroundSuggestion(input.id ?? "")
  );
  ipcMain.handle("background:generate-group-image", async (_event, input: { id?: string } = {}) =>
    generateGroupBackgroundImage(input.id ?? "")
  );
  ipcMain.handle("background:apply-group-image", async (_event, input: { id?: string } = {}) =>
    applyGroupBackgroundImage(input.id ?? "")
  );
  ipcMain.handle("background:get-group-preference", async (_event, input: { groupId?: string } = {}) =>
    getGroupBackgroundPreference(input.groupId ?? "")
  );
  ipcMain.handle(
    "background:set-group-preference",
    async (_event, input: { groupId?: string; preference?: Partial<GroupBackgroundPreference> } = {}) =>
      setGroupBackgroundPreference(input.groupId ?? "", input.preference ?? {})
  );
  ipcMain.handle("voice:get-kin-preference", async (_event, input: { kinId?: string } = {}) =>
    getKinVoicePreference(input.kinId ?? "")
  );
  ipcMain.handle(
    "voice:set-kin-preference",
    async (_event, input: { kinId?: string; preference?: Partial<KinAudioPreference> } = {}) =>
      setKinVoicePreference(input.kinId ?? "", input.preference ?? {})
  );
  ipcMain.handle("soundscape:get-group-preference", async (_event, input: { groupId?: string } = {}) =>
    getGroupSoundscapePreference(input.groupId ?? "")
  );
  ipcMain.handle(
    "soundscape:set-group-preference",
    async (_event, input: { groupId?: string; preference?: Partial<GroupSoundscapePreference> } = {}) =>
      setGroupSoundscapePreference(input.groupId ?? "", input.preference ?? {})
  );
  ipcMain.handle("gaming:get-group-preference", async (_event, input: { groupId?: string } = {}) =>
    getGroupGamingPreference(input.groupId ?? "")
  );
  ipcMain.handle(
    "gaming:set-group-preference",
    async (_event, input: { groupId?: string; preference?: Partial<GroupGamingPreference> } = {}) =>
      setGroupGamingPreference(input.groupId ?? "", input.preference ?? {})
  );
  ipcMain.handle("gaming:approve-keeper-suggestion", async (_event, input: { groupId?: string } = {}) =>
    approveGroupGamingKeeperSuggestion(input.groupId ?? "")
  );
  ipcMain.handle("gaming:import-campaign-pack", async () => importCampaignPackFromDialog());
  ipcMain.handle("prewarm:local-scene", async (_event, input: { scope?: "kin" | "group"; id?: string } = {}) =>
    forceLocalScenePrewarm(input.scope, input.id ?? "")
  );
  ipcMain.handle("prewarm:soundscape", async (_event, input: { scope?: "kin" | "group"; id?: string } = {}) =>
    forceSoundscapePrewarm(input.scope, input.id ?? "")
  );
  ipcMain.handle("prewarm:previously-on", async (_event, input: { scope?: "kin" | "group"; id?: string } = {}) =>
    forcePreviouslyOnPrewarm(input.scope, input.id ?? "")
  );
  ipcMain.handle("prewarm:group-background", async (_event, input: { groupId?: string } = {}) =>
    forceGroupBackgroundPrewarm(input.groupId ?? "")
  );
  ipcMain.handle("ambient:get-kin-preference", async (_event, input: { kinId?: string } = {}) =>
    getKinAmbientPreference(input.kinId ?? "")
  );
  ipcMain.handle(
    "ambient:set-kin-preference",
    async (
      _event,
      input: {
        kinId?: string;
        enabled?: boolean;
        chatDynamism?: { enabled?: boolean; min?: number; max?: number };
      } = {}
    ) => setKinAmbientPreference(input.kinId ?? "", input.enabled, input.chatDynamism)
  );
  ipcMain.handle(
    "chat-export:kin",
    async (
      _event,
      input: {
        kinId?: string;
        fromDate?: string;
        toDate?: string;
      } = {}
    ) => exportKinChat(input)
  );
  ipcMain.handle(
    "chat-export:group",
    async (
      _event,
      input: {
        groupId?: string;
        fromDate?: string;
        toDate?: string;
      } = {}
    ) => exportGroupChat(input)
  );
  ipcMain.handle("kin-analyze:run", async (_event, input: { kinId?: string } = {}) => analyzeKin(input.kinId ?? ""));
  ipcMain.handle("soundscape:read-asset", async (_event, input: { path?: string } = {}) =>
    readSoundscapeAsset(input.path ?? "")
  );
}

async function getDesktopStatus() {
  return {
    ...requireRuntime().status(),
    loginOpen: Boolean(loginSession)
  };
}

function getDesktopSettings(input: { saved?: boolean } = {}) {
  return {
    ok: true,
    saved: Boolean(input.saved),
    requiresRestart: Boolean(input.saved),
    configPath: desktopConfigPath,
    userDataDir: desktopUserDataDir,
    config
  };
}

function browserIntegrationPaths(): BrowserIntegrationRegistrationPaths {
  return {
    settingsPath: path.join(desktopUserDataDir, "browser-integration.json"),
    manifestDir: path.join(desktopUserDataDir, "native-messaging"),
    hostPath: app.isPackaged
      ? nativeHostExecutablePath(process.resourcesPath)
      : path.join(launchCwd, "dist", "native-host", "win-x64", "kinagent-native-host.exe")
  };
}

async function getBrowserIntegrationStatus(): Promise<
  BrowserIntegrationStatus & { bridge: ReturnType<BrowserBridgeServer["status"]> }
> {
  const status = await readBrowserIntegrationStatus(browserIntegrationPaths());
  return {
    ...status,
    bridge: browserBridgeServer?.status() ?? {
      connected: false,
      queuedCommandCount: 0,
      protocolVersion: 1,
      authenticatedSessionCount: 0,
      lastReadyAt: null,
      lastPollAt: null,
      lastAckAt: null
    }
  };
}

async function refreshBrowserBridgeAllowedExtensionIds(): Promise<void> {
  const status = await readBrowserIntegrationStatus(browserIntegrationPaths());
  browserBridgeServer?.setAllowedExtensionIds(browserIntegrationAllowedExtensionIds(status.settings));
}

function saveDesktopSettings(input: unknown) {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next = cloneConfig(config);

  next.kindroid.apiKey = stringSetting(fields.kindroidApiKey, next.kindroid.apiKey ?? "");

  next.bridge.logLevel = logLevelSetting(fields.logLevel, next.bridge.logLevel);
  next.bridge.dedupeWindowSeconds = positiveIntegerSetting(
    fields.dedupeWindowSeconds,
    next.bridge.dedupeWindowSeconds,
    "Dedupe window"
  );

  next.hermes.enabled = booleanSetting(fields.hermesEnabled, next.hermes.enabled);
  next.hermes.baseUrl = stringSetting(fields.hermesBaseUrl, next.hermes.baseUrl);
  next.hermes.apiKey = stringSetting(fields.hermesApiKey, next.hermes.apiKey);
  next.hermes.agentId = stringSetting(fields.hermesAgentId, next.hermes.agentId);
  next.hermes.currentSceneUpdates.enabled = booleanSetting(
    fields.hermesCurrentSceneEnabled,
    next.hermes.currentSceneUpdates.enabled
  );
  next.hermes.currentSceneUpdates.maxLength = positiveIntegerSetting(
    fields.hermesCurrentSceneMaxLength,
    next.hermes.currentSceneUpdates.maxLength,
    "Current scene max length"
  );
  next.hermes.journalSuggestions.enabled = booleanSetting(
    fields.hermesJournalSuggestionsEnabled,
    next.hermes.journalSuggestions.enabled
  );
  next.hermes.journalSuggestions.throttleMessages = positiveIntegerSetting(
    fields.hermesJournalThrottleMessages,
    next.hermes.journalSuggestions.throttleMessages,
    "Journal suggestion throttle"
  );
  next.hermes.journalSuggestions.strongEventBypass = booleanSetting(
    fields.hermesJournalStrongEventBypass,
    next.hermes.journalSuggestions.strongEventBypass
  );

  next.voice.enabled = booleanSetting(fields.voiceEnabled, next.voice.enabled);
  next.voice.provider = voiceProviderSetting(fields.voiceProvider, next.voice.provider);
  next.voice.openai.apiKey = stringSetting(fields.openAiApiKey, next.voice.openai.apiKey);
  next.voice.openai.model = stringSetting(fields.openAiModel, next.voice.openai.model);
  next.voice.openai.voice = stringSetting(fields.openAiVoice, next.voice.openai.voice);
  next.voice.openai.instructions = stringSetting(fields.openAiInstructions, next.voice.openai.instructions);
  next.voice.elevenlabs.apiKey = stringSetting(fields.elevenLabsApiKey, next.voice.elevenlabs.apiKey);
  next.voice.elevenlabs.model = stringSetting(fields.elevenLabsModel, next.voice.elevenlabs.model);
  next.voice.elevenlabs.outputFormat = stringSetting(fields.elevenLabsOutputFormat, next.voice.elevenlabs.outputFormat);

  saveConfig(next, desktopConfigPath);
  config = loadConfig({ configPath: desktopConfigPath, createDefaultConfig: true });
  logger = createLogger(config.bridge.logLevel, { logPath: config.bridge.logPath });
  logger.info("Saved desktop settings.", { configPath: desktopConfigPath });

  return getDesktopSettings({ saved: true });
}

function cloneConfig(value: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(value)) as AppConfig;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveIntegerSetting(value: unknown, fallback: number, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

function logLevelSetting(value: unknown, fallback: LogLevel): LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error" ? value : fallback;
}

function voiceProviderSetting(value: unknown, fallback: VoiceProvider): VoiceProvider {
  return value === "none" || value === "openai" || value === "elevenlabs" ? value : fallback;
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
    throw new Error("Select a Kin before editing audio.");
  }

  return {
    ok: true,
    globalEnabled: config.voice.enabled,
    configuredProviders: voiceProvidersConfigured(config),
    openAiVoiceOptions,
    preference: loadKinVoicePreference(config, kinId),
    soundscape: requireRuntime().getKinSoundscapePreference(kinId)
  };
}

interface KinAudioPreference extends KinVoicePreference {
  soundscape?: Partial<KinSoundscapePreference>;
}

interface GroupSoundscapePreference {
  enabled: boolean;
}

interface GroupGamingPreference {
  enabled?: boolean;
  campaignId?: string;
  mysteryId?: string;
  automationMode?: "observe" | "suggest" | "autonomous";
}

interface GroupBackgroundPreference {
  enabled?: boolean;
  autonomous?: boolean;
}

function setKinVoicePreference(kinId: string, preference: Partial<KinAudioPreference>) {
  if (!kinId) {
    throw new Error("Select a Kin before editing audio.");
  }

  const saved = saveKinVoicePreference(config, kinId, preference);
  const savedSoundscape = preference.soundscape
    ? requireRuntime().setKinSoundscapePreference(kinId, preference.soundscape)
    : requireRuntime().getKinSoundscapePreference(kinId);
  logger.info("Saved Kin audio preference.", {
    kinId,
    voiceEnabled: saved.enabled,
    provider: saved.provider,
    openaiVoice: saved.openaiVoice,
    elevenLabsVoiceConfigured: Boolean(saved.elevenLabsVoiceId),
    kinSoundscapeEnabled: savedSoundscape.enabled
  });
  return {
    ok: true,
    globalEnabled: config.voice.enabled,
    configuredProviders: voiceProvidersConfigured(config),
    openAiVoiceOptions,
    preference: saved,
    soundscape: savedSoundscape
  };
}

function getGroupSoundscapePreference(groupId: string) {
  if (!groupId) {
    throw new Error("Select a Group before editing audio.");
  }

  return {
    ok: true,
    soundscape: requireRuntime().getGroupSoundscapePreference(groupId)
  };
}

function setGroupSoundscapePreference(groupId: string, preference: Partial<GroupSoundscapePreference>) {
  if (!groupId) {
    throw new Error("Select a Group before editing audio.");
  }

  const savedSoundscape = requireRuntime().setGroupSoundscapePreference(groupId, preference);
  logger.info("Saved Group audio preference.", {
    groupId,
    groupSoundscapeEnabled: savedSoundscape.enabled
  });
  return {
    ok: true,
    soundscape: savedSoundscape
  };
}

function getGroupGamingPreference(groupId: string) {
  if (!groupId) {
    throw new Error("Select a Group before editing Gaming.");
  }

  return requireRuntime().getGroupGamingPreference(groupId);
}

function setGroupGamingPreference(groupId: string, preference: Partial<GroupGamingPreference>) {
  if (!groupId) {
    throw new Error("Select a Group before editing Gaming.");
  }

  const saved = requireRuntime().setGroupGamingPreference(groupId, preference);
  logger.info("Saved Group Gaming preference.", {
    groupId,
    enabled: saved.preference.enabled,
    campaignId: saved.preference.campaignId,
    mysteryId: saved.preference.mysteryId,
    automationMode: saved.preference.automationMode
  });
  return saved;
}

function getGroupBackgroundPreference(groupId: string) {
  if (!groupId) {
    throw new Error("Select a Group before editing Background.");
  }

  return {
    ok: true,
    preference: requireRuntime().getGroupBackgroundPreference(groupId)
  };
}

function setGroupBackgroundPreference(groupId: string, preference: Partial<GroupBackgroundPreference>) {
  if (!groupId) {
    throw new Error("Select a Group before editing Background.");
  }

  const saved = requireRuntime().setGroupBackgroundPreference(groupId, preference);
  logger.info("Saved Group Background preference.", {
    groupId,
    enabled: saved.enabled,
    autonomous: saved.autonomous
  });
  return {
    ok: true,
    preference: saved
  };
}

async function approveGroupGamingKeeperSuggestion(groupId: string) {
  if (!groupId) {
    throw new Error("Select a Group before sending a Keeper suggestion.");
  }

  const result = await requireRuntime().approveGroupGamingKeeperSuggestion(groupId);
  logger.info("Approved Group Gaming Keeper suggestion.", {
    groupId,
    campaignId: result.preference.campaignId,
    mysteryId: result.preference.mysteryId
  });
  return result;
}

async function importCampaignPackFromDialog() {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "Import campaign pack",
        properties: ["openFile"],
        filters: [
          { name: "Campaign packs", extensions: ["zip", "json"] },
          { name: "Zip archives", extensions: ["zip"] },
          { name: "JSON campaign packs", extensions: ["json"] }
        ]
      })
    : await dialog.showOpenDialog({
        title: "Import campaign pack",
        properties: ["openFile"],
        filters: [
          { name: "Campaign packs", extensions: ["zip", "json"] },
          { name: "Zip archives", extensions: ["zip"] },
          { name: "JSON campaign packs", extensions: ["json"] }
        ]
      });

  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  const imported = requireRuntime().importCampaignPack(result.filePaths[0]);
  logger.info("Imported Group Gaming campaign pack.", {
    campaignId: imported.campaign.id,
    title: imported.campaign.title,
    installedPath: imported.installedPath
  });
  return imported;
}

async function forceLocalScenePrewarm(scope: "kin" | "group" | undefined, id: string) {
  if (scope !== "kin" && scope !== "group") {
    throw new Error("Select a Kin or Group before forcing local scene prewarm.");
  }
  return requireRuntime().forceLocalScenePrewarm({ scope, id });
}

async function forceSoundscapePrewarm(scope: "kin" | "group" | undefined, id: string) {
  if (scope !== "kin" && scope !== "group") {
    throw new Error("Select a Kin or Group before forcing soundscape prewarm.");
  }
  return requireRuntime().forceSoundscapePrewarm({ scope, id });
}

async function forcePreviouslyOnPrewarm(scope: "kin" | "group" | undefined, id: string) {
  if (scope !== "kin" && scope !== "group") {
    throw new Error("Select a Kin or Group before refreshing Previously On.");
  }
  return requireRuntime().forcePreviouslyOnPrewarm({ scope, id });
}

async function forceGroupBackgroundPrewarm(groupId: string) {
  if (!groupId) {
    throw new Error("Select a Group before forcing background prewarm.");
  }
  return requireRuntime().forceGroupBackgroundPrewarm({ groupId });
}

function getKinAmbientPreference(kinId: string) {
  const ambient = requireRuntime().getKinAmbientContextPreference(kinId);
  const status = requireRuntime()
    .status()
    .subscriptions.find((subscription) => subscription.kin.aiId === kinId);
  return {
    ...ambient,
    chatDynamism: requireRuntime().getKinChatDynamismPreference(kinId),
    currentChatDynamism: status?.kin.chatDynamism ?? null
  };
}

function setKinAmbientPreference(
  kinId: string,
  enabled: unknown,
  chatDynamism?: { enabled?: boolean; min?: number; max?: number }
) {
  if (typeof enabled !== "boolean") {
    throw new Error("Ambient context enabled must be true or false.");
  }

  const ambient = requireRuntime().setKinAmbientContextEnabled(kinId, enabled);
  const savedChatDynamism = chatDynamism
    ? requireRuntime().setKinChatDynamismPreference(kinId, {
        enabled: chatDynamism.enabled,
        min: chatDynamism.min,
        max: chatDynamism.max
      })
    : requireRuntime().getKinChatDynamismPreference(kinId);
  const status = requireRuntime()
    .status()
    .subscriptions.find((subscription) => subscription.kin.aiId === kinId);
  logger.info("Saved Kin Hermes preference.", {
    kinId,
    ambientEnabled: ambient.enabled,
    chatDynamismEnabled: savedChatDynamism.enabled,
    chatDynamismMin: savedChatDynamism.min,
    chatDynamismMax: savedChatDynamism.max
  });
  return {
    ...ambient,
    chatDynamism: savedChatDynamism,
    currentChatDynamism: status?.kin.chatDynamism ?? null
  };
}

async function analyzeKin(kinId: string) {
  if (!kinId) {
    throw new Error("Select a Kin before running analysis.");
  }

  const status = requireRuntime()
    .status()
    .subscriptions.find((subscription) => subscription.kin.aiId === kinId);
  const kinName = status?.kin.name || kinId;
  const jobId = randomUUID();
  const progress = (payload: KinAnalysisProgress) => {
    sendRendererEvent("kin-analysis-progress", { jobId, ...payload });
  };
  const result = await analyzeKinDesign(
    config,
    logger,
    {
      kinId,
      kinName,
      chatDynamism: status?.kin.chatDynamism,
      chatDynamismPreference: requireRuntime().getKinChatDynamismPreference(kinId)
    },
    progress
  );

  return {
    ...result,
    jobId
  };
}

async function exportKinChat(input: { kinId?: string; fromDate?: string; toDate?: string }) {
  const kinId = input.kinId ?? "";
  if (!kinId) {
    throw new Error("Select a Kin before exporting chat.");
  }

  const status = requireRuntime().status();
  const kinName = status.subscriptions.find((subscription) => subscription.kin.aiId === kinId)?.kin.name || kinId;
  const jobId = randomUUID();
  const progress = (payload: KinChatExportProgress) => {
    sendRendererEvent("chat-export-progress", { jobId, ...payload });
  };

  const result = await exportKinChatTranscript(
    config,
    logger,
    {
      kinId,
      kinName,
      fromDate: input.fromDate,
      toDate: input.toDate,
      tempDir: chatExportTempDir()
    },
    progress
  );

  return saveChatExportResult(result, jobId);
}

async function exportGroupChat(input: { groupId?: string; fromDate?: string; toDate?: string }) {
  const groupId = input.groupId ?? "";
  if (!groupId) {
    throw new Error("Select a Group before exporting chat.");
  }

  const status = requireRuntime().status();
  const groupName =
    status.groupSubscriptions.find((subscription) => subscription.group.groupId === groupId)?.group.name || groupId;
  const speakerNames = Object.fromEntries(
    status.kins.filter((kin) => kin.aiId && kin.name).map((kin) => [kin.aiId, kin.name])
  );
  const jobId = randomUUID();
  const progress = (payload: KinChatExportProgress) => {
    sendRendererEvent("chat-export-progress", { jobId, ...payload });
  };

  const result = await exportGroupChatTranscript(
    config,
    logger,
    {
      groupId,
      groupName,
      speakerNames,
      fromDate: input.fromDate,
      toDate: input.toDate,
      tempDir: chatExportTempDir()
    },
    progress
  );

  return saveChatExportResult(result, jobId);
}

async function saveChatExportResult(result: KinChatExportResult, jobId: string) {
  const saveOptions = {
    title: "Save chat export",
    defaultPath: result.fileName,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  };
  const saveResult = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (saveResult.canceled || !saveResult.filePath) {
    fs.rmSync(result.tempPath, { force: true });
    return {
      ok: false,
      canceled: true,
      exportedCount: result.exportedCount,
      totalCount: result.totalCount,
      jobId
    };
  }

  fs.copyFileSync(result.tempPath, saveResult.filePath);
  fs.rmSync(result.tempPath, { force: true });
  return {
    ok: true,
    filePath: saveResult.filePath,
    exportedCount: result.exportedCount,
    totalCount: result.totalCount,
    jobId
  };
}

async function acceptJournalSuggestion(id: string) {
  if (!id) {
    throw new Error("Journal suggestion id is required.");
  }

  const suggestion = await requireRuntime().acceptJournalSuggestion(id);
  sendRendererEvent("journal-suggestions-updated", requireRuntime().pendingJournalSuggestions());
  return { ok: true, suggestion };
}

async function deleteInvalidatedJournalSuggestion(id: string) {
  if (!id) {
    throw new Error("Journal suggestion id is required.");
  }

  const suggestion = await requireRuntime().deleteInvalidatedJournalSuggestion(id);
  sendRendererEvent("journal-suggestions-updated", requireRuntime().pendingJournalSuggestions());
  return { ok: true, suggestion };
}

function dismissJournalSuggestion(id: string) {
  if (!id) {
    throw new Error("Journal suggestion id is required.");
  }

  const suggestion = requireRuntime().dismissJournalSuggestion(id);
  sendRendererEvent("journal-suggestions-updated", requireRuntime().pendingJournalSuggestions());
  return { ok: true, suggestion };
}

function dismissGroupBackgroundSuggestion(id: string) {
  if (!id) {
    throw new Error("Group background suggestion id is required.");
  }

  const suggestion = requireRuntime().dismissGroupBackgroundSuggestion(id);
  sendRendererEvent("group-background-suggestions-updated", requireRuntime().pendingGroupBackgroundSuggestions());
  return { ok: true, suggestion };
}

async function generateGroupBackgroundImage(id: string) {
  if (!id) {
    throw new Error("Group background suggestion id is required.");
  }

  const suggestion = await requireRuntime().generateGroupBackgroundImage({ suggestionId: id });
  sendRendererEvent("group-background-suggestions-updated", requireRuntime().pendingGroupBackgroundSuggestions());
  return { ok: true, suggestion };
}

async function applyGroupBackgroundImage(id: string) {
  if (!id) {
    throw new Error("Group background suggestion id is required.");
  }

  const suggestion = await requireRuntime().applyGeneratedGroupBackground({ suggestionId: id });
  sendRendererEvent("group-background-suggestions-updated", requireRuntime().pendingGroupBackgroundSuggestions());
  return { ok: true, suggestion };
}

function queueKindroidUiReload(reason: string, meta: Record<string, unknown> = {}): void {
  const command = browserBridgeServer?.queueCommand("reload-kindroid");
  if (!command) {
    logger.info("Kindroid UI reload skipped because the browser bridge is not available.", { reason, ...meta });
    return;
  }

  logger.info("Kindroid UI reload queued through browser bridge.", {
    reason,
    commandId: command.id,
    ...meta
  });
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
  if (event.channel === "journal-suggestion-created") {
    showJournalSuggestionNotification(event.payload);
  }
  if (event.channel === "group-background-applied") {
    queueKindroidUiReload("group background image applied", event.payload);
  }
  sendRendererEvent(event.channel, event.payload);
}

function chatExportTempDir(): string {
  return path.join(app.getPath("temp"), "kinagent-chat-exports");
}

function cleanupChatExportTempFiles(): void {
  try {
    fs.rmSync(chatExportTempDir(), { recursive: true, force: true });
  } catch (error) {
    logger?.warn("Failed to clean chat export temporary files.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function sendVoicePlayback(chunk: unknown): void {
  sendRendererEvent("voice-audio", chunk);
}

function readSoundscapeAsset(relativePath: string): ArrayBuffer {
  const normalizedPath = relativePath.includes("/") ? relativePath : `loops/${relativePath}`;
  if (!/^(loops|cues)\/[a-z0-9_]+(?:_v\d+)?\.mp3$/i.test(normalizedPath)) {
    throw new Error("Invalid soundscape asset path.");
  }

  const baseDir = path.resolve(__dirname, "assets", "soundscape-normalized");
  const assetPath = path.resolve(baseDir, normalizedPath);
  if (!assetPath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("Invalid soundscape asset path.");
  }

  const bytes = fs.readFileSync(assetPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

function showJournalSuggestionNotification(suggestion: JournalSuggestion): void {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: "Journal entry suggested",
    body: `Kinagent has a journal suggestion for ${resolveKinDisplayName(suggestion.aiId)}.`,
    icon: desktopIconPath("icon.png")
  });
  notification.on("click", () => {
    showMainWindow();
    sendRendererEvent("journal-suggestion-focus", suggestion);
  });
  notification.show();
}

function resolveKinDisplayName(aiId: string): string {
  try {
    return (
      requireRuntime()
        .status()
        .kins.find((kin) => kin.aiId === aiId)?.name || aiId
    );
  } catch {
    return aiId;
  }
}
