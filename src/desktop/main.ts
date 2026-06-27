import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  globalShortcut,
  ipcMain,
  dialog,
  safeStorage,
  screen
} from "electron";
import type { Event as ElectronEvent } from "electron";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { setBrowserSessionStorageForProcess } from "../auth/browserSessionStorage.js";
import type { BrowserStorageState } from "../auth/firebaseSession.js";
import { ensureSessionDir } from "../auth/tokenStore.js";
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
import {
  createStorybookFromTranscript,
  HttpStorybookHermesClient,
  loadStorybookTranscriptFromKindroidChat,
  type StorybookDocument,
  type StorybookOptions,
  type StorybookProgress
} from "../storybook/storybook.js";
import { parseImportedStorybookTranscript } from "../storybook/transcriptImport.js";
import { renderStorybookHtml } from "../storybook/storybookRender.js";
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
  applyStoredConfigSecrets,
  migrateConfigSecretsToSecureStore,
  saveConfigSecrets,
  scrubConfigSecrets,
  SecureSecretStore,
  secureSecretsPath
} from "./secureSecrets.js";
import {
  clearElectronCaches,
  clearSavedBrowserSession,
  profileDataReport,
  pruneProfileData
} from "../profile/profileDataMaintenance.js";
import { EncryptedBrowserSessionStorage } from "./encryptedBrowserSessionStorage.js";
import { CaptureHistoryVault, captureVaultPaths, type CaptureVaultActionResult } from "./captureVault.js";
import {
  TimelineStore,
  timelineEventTypes,
  type KinAgentTimelineEventType,
  type TimelineQuery
} from "../timeline/timelineStore.js";
import {
  loadKinVoicePreference,
  openAiVoiceOptions,
  saveKinVoicePreference,
  voiceProvidersConfigured,
  type KinVoicePreference
} from "../voice/voicePreferences.js";
import {
  analyzeScreenContextWithHermes,
  type ScreenContextAnalysisResult,
  type ScreenContextCaptureMetadata,
  type ScreenContextDetailLevel
} from "../screenContext/screenContextAnalysis.js";

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
let timelineStore: TimelineStore | null = null;
let secureSecretStore: SecureSecretStore | null = null;
let encryptedBrowserSessionStorage: EncryptedBrowserSessionStorage | null = null;
let captureVault: CaptureHistoryVault | null = null;
const storybookJobs = new Map<string, StorybookArtifactJob>();
const screenContextReviews = new Map<string, ScreenContextReview>();
let smokeWindowReady = false;
let smokeRuntimeReady = false;
let selectedScreenContextKinId: string | null = null;
let registeredScreenContextShortcut: string | null = null;
let screenContextShortcutRegistrationError: string | null = null;

interface StorybookArtifactJob {
  jobId: string;
  htmlPath: string;
  document: StorybookDocument;
}

interface ScreenContextReview {
  id: string;
  kinId: string;
  kinName: string;
  detailLevel: ScreenContextDetailLevel;
  capture: ScreenContextCaptureMetadata;
  analysis: ScreenContextAnalysisResult;
  status: "pending" | "sent" | "discarded";
  createdAt: string;
}

interface ScreenContextSettings {
  globalShortcut: string;
  autoSendSafe: boolean;
  detailLevel: ScreenContextDetailLevel;
  privacyAccepted: boolean;
}

interface ScreenContextSettingsInput {
  globalShortcut?: string;
  autoSendSafe?: boolean;
  detailLevel?: ScreenContextDetailLevel;
  privacyAccepted?: boolean;
}

interface ScreenContextAnalyzeResult {
  ok: boolean;
  review?: ReturnType<typeof toScreenContextReviewSummary>;
  autoSent?: boolean;
  autoSendBlockedReason?: string;
  autoSendError?: string;
  sendResult?: {
    ok: boolean;
    status: number;
    requestId: string;
    idempotencyKey: string;
  };
}

