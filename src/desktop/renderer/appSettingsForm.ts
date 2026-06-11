import { providerLabel } from "./formatters.js";
import type {
  AppConfigView,
  AppSettingsFormValue,
  AppSettingsResult,
  KinagentApi,
  ProfileDataActionResult,
  ProfileDataPruneResult,
  ProfileDataReport
} from "./rendererTypes.js";

export interface AppSettingsState {
  appSettings: AppSettingsResult | null;
  appSettingsLoading: boolean;
  appSettingsSaving: boolean;
  appSettingsError: string | null;
}

export interface AppSettingsElements {
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  fieldContent: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  voiceForm: HTMLElement;
  groupAudioPanel: HTMLElement;
  groupBackgroundPanel: HTMLElement;
  groupGamingPanel: HTMLElement;
  kinHermesForm: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  chatExportPanel: HTMLElement;
  appSettingsForm: HTMLElement;
  timeline: HTMLElement;
  detailStats: HTMLElement;
  appSettingsStatusLine: HTMLElement;
  appSettingsSaveButton: HTMLButtonElement;
  settingsPathLine: HTMLElement;
  settingsSecretStorageLine: HTMLElement;
  settingsDataStatusList: HTMLElement;
  settingsOpenProfileButton: HTMLButtonElement;
  settingsPruneDataButton: HTMLButtonElement;
  settingsClearSessionButton: HTMLButtonElement;
  settingsClearCacheButton: HTMLButtonElement;
  settingsKindroidApiKeyInput: HTMLInputElement;
  settingsLogLevelInput: HTMLInputElement | HTMLSelectElement;
  settingsDedupeWindowInput: HTMLInputElement;
  settingsHermesEnabledInput: HTMLInputElement;
  settingsHermesBaseUrlInput: HTMLInputElement;
  settingsHermesAgentIdInput: HTMLInputElement;
  settingsHermesApiKeyInput: HTMLInputElement;
  settingsHermesCurrentSceneEnabledInput: HTMLInputElement;
  settingsHermesCurrentSceneMaxLengthInput: HTMLInputElement;
  settingsHermesJournalEnabledInput: HTMLInputElement;
  settingsHermesJournalBypassInput: HTMLInputElement;
  settingsHermesJournalThrottleInput: HTMLInputElement;
  settingsVoiceEnabledInput: HTMLInputElement;
  settingsVoiceProviderInput: HTMLInputElement | HTMLSelectElement;
  settingsOpenAiApiKeyInput: HTMLInputElement;
  settingsOpenAiModelInput: HTMLInputElement;
  settingsOpenAiVoiceInput: HTMLInputElement;
  settingsOpenAiInstructionsInput: HTMLInputElement | HTMLTextAreaElement;
  settingsElevenLabsApiKeyInput: HTMLInputElement;
  settingsElevenLabsModelInput: HTMLInputElement;
  settingsElevenLabsOutputFormatInput: HTMLInputElement;
  monitorLine: HTMLElement;
}

export interface AppSettingsContext {
  state: AppSettingsState;
  elements: AppSettingsElements;
  api: Pick<
    KinagentApi,
    "saveSettings" | "pruneProfileData" | "clearSavedSession" | "clearCache" | "openProfileFolder"
  >;
  renderActivity: () => void;
  renderDetailEmpty: (message: string) => void;
  loadAppSettings: () => void | Promise<void>;
}

