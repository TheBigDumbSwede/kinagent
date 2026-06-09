import type {
  BrowserIntegrationSettings,
  BrowserIntegrationStatus,
  BrowserIntegrationTargetStatus,
  KinagentApi
} from "./rendererTypes.js";

export interface BrowserIntegrationState {
  browserIntegration: BrowserIntegrationStatus | null;
  browserIntegrationLoading: boolean;
  browserIntegrationSaving: boolean;
  browserIntegrationError: string | null;
}

export interface BrowserIntegrationElements {
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  fieldContent: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  voiceForm: HTMLElement;
  groupAudioPanel: HTMLElement;
  groupGamingPanel: HTMLElement;
  kinHermesForm: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  chatExportPanel: HTMLElement;
  appSettingsForm: HTMLElement;
  browserIntegrationPanel: HTMLFormElement;
  timeline: HTMLElement;
  detailStats: HTMLElement;
  browserIntegrationChromeInput: HTMLInputElement;
  browserIntegrationEdgeInput: HTMLInputElement;
  browserIntegrationFirefoxInput: HTMLInputElement;
  browserIntegrationChromiumIdsInput: HTMLInputElement;
  browserIntegrationFirefoxIdsInput: HTMLInputElement;
  browserIntegrationStatusLine: HTMLElement;
  browserIntegrationStatusList: HTMLElement;
  browserIntegrationNoticeButton: HTMLButtonElement;
  browserIntegrationReloadButton: HTMLButtonElement;
  browserIntegrationSaveButton: HTMLButtonElement;
  browserIntegrationRegisterButton: HTMLButtonElement;
  browserIntegrationUnregisterButton: HTMLButtonElement;
  monitorLine: HTMLElement;
}

export interface BrowserIntegrationContext {
  state: BrowserIntegrationState;
  elements: BrowserIntegrationElements;
  api: Pick<
    KinagentApi,
    | "getBrowserIntegrationStatus"
    | "saveBrowserIntegrationSettings"
    | "registerBrowserIntegration"
    | "unregisterBrowserIntegration"
    | "testBrowserIntegrationNotice"
    | "testBrowserIntegrationReload"
  >;
  renderActivity: () => void;
  renderDetailEmpty: (message: string) => void;
  loadBrowserIntegration: () => void | Promise<void>;
}