interface TimelineDesktopQuery {
  sourceId?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

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
    cleanupScreenContextTempFiles();
    const bridgeAuth = loadOrCreateBrowserBridgeAuth(browserBridgeAuthPath(desktopUserDataDir));
    browserBridgeServer = new BrowserBridgeServer({ logger, authSecret: bridgeAuth.secret });
    await refreshBrowserBridgeAllowedExtensionIds();
    void browserBridgeServer.start();
    createMainWindow();
    createTray();
    registerIpcHandlers();
    registerScreenContextShortcut(readScreenContextSettings().globalShortcut);
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
  cleanupStorybookTempFiles();
  process.chdir(desktopUserDataDir);
  config = loadConfig({
    configPath: desktopConfigPath,
    createDefaultConfig: true
  });
  secureSecretStore = new SecureSecretStore(secureSecretsPath(desktopUserDataDir), safeStorage);
  config = migrateConfigSecretsToSecureStore(config, desktopConfigPath, secureSecretStore);
  encryptedBrowserSessionStorage = new EncryptedBrowserSessionStorage();
  setBrowserSessionStorageForProcess(encryptedBrowserSessionStorage);
  logger = createLogger(config.bridge.logLevel, { logPath: config.bridge.logPath });
  timelineStore = TimelineStore.fromConfig(config);
  captureVault = new CaptureHistoryVault({ ...captureVaultPaths(desktopUserDataDir), cipher: safeStorage });
  const unlockResult = captureVault.unlockIfEnabled();
  if (unlockResult?.changed) {
    logger.info("Unlocked captured Kin history vault.", { archivePath: unlockResult.status.archivePath });
  }
  if (captureVault.status().lastError) {
    logger.warn("Captured Kin history vault unlock failed.", { error: captureVault.status().lastError });
  }
}