export function renderAppSettingsTab(context: AppSettingsContext): void {
  const { state, elements, renderDetailEmpty, loadAppSettings } = context;
  if (state.appSettingsLoading) {
    renderDetailEmpty("Loading settings.");
    return;
  }

  if (state.appSettingsError) {
    renderDetailEmpty(state.appSettingsError);
    return;
  }

  if (!state.appSettings?.ok) {
    void loadAppSettings();
    renderDetailEmpty("Loading settings.");
    return;
  }

  const config = state.appSettings.config || {};
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("form-detail-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("app-settings-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.groupBackgroundPanel.hidden = true;
  elements.groupGamingPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.appSettingsForm.hidden = false;
  elements.timeline.hidden = true;

  renderStats(elements.detailStats, [
    { label: "Config", value: state.appSettings.configPath || "Unavailable" },
    { label: "Data", value: state.appSettings.userDataDir || "Unavailable" },
    { label: "Hermes", value: config.hermes?.enabled ? "Enabled" : "Off" },
    { label: "Voice", value: config.voice?.enabled ? providerLabel(config.voice?.provider) : "Off" }
  ]);

  populateAppSettingsForm(context, config);
  wireDataButtons(context);
}

export async function saveAppSettings(context: AppSettingsContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  state.appSettingsSaving = true;
  state.appSettingsError = null;
  elements.appSettingsStatusLine.textContent = "Saving settings.";
  elements.appSettingsSaveButton.disabled = true;

  try {
    state.appSettings = await api.saveSettings(readAppSettingsForm(elements));
    elements.monitorLine.textContent = "Settings saved.";
  } catch (error) {
    state.appSettingsError = errorMessage(error);
  } finally {
    state.appSettingsSaving = false;
    renderActivity();
  }
}

function populateAppSettingsForm(context: AppSettingsContext, config: AppConfigView): void {
  const { state, elements } = context;
  const bridge = config.bridge || {};
  const kindroid = config.kindroid || {};
  const hermes = config.hermes || {};
  const currentScene = hermes.currentSceneUpdates || {};
  const journal = hermes.journalSuggestions || {};
  const voice = config.voice || {};
  const openai = voice.openai || {};
  const elevenlabs = voice.elevenlabs || {};

  elements.settingsLogLevelInput.value = bridge.logLevel || "info";
  elements.settingsDedupeWindowInput.value = String(bridge.dedupeWindowSeconds || 180);
  elements.settingsPathLine.textContent = state.appSettings?.configPath || "";
  renderProfileData(context);
  elements.settingsKindroidApiKeyInput.value = kindroid.apiKey || "";

  elements.settingsHermesEnabledInput.checked = Boolean(hermes.enabled);
  elements.settingsHermesBaseUrlInput.value = hermes.baseUrl || "";
  elements.settingsHermesAgentIdInput.value = hermes.agentId || "";
  elements.settingsHermesApiKeyInput.value = hermes.apiKey || "";
  elements.settingsHermesCurrentSceneEnabledInput.checked = Boolean(currentScene.enabled);
  elements.settingsHermesCurrentSceneMaxLengthInput.value = String(currentScene.maxLength || 160);
  elements.settingsHermesJournalEnabledInput.checked = Boolean(journal.enabled);
  elements.settingsHermesJournalBypassInput.checked = Boolean(journal.strongEventBypass);
  elements.settingsHermesJournalThrottleInput.value = String(journal.throttleMessages || 20);

  elements.settingsVoiceEnabledInput.checked = Boolean(voice.enabled);
  elements.settingsVoiceProviderInput.value = voice.provider || "none";
  elements.settingsOpenAiApiKeyInput.value = openai.apiKey || "";
  elements.settingsOpenAiModelInput.value = openai.model || "";
  elements.settingsOpenAiVoiceInput.value = openai.voice || "";
  elements.settingsOpenAiInstructionsInput.value = openai.instructions || "";
  elements.settingsElevenLabsApiKeyInput.value = elevenlabs.apiKey || "";
  elements.settingsElevenLabsModelInput.value = elevenlabs.model || "";
  elements.settingsElevenLabsOutputFormatInput.value = elevenlabs.outputFormat || "";

  elements.appSettingsSaveButton.disabled = state.appSettingsSaving;
  if (state.appSettings?.saved) {
    elements.appSettingsStatusLine.textContent = "Saved. Restart Kinagent for running services to use these settings.";
  } else {
    elements.appSettingsStatusLine.textContent = "Changes are written to the desktop config file.";
  }
}

function wireDataButtons(context: AppSettingsContext): void {
  const { elements } = context;
  elements.settingsOpenProfileButton.onclick = () => {
    void openProfileFolder(context);
  };
  elements.settingsPruneDataButton.onclick = () => {
    void pruneProfileData(context);
  };
  elements.settingsClearSessionButton.onclick = () => {
    void clearSavedSession(context);
  };
  elements.settingsClearCacheButton.onclick = () => {
    void clearCache(context);
  };
}

function renderProfileData(context: AppSettingsContext): void {
  const { state, elements } = context;
  const report = state.appSettings?.dataReport;
  const secureSecrets = state.appSettings?.secureSecrets;
  const browserSession = state.appSettings?.browserSessionEncryption;
  const apiKeyStatus = secureSecrets?.available
    ? `API keys are stored with OS account encryption. ${secureSecrets.storedKeys.length} secret fields are in secure storage.`
    : "OS secure storage is unavailable; API keys remain in the desktop config file.";
  const sessionStatus = browserSession?.available
    ? browserSession.encrypted
      ? "Saved Kindroid session is encrypted at rest."
      : "Saved Kindroid session will be encrypted the next time it is saved."
    : "Saved Kindroid session uses plaintext storage because OS secure storage is unavailable.";
  elements.settingsSecretStorageLine.textContent = `${apiKeyStatus} ${sessionStatus}`;
  elements.settingsDataStatusList.replaceChildren();
  if (!report) {
    appendDataStatus(elements.settingsDataStatusList, "Profile", "Unavailable");
    return;
  }

  appendDataStatus(
    elements.settingsDataStatusList,
    "Profile total",
    `${formatBytes(report.totalBytes)} across ${report.totalFiles} files`
  );
  for (const category of report.categories) {
    appendDataStatus(
      elements.settingsDataStatusList,
      category.label,
      category.exists ? `${formatBytes(category.bytes)} across ${category.files} files` : "Not present"
    );
  }
}

async function pruneProfileData(context: AppSettingsContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  elements.appSettingsStatusLine.textContent = "Pruning profile history.";
  try {
    const result = (await api.pruneProfileData()) as ProfileDataPruneResult;
    updateProfileReport(state.appSettings, result.report);
    elements.appSettingsStatusLine.textContent =
      `Pruned ${result.journalSuggestionsRemoved ?? 0} journal, ` +
      `${result.groupBackgroundSuggestionsRemoved ?? 0} background, ` +
      `${result.chatDynamismSuggestionsRemoved ?? 0} dynamism items; ` +
      `${result.orphanedGroupBackgroundImagesRemoved ?? 0} orphaned images removed.`;
  } catch (error) {
    state.appSettingsError = errorMessage(error);
  } finally {
    renderActivity();
  }
}

async function clearSavedSession(context: AppSettingsContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!window.confirm("Clear the saved Kindroid login session from this profile?")) {
    return;
  }

  elements.appSettingsStatusLine.textContent = "Clearing saved session.";
  try {
    const result = (await api.clearSavedSession()) as ProfileDataActionResult;
    updateProfileReport(state.appSettings, result.report);
    elements.appSettingsStatusLine.textContent = result.removed
      ? "Saved Kindroid session cleared."
      : "No saved Kindroid session was present.";
  } catch (error) {
    state.appSettingsError = errorMessage(error);
  } finally {
    renderActivity();
  }
}

