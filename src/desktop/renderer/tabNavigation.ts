const settingTabKeys = new Set(["backstory", "directive", "memory", "example", "scene", "background", "profile"]);
const kinModes = ["settings", "journal", "hermes", "voice", "analyze", "export"];
const directModes = ["journal", "hermes", "voice", "analyze", "export"];

export interface TabNavigationState {
  activeTab: string;
  selectedKinId: string | null;
  selectedGroupId: string | null;
  selectedHistoryHash: string | null;
  appSettings: unknown | null;
  appSettingsLoading: boolean;
  selectedKinVoice: unknown | null;
  voiceLoading: boolean;
  selectedKinAmbient: unknown | null;
  ambientLoading: boolean;
}

export interface TabNavigationElements {
  detailTabs: HTMLElement;
  kinDetailTabs: HTMLElement;
  settingTabs: HTMLElement;
  monitorPane: HTMLElement;
  detailPane: HTMLElement;
  clearButton: HTMLElement;
}

export interface TabNavigationContext {
  state: TabNavigationState;
  elements: TabNavigationElements;
  loadAppSettings: () => void;
  loadKinVoice: (kinId: string) => void;
  loadKinAmbient: (kinId: string) => void;
  renderActivity: () => void;
}

export function handleDetailTabsClick(context: TabNavigationContext, event: Event): void {
  const mode = clickedDatasetValue(event, "mode");
  if (!mode) {
    return;
  }

  setActiveTab(context, tabForMode(context.state, mode));
  loadActiveTabDependencies(context, { allowAppSettings: true });
  context.renderActivity();
}

export function handleKinDetailTabsClick(context: TabNavigationContext, event: Event): void {
  const mode = clickedDatasetValue(event, "mode");
  if (!mode) {
    return;
  }

  setActiveTab(context, tabForMode(context.state, mode));
  loadActiveTabDependencies(context, { allowAppSettings: false });
  context.renderActivity();
}

export function handleSettingTabsClick(context: TabNavigationContext, event: Event): void {
  const setting = clickedDatasetValue(event, "setting");
  if (!setting || !settingTabKeys.has(setting)) {
    return;
  }

  setActiveTab(context, setting);
  context.renderActivity();
}

export function renderTabNavigation(
  context: Pick<TabNavigationContext, "state" | "elements">,
  activeMode: string
): void {
  const { state, elements } = context;
  for (const button of elements.detailTabs.querySelectorAll<HTMLElement>("[data-mode]")) {
    if (button.dataset.mode === "settings") {
      button.hidden = Boolean(state.selectedGroupId);
    } else if (button.dataset.mode === "export") {
      button.hidden = !state.selectedGroupId;
    } else {
      button.hidden = false;
    }
    const selected =
      button.dataset.mode === activeMode || (button.dataset.mode === "settings" && isKinMode(activeMode));
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.kinDetailTabs.hidden = Boolean(state.selectedGroupId || !state.selectedKinId || !isKinMode(activeMode));
  for (const button of elements.kinDetailTabs.querySelectorAll<HTMLElement>("[data-mode]")) {
    const selected = button.dataset.mode === activeMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.settingTabs.hidden = Boolean(state.selectedGroupId || activeMode !== "settings");
  for (const button of elements.settingTabs.querySelectorAll<HTMLElement>("[data-setting]")) {
    const selected = button.dataset.setting === currentSettingTab(state);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  const isMonitor = activeMode === "monitor";
  elements.monitorPane.hidden = !isMonitor;
  elements.detailPane.hidden = isMonitor;
  elements.clearButton.hidden = !isMonitor;
}

export function tabLabelFor(context: Pick<TabNavigationContext, "state" | "elements">, tab: string): string {
  if (tab === "journal") {
    return "Journal";
  }

  if (tab === "hermes") {
    return "Hermes";
  }

  if (tab === "voice") {
    return "Audio";
  }

  if (tab === "analyze") {
    return "Analyze";
  }

  if (tab === "export") {
    return "Export";
  }

  const settingButton = context.elements.settingTabs.querySelector(`[data-setting="${tab}"]`);
  if (settingButton) {
    return settingButton.textContent?.trim() || "Detail";
  }

  const modeButton = context.elements.detailTabs.querySelector(`[data-mode="${modeForTab(tab)}"]`);
  return modeButton?.textContent?.trim() || "Detail";
}

export function tabForMode(state: TabNavigationState, mode: string | undefined): string {
  if (mode === "app-settings") {
    return "app-settings";
  }

  if (mode === "settings") {
    return currentSettingTab(state);
  }

  return mode && directModes.includes(mode) ? mode : "monitor";
}

export function modeForTab(tab: string | undefined): string {
  if (tab === "app-settings") {
    return "app-settings";
  }

  if (tab && settingTabKeys.has(tab)) {
    return "settings";
  }

  return tab && directModes.includes(tab) ? tab : "monitor";
}

export function currentSettingTab(state: Pick<TabNavigationState, "activeTab">): string {
  return settingTabKeys.has(state.activeTab) ? state.activeTab : "backstory";
}

export function subtitleForDetailMode(mode: string): string {
  if (mode === "app-settings") {
    return "Application configuration";
  }

  if (mode === "voice") {
    return "Audio configuration";
  }

  if (mode === "hermes") {
    return "Hermes configuration";
  }

  if (mode === "analyze") {
    return "Kin analysis";
  }

  if (mode === "export") {
    return "Chat export";
  }

  if (mode === "journal") {
    return "Captured journal history";
  }

  return "Captured settings history";
}

function setActiveTab(context: TabNavigationContext, nextTab: string): void {
  if (context.state.activeTab !== nextTab) {
    context.state.selectedHistoryHash = null;
  }
  context.state.activeTab = nextTab;
}

function loadActiveTabDependencies(context: TabNavigationContext, options: { allowAppSettings: boolean }): void {
  const { state } = context;
  if (
    options.allowAppSettings &&
    state.activeTab === "app-settings" &&
    !state.appSettings &&
    !state.appSettingsLoading
  ) {
    context.loadAppSettings();
  }
  if (state.activeTab === "voice" && state.selectedKinId && !state.selectedKinVoice && !state.voiceLoading) {
    context.loadKinVoice(state.selectedKinId);
  }
  if (state.activeTab === "hermes" && state.selectedKinId && !state.selectedKinAmbient && !state.ambientLoading) {
    context.loadKinAmbient(state.selectedKinId);
  }
}

function clickedDatasetValue(event: Event, key: string): string | undefined {
  if (!(event.target instanceof Element)) {
    return undefined;
  }

  const button = event.target.closest<HTMLElement>(`[data-${key}]`);
  return button?.dataset[key];
}

function isKinMode(mode: string): boolean {
  return kinModes.includes(mode);
}