app.on("before-quit", () => {
  isQuitting = true;
  runtime?.stop();
  const lockResult = captureVault?.lockIfEnabled();
  if (lockResult?.changed) {
    logger?.info("Locked captured Kin history vault.", { archivePath: lockResult.status.archivePath });
  }
  if (captureVault?.status().lastError) {
    logger?.warn("Captured Kin history vault lock failed.", { error: captureVault.status().lastError });
  }
  void browserBridgeServer?.stop();
  unregisterScreenContextShortcut();
  cleanupScreenContextTempFiles();
  cleanupChatExportTempFiles();
  cleanupStorybookTempFiles();
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
      { label: "Analyze Screen for Current Kin", click: () => void analyzeScreenContextFromShortcut("tray") },
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
  ipcMain.handle("settings:prune-profile-data", async () => pruneDesktopProfileData());
  ipcMain.handle("settings:clear-saved-session", async () => clearDesktopSavedSession());
  ipcMain.handle("settings:clear-cache", async () => clearDesktopCache());
  ipcMain.handle("settings:capture-vault-enable", async (_event, input: { enabled?: boolean } = {}) =>
    setCaptureVaultEnabled(Boolean(input.enabled))
  );
  ipcMain.handle("settings:capture-vault-unlock", async () => unlockCaptureVault());
  ipcMain.handle("settings:open-profile-folder", async () => shell.openPath(desktopUserDataDir));
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
  ipcMain.handle("timeline:list", async (_event, input: TimelineDesktopQuery = {}) => listTimelineEvents(input));
  ipcMain.handle("timeline:export-json", async (_event, input: TimelineDesktopQuery = {}) =>
    exportTimelineEvents(input)
  );
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
  ipcMain.handle("screen-context:get-settings", async () => getScreenContextSettings());
  ipcMain.handle("screen-context:save-settings", async (_event, input: ScreenContextSettingsInput = {}) =>
    saveScreenContextSettings(input)
  );
  ipcMain.handle("screen-context:set-current-kin", async (_event, input: { kinId?: string | null } = {}) => {
    selectedScreenContextKinId = input.kinId?.trim() || null;
    return { ok: true };
  });
  ipcMain.handle("screen-context:analyze", async (_event, input: { kinId?: string } = {}) =>
    analyzeScreenContextForKin(input.kinId ?? "", "button")
  );
  ipcMain.handle("screen-context:send", async (_event, input: { id?: string } = {}) =>
    sendScreenContextReview(input.id ?? "")
  );
  ipcMain.handle("screen-context:discard", async (_event, input: { id?: string } = {}) =>
    discardScreenContextReview(input.id ?? "")
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
  ipcMain.handle("storybook:generate", async (_event, input: StorybookDesktopRequest = {}) =>
    generateStorybookPreview(input)
  );
  ipcMain.handle("storybook:import-generate", async (_event, input: StorybookDesktopRequest = {}) =>
    generateImportedStorybookPreview(input)
  );
  ipcMain.handle("storybook:save-pdf", async (_event, input: { jobId?: string } = {}) =>
    saveStorybookPdf(input.jobId ?? "")
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
    dataReport: profileDataReport(config, desktopUserDataDir, desktopConfigPath),
    secureSecrets: secureSecretStore?.status() ?? null,
    browserSessionEncryption: encryptedBrowserSessionStorage
      ? {
          available: encryptedBrowserSessionStorage.encryptionAvailable(),
          encrypted: encryptedBrowserSessionStorage.encrypted(config.bridge.sessionDir)
        }
      : null,
    captureVault: captureVault?.status() ?? null,
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

function listTimelineEvents(input: unknown) {
  const query = normalizeTimelineDesktopQuery(input);
  const events = requireTimelineStore().list(query);
  return {
    ok: true,
    events,
    total: events.length,
    filters: query
  };
}

async function exportTimelineEvents(input: unknown) {
  const listed = listTimelineEvents(input);
  const exportedAt = new Date();
  const saveOptions = {
    title: "Save timeline export",
    defaultPath: `kinagent-timeline-${timestampArtifactSuffix(exportedAt)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  };
  const saveResult = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (saveResult.canceled || !saveResult.filePath) {
    return {
      ok: false,
      canceled: true,
      exportedCount: listed.events.length
    };
  }

  fs.writeFileSync(
    saveResult.filePath,
    `${JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        filters: listed.filters,
        events: listed.events
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return {
    ok: true,
    filePath: saveResult.filePath,
    exportedCount: listed.events.length
  };
}

function normalizeTimelineDesktopQuery(input: unknown): TimelineQuery {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const type = timelineEventTypeSetting(fields.type);
  const sourceId = stringSetting(fields.sourceId, "");
  const from = timelineDateSetting(fields.from, "From");
  const to = timelineDateSetting(fields.to, "To");
  const limit = optionalPositiveIntegerSetting(fields.limit, "Limit", 500);
  return {
    ...(type ? { type } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(limit ? { limit } : {})
  };
}

function timelineEventTypeSetting(value: unknown): KinAgentTimelineEventType | undefined {
  const type = typeof value === "string" ? value.trim() : "";
  if (!type) {
    return undefined;
  }
  if (timelineEventTypes.includes(type as KinAgentTimelineEventType)) {
    return type as KinAgentTimelineEventType;
  }
  throw new Error(`Timeline event type is not supported: ${type}`);
}

function timelineDateSetting(value: unknown, label: string): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} date is not valid.`);
  }
  return new Date(timestamp).toISOString();
}

function optionalPositiveIntegerSetting(value: unknown, label: string, max: number): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return Math.min(parsed, max);
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

  const secretsSecured = secureSecretStore ? saveConfigSecrets(next, secureSecretStore) : false;
  saveConfig(secretsSecured ? scrubConfigSecrets(next) : next, desktopConfigPath);
  config = loadConfig({ configPath: desktopConfigPath, createDefaultConfig: true });
  if (secureSecretStore) {
    config = applyStoredConfigSecrets(config, secureSecretStore);
  }
  logger = createLogger(config.bridge.logLevel, { logPath: config.bridge.logPath });
  timelineStore = TimelineStore.fromConfig(config);
  logger.info("Saved desktop settings.", { configPath: desktopConfigPath });

  return getDesktopSettings({ saved: true });
}

function pruneDesktopProfileData() {
  const result = pruneProfileData(config, desktopUserDataDir);
  logger.info("Pruned profile data.", {
    journalSuggestionsRemoved: result.journalSuggestionsRemoved,
    groupBackgroundSuggestionsRemoved: result.groupBackgroundSuggestionsRemoved,
    chatDynamismSuggestionsRemoved: result.chatDynamismSuggestionsRemoved,
    orphanedGroupBackgroundImagesRemoved: result.orphanedGroupBackgroundImagesRemoved
  });
  return result;
}

async function clearDesktopSavedSession() {
  const result = clearSavedBrowserSession(config);
  logger.info("Cleared saved Kindroid session.", { path: result.path, removed: result.removed });
  sendRendererEvent("session-updated", await getDesktopStatus());
  return {
    ...result,
    report: profileDataReport(config, desktopUserDataDir, desktopConfigPath)
  };
}

function clearDesktopCache() {
  const result = clearElectronCaches(desktopUserDataDir);
  logger.info("Cleared Electron caches.", { removedBytes: result.removedBytes, removedFiles: result.removedFiles });
  return {
    ...result,
    report: profileDataReport(config, desktopUserDataDir, desktopConfigPath)
  };
}

function setCaptureVaultEnabled(enabled: boolean): CaptureVaultActionResult {
  const result = requireCaptureVault().setEnabled(enabled);
  logger.info("Updated captured Kin history vault preference.", {
    enabled: result.status.enabled,
    available: result.status.available
  });
  return result;
}

function unlockCaptureVault(): CaptureVaultActionResult {
  const result = requireCaptureVault().unlock();
  logger.info("Unlocked captured Kin history vault.", {
    changed: result.changed,
    captureDir: result.status.captureDir
  });
  return result;
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

function requireTimelineStore(): TimelineStore {
  if (!timelineStore) {
    timelineStore = TimelineStore.fromConfig(config);
  }
  return timelineStore;
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

  const storageState = (await loginSession.context.storageState({ indexedDB: true })) as BrowserStorageState;
  encryptedBrowserSessionStorage?.save(config.bridge.sessionDir, storageState);
  await closeLoginSession();
  await requireRuntime().refreshKins();
  await requireRuntime().refreshGroups();
  sendRendererEvent("session-updated", await getDesktopStatus());
  return { ok: true, path: encryptedBrowserSessionStorage?.storageStatePath(config.bridge.sessionDir) };
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

function getScreenContextSettings() {
  return {
    ok: true,
    settings: readScreenContextSettings(),
    shortcutRegistered: Boolean(registeredScreenContextShortcut),
    registeredShortcut: registeredScreenContextShortcut,
    shortcutRegistrationError: screenContextShortcutRegistrationError
  };
}

function saveScreenContextSettings(input: ScreenContextSettingsInput) {
  const settings = readScreenContextSettings();
  if (input.globalShortcut !== undefined) {
    settings.globalShortcut = normalizeShortcut(input.globalShortcut);
  }
  if (input.autoSendSafe !== undefined) {
    settings.autoSendSafe = Boolean(input.autoSendSafe);
  }
  if (input.detailLevel !== undefined) {
    settings.detailLevel = screenContextDetailLevel(input.detailLevel, settings.detailLevel);
  }
  if (input.privacyAccepted !== undefined) {
    settings.privacyAccepted = Boolean(input.privacyAccepted);
  }
  fs.writeFileSync(screenContextSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  registerScreenContextShortcut(settings.globalShortcut);
  logger.info("Saved screen context settings.", {
    globalShortcutConfigured: Boolean(settings.globalShortcut),
    shortcutRegistered: Boolean(registeredScreenContextShortcut),
    shortcutRegistrationError: screenContextShortcutRegistrationError,
    autoSendSafe: settings.autoSendSafe,
    detailLevel: settings.detailLevel,
    privacyAccepted: settings.privacyAccepted
  });
  return getScreenContextSettings();
}

async function analyzeScreenContextFromShortcut(trigger: "tray" | "shortcut"): Promise<void> {
  const wasVisible = Boolean(mainWindow?.isVisible());
  const kinId = resolveCurrentScreenContextKinId();
  logger.info("Screen context trigger requested.", {
    trigger,
    windowVisible: wasVisible,
    kinIdResolved: Boolean(kinId)
  });
  if (!kinId) {
    const error = "Select or start a Kin before analyzing the screen.";
    if (wasVisible) {
      sendRendererEvent("screen-context-error", { error });
    } else {
      showScreenContextNotification({ title: "Screen context unavailable", body: error });
    }
    return;
  }

  try {
    const result = await analyzeScreenContextForKin(kinId, trigger);
    if (wasVisible) {
      sendRendererEvent("screen-context-review-created", result);
    } else {
      showScreenContextResultNotification(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wasVisible) {
      sendRendererEvent("screen-context-error", { error: message });
    } else {
      showScreenContextNotification({ title: "Screen context failed", body: message });
    }
  }
}

function resolveCurrentScreenContextKinId(): string | null {
  try {
    const status = requireRuntime().status();
    const selectedKin = selectedScreenContextKinId
      ? status.kins.find((kin) => kin.aiId === selectedScreenContextKinId)
      : null;
    if (selectedKin) {
      return selectedKin.aiId;
    }

    const runningSubscriptions = status.subscriptions.filter((subscription) => subscription.running);
    const currentRunning = runningSubscriptions.find((subscription) => subscription.kin.current);
    const fallbackKin = currentRunning?.kin ?? runningSubscriptions[0]?.kin ?? null;
    selectedScreenContextKinId = fallbackKin?.aiId ?? null;
    return selectedScreenContextKinId;
  } catch {
    return selectedScreenContextKinId;
  }
}

async function analyzeScreenContextForKin(
  kinId: string,
  trigger: "button" | "tray" | "shortcut"
): Promise<ScreenContextAnalyzeResult> {
  if (!kinId) {
    throw new Error("Select a Kin before analyzing the screen.");
  }

  const kin = requireRuntime()
    .status()
    .kins.find((item) => item.aiId === kinId);
  if (!kin) {
    throw new Error("Selected Kin is not available.");
  }
  selectedScreenContextKinId = kinId;

  const settings = readScreenContextSettings();
  if (!settings.privacyAccepted) {
    throw new Error("Acknowledge Screen Context privacy before analyzing the screen.");
  }
  const captured = await captureCurrentDisplayPng();
  try {
    const analysis = await analyzeScreenContextWithHermes(config, logger, {
      kinId,
      kinName: kin.name,
      imageMimeType: "image/png",
      imageBase64: captured.buffer.toString("base64"),
      capture: captured.capture,
      detailLevel: settings.detailLevel
    });
    const review: ScreenContextReview = {
      id: randomUUID(),
      kinId,
      kinName: kin.name || kinId,
      detailLevel: settings.detailLevel,
      capture: captured.capture,
      analysis,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    screenContextReviews.set(review.id, review);
    logger.info("Created screen context review.", {
      reviewId: review.id,
      kinId,
      trigger,
      displayId: captured.capture.displayId,
      width: captured.capture.width,
      height: captured.capture.height,
      sensitivityFlags: analysis.sensitivityFlags
    });
    const autoSendBlockedReason = screenContextAutoSendBlockedReason(settings, analysis);
    if (!autoSendBlockedReason) {
      const pendingSummary = toScreenContextReviewSummary(review);
      try {
        const sent = await sendScreenContextReview(review.id);
        return {
          ok: sent.ok,
          review: { ...pendingSummary, status: "sent" },
          autoSent: true,
          sendResult: sent.result
        };
      } catch (error) {
        logger.warn("Automatic screen context send failed; keeping review pending.", {
          reviewId: review.id,
          kinId,
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          ok: true,
          review: pendingSummary,
          autoSent: false,
          autoSendError: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return {
      ok: true,
      review: toScreenContextReviewSummary(review),
      ...(settings.autoSendSafe && autoSendBlockedReason ? { autoSendBlockedReason } : {})
    };
  } finally {
    captured.buffer.fill(0);
  }
}

async function sendScreenContextReview(id: string) {
  const review = screenContextReviews.get(id);
  if (!review || review.status !== "pending") {
    throw new Error("Screen context review is no longer pending.");
  }

  const result = await requireRuntime().sendReviewedAmbientContext({
    kinId: review.kinId,
    ambientMessage: review.analysis.ambientMessage,
    fallbackAmbientMessage: "A low tone sounds.",
    context: screenContextHiddenContext(review.analysis),
    suggestedUse: review.analysis.suggestedUse,
    tone: review.analysis.tone,
    source: "screen_context",
    reason: "user-reviewed desktop screenshot analysis"
  });
  review.status = "sent";
  screenContextReviews.delete(id);
  logger.info("Sent screen context review.", {
    reviewId: id,
    kinId: review.kinId,
    ok: result.ok,
    status: result.status,
    requestId: result.requestId,
    idempotencyKey: result.idempotencyKey
  });
  return { ok: result.ok, result };
}

function discardScreenContextReview(id: string) {
  const review = screenContextReviews.get(id);
  if (review) {
    review.status = "discarded";
    screenContextReviews.delete(id);
  }
  return { ok: true };
}

async function captureCurrentDisplayPng(): Promise<{ buffer: Buffer; capture: ScreenContextCaptureMetadata }> {
  const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const captureSize = screenContextThumbnailSize(
    targetDisplay.bounds.width,
    targetDisplay.bounds.height,
    targetDisplay.scaleFactor
  );
  const wasVisible = Boolean(mainWindow?.isVisible());
  if (wasVisible) {
    mainWindow?.hide();
    await delay(300);
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: captureSize,
      fetchWindowIcons: false
    });
    const source =
      sources.find((item) => item.display_id === String(targetDisplay.id)) ??
      sources.find((item) => item.name === targetDisplay.label) ??
      sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Desktop screenshot capture returned an empty image.");
    }

    const size = source.thumbnail.getSize();
    return {
      buffer: source.thumbnail.toPNG(),
      capture: {
        mode: "screen",
        displayId: source.display_id || String(targetDisplay.id),
        displayName: source.name || targetDisplay.label,
        width: size.width,
        height: size.height,
        capturedAt: new Date().toISOString()
      }
    };
  } finally {
    if (wasVisible) {
      restoreMainWindowWithoutFocus();
      await delay(100);
    }
  }
}

function screenContextThumbnailSize(
  width: number,
  height: number,
  scaleFactor: number
): { width: number; height: number } {
  const maxEdge = 1_600;
  const pixelWidth = Math.max(1, Math.round(width * scaleFactor));
  const pixelHeight = Math.max(1, Math.round(height * scaleFactor));
  const scale = Math.min(1, maxEdge / Math.max(pixelWidth, pixelHeight));
  return {
    width: Math.max(1, Math.round(pixelWidth * scale)),
    height: Math.max(1, Math.round(pixelHeight * scale))
  };
}

function toScreenContextReviewSummary(review: ScreenContextReview) {
  return {
    id: review.id,
    kinId: review.kinId,
    kinName: review.kinName,
    detailLevel: review.detailLevel,
    capture: review.capture,
    analysis: review.analysis,
    status: review.status,
    createdAt: review.createdAt
  };
}

function readScreenContextSettings(): ScreenContextSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(screenContextSettingsPath(), "utf8")) as Partial<ScreenContextSettings>;
    return normalizeScreenContextSettings(parsed);
  } catch {
    return normalizeScreenContextSettings({});
  }
}

function normalizeScreenContextSettings(
  input: Partial<ScreenContextSettings> & { kinPreferences?: unknown }
): ScreenContextSettings {
  const legacyPreference = firstLegacyScreenContextPreference(input.kinPreferences);
  return {
    globalShortcut: normalizeShortcut(input.globalShortcut ?? ""),
    autoSendSafe:
      typeof input.autoSendSafe === "boolean" ? input.autoSendSafe : Boolean(legacyPreference?.autoSendSafe ?? false),
    detailLevel: screenContextDetailLevel(
      input.detailLevel,
      screenContextDetailLevel(legacyPreference?.detailLevel, "detailed")
    ),
    privacyAccepted: input.privacyAccepted === true
  };
}

function firstLegacyScreenContextPreference(value: unknown): { autoSendSafe?: unknown; detailLevel?: unknown } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const preferences = Object.values(value as Record<string, unknown>).filter(
    (item): item is { autoSendSafe?: unknown; detailLevel?: unknown } => Boolean(item && typeof item === "object")
  );
  return (
    preferences.find((preference) => preference.autoSendSafe === true) ??
    preferences.find((preference) => preference.detailLevel !== undefined) ??
    preferences[0] ??
    null
  );
}

function screenContextDetailLevel(value: unknown, fallback: ScreenContextDetailLevel): ScreenContextDetailLevel {
  return value === "brief" || value === "detailed" || value === "text-heavy" ? value : fallback;
}

function screenContextAutoSendBlockedReason(
  settings: ScreenContextSettings,
  analysis: ScreenContextAnalysisResult
): string | null {
  if (!settings.autoSendSafe) {
    return "Auto-send is off.";
  }
  if (settings.detailLevel === "text-heavy") {
    return "Text-heavy screen context requires review.";
  }
  if (analysis.sensitivityFlags.length > 0) {
    return `Sensitive content flagged: ${analysis.sensitivityFlags.join(", ")}.`;
  }
  return null;
}

function screenContextHiddenContext(analysis: ScreenContextAnalysisResult): string {
  const parts = [analysis.context.trim()];
  if (analysis.visibleText?.trim()) {
    parts.push(`Visible text extracted from the screenshot:\n${analysis.visibleText.trim()}`);
  }
  return parts.join("\n\n");
}

function registerScreenContextShortcut(accelerator: string): void {
  unregisterScreenContextShortcut();
  const normalized = normalizeShortcut(accelerator);
  screenContextShortcutRegistrationError = null;
  if (!normalized) {
    return;
  }
  const registered = globalShortcut.register(normalized, () => {
    void analyzeScreenContextFromShortcut("shortcut");
  });
  if (!registered) {
    screenContextShortcutRegistrationError = `Could not register shortcut: ${normalized}`;
    logger?.warn("Screen context global shortcut could not be registered.", { accelerator: normalized });
    return;
  }
  registeredScreenContextShortcut = normalized;
  logger.info("Screen context global shortcut registered.", { accelerator: normalized });
}

function unregisterScreenContextShortcut(): void {
  if (registeredScreenContextShortcut) {
    globalShortcut.unregister(registeredScreenContextShortcut);
    registeredScreenContextShortcut = null;
  }
}

function normalizeShortcut(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split("+")
    .map((part) => normalizeShortcutPart(part.trim()))
    .filter(Boolean)
    .join("+");
}

function normalizeShortcutPart(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "ctrl" || normalized === "control") {
    return "Control";
  }
  if (normalized === "cmdorctrl" || normalized === "commandorcontrol" || normalized === "commandcontrol") {
    return "CommandOrControl";
  }
  if (normalized === "cmd" || normalized === "command" || normalized === "meta" || normalized === "super") {
    return "Command";
  }
  if (normalized === "alt" || normalized === "option") {
    return "Alt";
  }
  if (normalized === "shift") {
    return "Shift";
  }
  if (normalized === "win" || normalized === "windows") {
    return "Super";
  }
  return value.length === 1 ? value.toUpperCase() : value;
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

interface StorybookDesktopRequest {
  kinId?: string;
  groupId?: string;
  fromDate?: string;
  toDate?: string;
  organizationMode?: StorybookOptions["organizationMode"];
  length?: StorybookOptions["length"];
  style?: string;
  quoteMode?: StorybookOptions["quoteMode"];
}

async function generateStorybookPreview(input: StorybookDesktopRequest) {
  const target = storybookTarget(input);
  const status = requireRuntime().status();
  const displayName =
    target.scope === "group"
      ? status.groupSubscriptions.find((subscription) => subscription.group.groupId === target.id)?.group.name ||
        target.id
      : status.subscriptions.find((subscription) => subscription.kin.aiId === target.id)?.kin.name || target.id;
  const speakerNames =
    target.scope === "group"
      ? Object.fromEntries(status.kins.filter((kin) => kin.aiId && kin.name).map((kin) => [kin.aiId, kin.name]))
      : {};
  const jobId = randomUUID();
  const progress = (payload: StorybookProgress) => {
    sendRendererEvent("storybook-export-progress", { jobId, ...payload });
  };

  progress({ stage: "chunking", processed: 0, message: "Loading chat history." });
  const transcript = await loadStorybookTranscriptFromKindroidChat(config, logger, {
    scope: target.scope,
    id: target.id,
    displayName,
    speakerNames,
    fromDate: input.fromDate,
    toDate: input.toDate
  });
  if (transcript.messages.length === 0) {
    throw new Error("No readable chat entries found for the selected source and date range.");
  }

  return createStorybookPreviewJob({
    transcript,
    input,
    jobId,
    progress
  });
}

async function generateImportedStorybookPreview(input: StorybookDesktopRequest) {
  const openOptions = {
    title: "Import transcript",
    properties: ["openFile"] as Array<"openFile">,
    filters: [
      { name: "Transcript files", extensions: ["md", "txt"] },
      { name: "Markdown", extensions: ["md"] },
      { name: "Text", extensions: ["txt"] }
    ]
  };
  const openResult = mainWindow
    ? await dialog.showOpenDialog(mainWindow, openOptions)
    : await dialog.showOpenDialog(openOptions);
  if (openResult.canceled || !openResult.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  const filePath = openResult.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error("Imported transcript is too large. Use a file under 5 MB.");
  }

  const jobId = randomUUID();
  const progress = (payload: StorybookProgress) => {
    sendRendererEvent("storybook-export-progress", { jobId, ...payload });
  };
  progress({ stage: "chunking", processed: 0, message: "Reading imported transcript." });
  const imported = parseImportedStorybookTranscript(fs.readFileSync(filePath, "utf8"), {
    fileName: path.basename(filePath)
  });
  progress({
    stage: "chunking",
    processed: imported.transcript.messages.length,
    total: imported.transcript.messages.length,
    message: `Imported ${imported.transcript.messages.length} transcript message${
      imported.transcript.messages.length === 1 ? "" : "s"
    }.`
  });

  return createStorybookPreviewJob({
    transcript: imported.transcript,
    input,
    jobId,
    progress,
    options: importedStorybookOptions(input),
    parser: {
      format: imported.format,
      confidence: imported.confidence,
      warnings: imported.warnings,
      filePath
    }
  });
}

async function createStorybookPreviewJob(input: {
  transcript: Parameters<typeof createStorybookFromTranscript>[0]["transcript"];
  input: StorybookDesktopRequest;
  jobId: string;
  progress: (payload: StorybookProgress) => void;
  options?: StorybookOptions;
  parser?: {
    format: string;
    confidence: string;
    warnings: string[];
    filePath: string;
  };
}) {
  const document = await createStorybookFromTranscript({
    transcript: input.transcript,
    hermes: new HttpStorybookHermesClient(config),
    options: input.options ?? storybookOptions(input.input),
    onProgress: input.progress
  });
  if (input.parser?.warnings.length) {
    document.warnings.unshift(...input.parser.warnings.map((warning) => `Import parser: ${warning}`));
  }
  const html = renderStorybookHtml(document);
  const jobDir = path.join(storybookTempDir(), input.jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const htmlPath = path.join(jobDir, `${safeArtifactName(document.title)}.html`);
  fs.writeFileSync(htmlPath, html, "utf8");
  storybookJobs.set(input.jobId, { jobId: input.jobId, htmlPath, document });

  const openError = await shell.openPath(htmlPath);
  if (openError) {
    logger.warn("Storybook preview could not be opened.", { jobId: input.jobId, htmlPath, error: openError });
  }

  return {
    ok: true,
    jobId: input.jobId,
    previewPath: htmlPath,
    title: document.title,
    chapterCount: document.chapters.length,
    warningCount: document.warnings.length,
    opened: !openError,
    openError: openError || undefined,
    parserFormat: input.parser?.format,
    parserConfidence: input.parser?.confidence,
    importedMessageCount: input.parser ? input.transcript.messages.length : undefined
  };
}

function storybookOptions(input: StorybookDesktopRequest): StorybookOptions {
  return {
    organizationMode: input.organizationMode,
    length: input.length,
    style: input.style,
    quoteMode: input.quoteMode
  };
}

function importedStorybookOptions(input: StorybookDesktopRequest): StorybookOptions {
  return {
    ...storybookOptions(input),
    chunking: {
      maxMessagesPerChunk: 40,
      maxCharactersPerChunk: 6_000
    }
  };
}

async function saveStorybookPdf(jobId: string) {
  const job = storybookJobs.get(jobId);
  if (!job) {
    throw new Error("Generate a Storybook preview before saving PDF.");
  }

  const saveOptions = {
    title: "Save storybook PDF",
    defaultPath: `${safeArtifactName(job.document.title)}-${timestampArtifactSuffix(new Date())}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  };
  const saveResult = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (saveResult.canceled || !saveResult.filePath) {
    return {
      ok: false,
      canceled: true,
      jobId
    };
  }

  try {
    await saveStorybookPdfFile(job.htmlPath, saveResult.filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to save Storybook PDF.", {
      jobId,
      pdfPath: saveResult.filePath,
      error: message
    });
    throw new Error(
      `Could not save Storybook PDF. Close any existing copy of the file or choose a new name. ${message}`,
      { cause: error }
    );
  }
  return {
    ok: true,
    jobId,
    filePath: saveResult.filePath
  };
}

async function saveStorybookPdfFile(htmlPath: string, pdfPath: string): Promise<void> {
  const tempPath = path.join(storybookTempDir(), `${randomUUID()}.pdf`);
  try {
    await renderStorybookPdf(htmlPath, tempPath);
    fs.copyFileSync(tempPath, pdfPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function storybookTarget(input: StorybookDesktopRequest): { scope: "kin" | "group"; id: string } {
  if (input.groupId) {
    return { scope: "group", id: input.groupId };
  }
  if (input.kinId) {
    return { scope: "kin", id: input.kinId };
  }
  throw new Error("Select a Kin or Group before generating a Storybook.");
}

async function renderStorybookPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      }
    });
  } finally {
    await browser.close();
  }
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
  timelineStore?.append({
    type: "browser_bridge.command.queued",
    source: {
      kind: "browser_bridge",
      id: "local-native-host"
    },
    payload: {
      commandId: command.id,
      commandType: command.type,
      reason,
      ...meta
    }
  });
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
  }

  mainWindow?.show();
  mainWindow?.focus();
}