async function clearCache(context: AppSettingsContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!window.confirm("Clear Electron cache files from this profile?")) {
    return;
  }

  elements.appSettingsStatusLine.textContent = "Clearing cache files.";
  try {
    const result = (await api.clearCache()) as ProfileDataActionResult;
    updateProfileReport(state.appSettings, result.report);
    elements.appSettingsStatusLine.textContent = `Cleared ${formatBytes(result.removedBytes ?? 0)} across ${result.removedFiles ?? 0} cache files.`;
  } catch (error) {
    state.appSettingsError = errorMessage(error);
  } finally {
    renderActivity();
  }
}

async function openProfileFolder(context: AppSettingsContext): Promise<void> {
  const { elements, api } = context;
  const result = await api.openProfileFolder();
  elements.appSettingsStatusLine.textContent = result
    ? `Profile folder open failed: ${result}`
    : "Profile folder opened.";
}

function updateProfileReport(settings: AppSettingsResult | null, report: ProfileDataReport | undefined): void {
  if (settings && report) {
    settings.dataReport = report;
  }
}

function appendDataStatus(container: HTMLElement, labelText: string, valueText: string): void {
  const row = document.createElement("div");
  const label = document.createElement("dt");
  label.textContent = labelText;
  const value = document.createElement("dd");
  value.textContent = valueText;
  row.append(label, value);
  container.append(row);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function readAppSettingsForm(elements: AppSettingsElements): AppSettingsFormValue {
  return {
    kindroidApiKey: elements.settingsKindroidApiKeyInput.value,
    logLevel: elements.settingsLogLevelInput.value,
    dedupeWindowSeconds: numberInputValue(elements.settingsDedupeWindowInput),
    hermesEnabled: elements.settingsHermesEnabledInput.checked,
    hermesBaseUrl: elements.settingsHermesBaseUrlInput.value,
    hermesAgentId: elements.settingsHermesAgentIdInput.value,
    hermesApiKey: elements.settingsHermesApiKeyInput.value,
    hermesCurrentSceneEnabled: elements.settingsHermesCurrentSceneEnabledInput.checked,
    hermesCurrentSceneMaxLength: numberInputValue(elements.settingsHermesCurrentSceneMaxLengthInput),
    hermesJournalSuggestionsEnabled: elements.settingsHermesJournalEnabledInput.checked,
    hermesJournalStrongEventBypass: elements.settingsHermesJournalBypassInput.checked,
    hermesJournalThrottleMessages: numberInputValue(elements.settingsHermesJournalThrottleInput),
    voiceEnabled: elements.settingsVoiceEnabledInput.checked,
    voiceProvider: elements.settingsVoiceProviderInput.value,
    openAiApiKey: elements.settingsOpenAiApiKeyInput.value,
    openAiModel: elements.settingsOpenAiModelInput.value,
    openAiVoice: elements.settingsOpenAiVoiceInput.value,
    openAiInstructions: elements.settingsOpenAiInstructionsInput.value,
    elevenLabsApiKey: elements.settingsElevenLabsApiKeyInput.value,
    elevenLabsModel: elements.settingsElevenLabsModelInput.value,
    elevenLabsOutputFormat: elements.settingsElevenLabsOutputFormatInput.value
  };
}

function numberInputValue(input: HTMLInputElement): number {
  return Number(input.value);
}

function renderStats(container: HTMLElement, stats: Array<{ label: string; value: string }>): void {
  container.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    container.append(item);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