export function renderBrowserIntegrationTab(context: BrowserIntegrationContext): void {
  const { state, elements, renderDetailEmpty, loadBrowserIntegration } = context;
  if (state.browserIntegrationLoading) {
    renderDetailEmpty("Loading browser integration.");
    return;
  }

  if (state.browserIntegrationError) {
    renderDetailEmpty(state.browserIntegrationError);
    return;
  }

  if (!state.browserIntegration?.ok) {
    void loadBrowserIntegration();
    renderDetailEmpty("Loading browser integration.");
    return;
  }

  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("form-detail-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("app-settings-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.groupGamingPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.browserIntegrationPanel.hidden = false;
  elements.timeline.hidden = true;

  populateBrowserIntegrationPanel(context, state.browserIntegration);
}

export async function saveBrowserIntegration(context: BrowserIntegrationContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  state.browserIntegrationSaving = true;
  state.browserIntegrationError = null;
  elements.browserIntegrationStatusLine.textContent = "Saving browser integration.";

  try {
    state.browserIntegration = await api.saveBrowserIntegrationSettings(readBrowserIntegrationForm(elements));
    elements.monitorLine.textContent = "Browser integration settings saved.";
  } catch (error) {
    state.browserIntegrationError = errorMessage(error);
  } finally {
    state.browserIntegrationSaving = false;
    renderActivity();
  }
}

export async function registerBrowserIntegration(context: BrowserIntegrationContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  state.browserIntegrationSaving = true;
  state.browserIntegrationError = null;
  elements.browserIntegrationStatusLine.textContent = "Registering native messaging host.";

  try {
    state.browserIntegration = await api.registerBrowserIntegration(readBrowserIntegrationForm(elements));
    elements.monitorLine.textContent = "Browser native messaging host registered.";
  } catch (error) {
    state.browserIntegration = await api.getBrowserIntegrationStatus();
    state.browserIntegrationError = null;
    elements.monitorLine.textContent = errorMessage(error);
  } finally {
    state.browserIntegrationSaving = false;
    renderActivity();
  }
}

export async function unregisterBrowserIntegration(context: BrowserIntegrationContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  state.browserIntegrationSaving = true;
  state.browserIntegrationError = null;
  elements.browserIntegrationStatusLine.textContent = "Unregistering native messaging host.";

  try {
    state.browserIntegration = await api.unregisterBrowserIntegration();
    elements.monitorLine.textContent = "Browser native messaging host unregistered.";
  } catch (error) {
    state.browserIntegrationError = errorMessage(error);
  } finally {
    state.browserIntegrationSaving = false;
    renderActivity();
  }
}

function populateBrowserIntegrationPanel(context: BrowserIntegrationContext, status: BrowserIntegrationStatus): void {
  const { state, elements } = context;
  const settings = status.settings;
  elements.browserIntegrationChromeInput.checked = settings.targets.includes("chrome");
  elements.browserIntegrationEdgeInput.checked = settings.targets.includes("edge");
  elements.browserIntegrationFirefoxInput.checked = settings.targets.includes("firefox");
  elements.browserIntegrationChromiumIdsInput.value = settings.chromiumExtensionIds.join(", ");
  elements.browserIntegrationFirefoxIdsInput.value = settings.firefoxExtensionIds.join(", ");

  const targetCount = status.targets.filter((target) => target.registered).length;
  renderStats(elements.detailStats, [
    { label: "Host", value: status.hostExists ? "Ready" : "Missing" },
    { label: "Platform", value: status.platform === "win32" ? "Windows" : status.platform },
    { label: "Registered", value: `${targetCount}/${status.targets.length}` },
    { label: "Host name", value: status.hostName },
    { label: "Extension", value: status.bridge?.connected ? "Connected" : "Not connected" },
    { label: "Queued", value: String(status.bridge?.queuedCommandCount ?? 0) }
  ]);
  renderTargetStatusList(elements.browserIntegrationStatusList, status.targets);

  elements.browserIntegrationNoticeButton.disabled = state.browserIntegrationSaving;
  elements.browserIntegrationReloadButton.disabled = state.browserIntegrationSaving;
  elements.browserIntegrationSaveButton.disabled = state.browserIntegrationSaving;
  elements.browserIntegrationRegisterButton.disabled =
    state.browserIntegrationSaving ||
    status.platform !== "win32" ||
    !status.hostExists ||
    status.validationErrors.length > 0;
  elements.browserIntegrationUnregisterButton.disabled = state.browserIntegrationSaving || status.platform !== "win32";
  elements.browserIntegrationStatusLine.textContent = statusLine(status);
}

function renderTargetStatusList(container: HTMLElement, targets: BrowserIntegrationTargetStatus[]): void {
  container.replaceChildren();
  for (const target of targets) {
    const wrapper = document.createElement("div");
    const label = document.createElement("dt");
    const value = document.createElement("dd");
    label.textContent = targetLabel(target.target);
    value.textContent = targetStatusText(target);
    wrapper.append(label, value);
    container.append(wrapper);
  }
}

function readBrowserIntegrationForm(elements: BrowserIntegrationElements): BrowserIntegrationSettings {
  const targets: BrowserIntegrationSettings["targets"] = [];
  if (elements.browserIntegrationChromeInput.checked) {
    targets.push("chrome" as const);
  }
  if (elements.browserIntegrationEdgeInput.checked) {
    targets.push("edge" as const);
  }
  if (elements.browserIntegrationFirefoxInput.checked) {
    targets.push("firefox" as const);
  }

  return {
    targets,
    chromiumExtensionIds: splitIds(elements.browserIntegrationChromiumIdsInput.value),
    firefoxExtensionIds: splitIds(elements.browserIntegrationFirefoxIdsInput.value)
  };
}

function splitIds(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function statusLine(status: BrowserIntegrationStatus): string {
  if (status.platform !== "win32") {
    return "Native messaging registration is only supported on Windows.";
  }

  if (!status.hostExists) {
    return `Native host missing: ${status.hostPath}`;
  }

  if (status.validationErrors.length > 0) {
    return status.validationErrors[0] ?? "Browser integration settings need attention.";
  }

  const selected = status.targets.filter((target) => target.selected);
  if (selected.length === 0) {
    return "Select at least one browser before registering.";
  }

  const unconfigured = selected.filter((target) => !target.configured);
  if (unconfigured.length > 0) {
    return `Extension ID required for ${unconfigured.map((target) => targetLabel(target.target)).join(", ")}.`;
  }

  const registered = selected.filter((target) => target.registered);
  if (registered.length === selected.length) {
    return "Selected browsers are registered.";
  }

  return "Register writes per-user native messaging entries for the selected browsers.";
}

function targetStatusText(target: BrowserIntegrationTargetStatus): string {
  if (!target.selected) {
    return "Not selected";
  }

  if (!target.configured) {
    return "Needs extension ID";
  }

  if (target.registered) {
    return target.manifestExists ? "Registered" : "Registry points to missing manifest";
  }

  return target.registryValue ? "Registered elsewhere" : "Not registered";
}

function targetLabel(target: BrowserIntegrationTargetStatus["target"]): string {
  if (target === "firefox") {
    return "Firefox";
  }

  return target === "edge" ? "Edge" : "Chrome";
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