function restoreMainWindowWithoutFocus(): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.showInactive();
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

function storybookTempDir(): string {
  return path.join(app.getPath("temp"), "kinagent-storybooks");
}

function screenContextTempDir(): string {
  return path.join(app.getPath("temp"), "kinagent-screen-context");
}

function screenContextSettingsPath(): string {
  return path.join(desktopUserDataDir, "screen-context.json");
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

function cleanupStorybookTempFiles(): void {
  try {
    storybookJobs.clear();
    fs.rmSync(storybookTempDir(), { recursive: true, force: true });
  } catch (error) {
    logger?.warn("Failed to clean storybook temporary files.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function cleanupScreenContextTempFiles(): void {
  try {
    screenContextReviews.clear();
    fs.rmSync(screenContextTempDir(), { recursive: true, force: true });
  } catch (error) {
    logger?.warn("Failed to clean screen context temporary files.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function safeArtifactName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  return normalized || "storybook";
}

function timestampArtifactSuffix(value: Date): string {
  return value
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function requireCaptureVault(): CaptureHistoryVault {
  if (!captureVault) {
    throw new Error("Captured Kin history vault is not ready.");
  }

  return captureVault;
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

function showScreenContextResultNotification(result: ScreenContextAnalyzeResult): void {
  if (result.autoSent) {
    return;
  }

  if (result.review) {
    const reason = result.autoSendBlockedReason
      ? result.autoSendBlockedReason
      : result.autoSendError
        ? `Auto-send failed: ${result.autoSendError}`
        : "Auto-send is off.";
    showScreenContextNotification({
      title: "Screen context ready for review",
      body: reason,
      onClick: () => {
        showMainWindow();
        sendRendererEvent("screen-context-review-created", result);
      }
    });
    return;
  }

  showScreenContextNotification({
    title: "Screen context ready",
    body: "Screen context analysis completed."
  });
}

function showScreenContextNotification(input: { title: string; body: string; onClick?: () => void }): void {
  if (!Notification.isSupported()) {
    logger.info("Screen context notification skipped because notifications are unsupported.", {
      title: input.title,
      body: input.body
    });
    return;
  }

  const notification = new Notification({
    title: input.title,
    body: input.body,
    icon: desktopIconPath("icon.png")
  });
  if (input.onClick) {
    notification.on("click", input.onClick);
  }
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
