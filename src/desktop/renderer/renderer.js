import { createVoiceAudioPlayer } from "./audioPlayback.js";
import { formatTime, formatTimelineChange, providerLabel } from "./formatters.js";
import { createMessageElement, visibleMonitorMessages as filterVisibleMonitorMessages } from "./monitorMessages.js";
import { createDiffLine, renderSelectedHistoryDiff } from "./timelineDiff.js";

const state = {
  kins: [],
  subscriptions: [],
  groups: [],
  groupSubscriptions: [],
  monitorRunning: false,
  sessionAvailable: false,
  kinRefresh: null,
  groupRefresh: null,
  kinsExpanded: false,
  groupsExpanded: false,
  selectedKinId: null,
  selectedGroupId: null,
  selectedKinCapture: null,
  selectedKinVoice: null,
  selectedKinAmbient: null,
  journalSuggestions: [],
  journalSavingId: null,
  journalError: null,
  captureLoading: false,
  captureError: null,
  voiceLoading: false,
  voiceError: null,
  voiceSaving: false,
  ambientLoading: false,
  ambientError: null,
  ambientSaving: false,
  activeTab: "monitor",
  selectedHistoryHash: null,
  monitorMessages: [],
  appSettings: null,
  appSettingsLoading: false,
  appSettingsSaving: false,
  appSettingsError: null,
  kinAnalysisRunning: false,
  kinAnalysisJobId: null,
  kinAnalysisReport: "",
  chatExportSaving: false,
  chatExportJobId: null
};

const captureRequestTimeoutMs = 12_000;
const maxMonitorMessages = 500;
const loginOnboardingMessage = "Use Open Login, then Save Session to begin.";
const settingTabKeys = new Set(["backstory", "directive", "memory", "example", "scene", "background", "profile"]);
const chatDynamismSlider = {
  hardMin: 0.6,
  hardMax: 1.8,
  practicalMin: 0.8,
  practicalMax: 1.4
};

const elements = {
  sessionLine: document.querySelector("#sessionLine"),
  firebaseStatus: document.querySelector("#firebaseStatus"),
  appCheckStatus: document.querySelector("#appCheckStatus"),
  expiryStatus: document.querySelector("#expiryStatus"),
  kinRefreshLine: document.querySelector("#kinRefreshLine"),
  kinSubscriptionList: document.querySelector("#kinSubscriptionList"),
  groupRefreshLine: document.querySelector("#groupRefreshLine"),
  groupSubscriptionList: document.querySelector("#groupSubscriptionList"),
  activityTitle: document.querySelector("#activityTitle"),
  detailTabs: document.querySelector("#detailTabs"),
  kinDetailTabs: document.querySelector("#kinDetailTabs"),
  settingTabs: document.querySelector("#settingTabs"),
  monitorPane: document.querySelector("#monitorPane"),
  detailPane: document.querySelector("#detailPane"),
  kinDetailEmpty: document.querySelector("#kinDetailEmpty"),
  kinDetailContent: document.querySelector("#kinDetailContent"),
  detailStats: document.querySelector("#detailStats"),
  journalSuggestionPanel: document.querySelector("#journalSuggestionPanel"),
  fieldContent: document.querySelector("#fieldContent"),
  appSettingsForm: document.querySelector("#appSettingsForm"),
  appSettingsStatusLine: document.querySelector("#appSettingsStatusLine"),
  appSettingsSaveButton: document.querySelector("#appSettingsSaveButton"),
  settingsPathLine: document.querySelector("#settingsPathLine"),
  settingsLogLevelInput: document.querySelector("#settingsLogLevelInput"),
  settingsDedupeWindowInput: document.querySelector("#settingsDedupeWindowInput"),
  settingsHermesEnabledInput: document.querySelector("#settingsHermesEnabledInput"),
  settingsHermesBaseUrlInput: document.querySelector("#settingsHermesBaseUrlInput"),
  settingsHermesAgentIdInput: document.querySelector("#settingsHermesAgentIdInput"),
  settingsHermesApiKeyInput: document.querySelector("#settingsHermesApiKeyInput"),
  settingsHermesCurrentSceneEnabledInput: document.querySelector("#settingsHermesCurrentSceneEnabledInput"),
  settingsHermesCurrentSceneMaxLengthInput: document.querySelector("#settingsHermesCurrentSceneMaxLengthInput"),
  settingsHermesJournalEnabledInput: document.querySelector("#settingsHermesJournalEnabledInput"),
  settingsHermesJournalBypassInput: document.querySelector("#settingsHermesJournalBypassInput"),
  settingsHermesJournalThrottleInput: document.querySelector("#settingsHermesJournalThrottleInput"),
  settingsVoiceEnabledInput: document.querySelector("#settingsVoiceEnabledInput"),
  settingsVoiceProviderInput: document.querySelector("#settingsVoiceProviderInput"),
  settingsOpenAiApiKeyInput: document.querySelector("#settingsOpenAiApiKeyInput"),
  settingsOpenAiModelInput: document.querySelector("#settingsOpenAiModelInput"),
  settingsOpenAiVoiceInput: document.querySelector("#settingsOpenAiVoiceInput"),
  settingsOpenAiInstructionsInput: document.querySelector("#settingsOpenAiInstructionsInput"),
  settingsElevenLabsApiKeyInput: document.querySelector("#settingsElevenLabsApiKeyInput"),
  settingsElevenLabsModelInput: document.querySelector("#settingsElevenLabsModelInput"),
  settingsElevenLabsOutputFormatInput: document.querySelector("#settingsElevenLabsOutputFormatInput"),
  voiceForm: document.querySelector("#voiceForm"),
  kinHermesForm: document.querySelector("#kinHermesForm"),
  ambientContextEnabledInput: document.querySelector("#ambientContextEnabledInput"),
  chatDynamismCurrentValue: document.querySelector("#chatDynamismCurrentValue"),
  chatDynamismRangeControl: document.querySelector("#chatDynamismRangeControl"),
  chatDynamismEnabledInput: document.querySelector("#chatDynamismEnabledInput"),
  chatDynamismMinInput: document.querySelector("#chatDynamismMinInput"),
  chatDynamismMaxInput: document.querySelector("#chatDynamismMaxInput"),
  chatDynamismMinValue: document.querySelector("#chatDynamismMinValue"),
  chatDynamismMaxValue: document.querySelector("#chatDynamismMaxValue"),
  kinAnalyzePanel: document.querySelector("#kinAnalyzePanel"),
  kinAnalyzeButton: document.querySelector("#kinAnalyzeButton"),
  kinAnalyzeProgress: document.querySelector("#kinAnalyzeProgress"),
  kinAnalyzeStatusLine: document.querySelector("#kinAnalyzeStatusLine"),
  kinAnalyzeReport: document.querySelector("#kinAnalyzeReport"),
  chatExportPanel: document.querySelector("#chatExportPanel"),
  chatExportTitle: document.querySelector("#chatExportTitle"),
  chatExportDescription: document.querySelector("#chatExportDescription"),
  chatExportFromInput: document.querySelector("#chatExportFromInput"),
  chatExportToInput: document.querySelector("#chatExportToInput"),
  chatExportRangeButton: document.querySelector("#chatExportRangeButton"),
  chatExportAllButton: document.querySelector("#chatExportAllButton"),
  chatExportProgress: document.querySelector("#chatExportProgress"),
  chatExportStatusLine: document.querySelector("#chatExportStatusLine"),
  kinHermesStatusLine: document.querySelector("#kinHermesStatusLine"),
  kinHermesSaveButton: document.querySelector("#kinHermesSaveButton"),
  voiceEnabledInput: document.querySelector("#voiceEnabledInput"),
  filterNarrationInput: document.querySelector("#filterNarrationInput"),
  voiceProviderInput: document.querySelector("#voiceProviderInput"),
  openAiVoiceLabel: document.querySelector("#openAiVoiceLabel"),
  openAiVoiceInput: document.querySelector("#openAiVoiceInput"),
  elevenLabsVoiceLabel: document.querySelector("#elevenLabsVoiceLabel"),
  elevenLabsVoiceInput: document.querySelector("#elevenLabsVoiceInput"),
  narrationDelimiterInput: document.querySelector("#narrationDelimiterInput"),
  openAiInstructionsInput: document.querySelector("#openAiInstructionsInput"),
  voiceStatusLine: document.querySelector("#voiceStatusLine"),
  voiceSaveButton: document.querySelector("#voiceSaveButton"),
  timelineList: document.querySelector("#timelineList"),
  timeline: document.querySelector(".timeline"),
  monitorLine: document.querySelector("#monitorLine"),
  messageList: document.querySelector("#messageList"),
  loginStartButton: document.querySelector("#loginStartButton"),
  loginSaveButton: document.querySelector("#loginSaveButton"),
  openKindroidButton: document.querySelector("#openKindroidButton"),
  toggleKinsButton: document.querySelector("#toggleKinsButton"),
  refreshKinsButton: document.querySelector("#refreshKinsButton"),
  toggleGroupsButton: document.querySelector("#toggleGroupsButton"),
  refreshGroupsButton: document.querySelector("#refreshGroupsButton"),
  clearButton: document.querySelector("#clearButton")
};

const playVoiceAudio = createVoiceAudioPlayer({
  onError(error) {
    elements.monitorLine.textContent = `Voice playback failed: ${error.message || String(error)}`;
  }
});

elements.loginStartButton.addEventListener("click", () =>
  runAction("Opening login", () => window.kinagent.startLogin())
);
elements.loginSaveButton.addEventListener("click", () =>
  runAction("Saving session", async () => {
    await window.kinagent.saveLogin();
    await refreshStatus();
  })
);
elements.openKindroidButton.addEventListener("click", () =>
  runAction("Opening Kindroid", () => window.kinagent.openKindroid())
);
elements.toggleKinsButton.addEventListener("click", () => {
  state.kinsExpanded = !state.kinsExpanded;
  renderKinSubscriptions();
});
elements.refreshKinsButton.addEventListener("click", () =>
  runAction("Refreshing Kins", async () => {
    await window.kinagent.refreshKins();
    await refreshStatus();
  })
);
elements.toggleGroupsButton.addEventListener("click", () => {
  state.groupsExpanded = !state.groupsExpanded;
  renderGroupSubscriptions();
});
elements.refreshGroupsButton.addEventListener("click", () =>
  runAction("Refreshing groups", async () => {
    await window.kinagent.refreshGroups();
    await refreshStatus();
  })
);
elements.clearButton.addEventListener("click", () => {
  clearVisibleMonitorMessages();
});
elements.detailTabs.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-mode]");
  if (!button) {
    return;
  }

  const nextTab = tabForMode(button.dataset.mode);
  if (state.activeTab !== nextTab) {
    state.selectedHistoryHash = null;
  }
  state.activeTab = nextTab;
  if (state.activeTab === "app-settings" && !state.appSettings && !state.appSettingsLoading) {
    void loadAppSettings();
  }
  if (state.activeTab === "voice" && state.selectedKinId && !state.selectedKinVoice && !state.voiceLoading) {
    void loadKinVoice(state.selectedKinId);
  }
  if (state.activeTab === "hermes" && state.selectedKinId && !state.selectedKinAmbient && !state.ambientLoading) {
    void loadKinAmbient(state.selectedKinId);
  }
  renderActivity();
});
elements.kinDetailTabs.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-mode]");
  if (!button) {
    return;
  }

  const nextTab = tabForMode(button.dataset.mode);
  if (state.activeTab !== nextTab) {
    state.selectedHistoryHash = null;
  }
  state.activeTab = nextTab;
  if (state.activeTab === "voice" && state.selectedKinId && !state.selectedKinVoice && !state.voiceLoading) {
    void loadKinVoice(state.selectedKinId);
  }
  if (state.activeTab === "hermes" && state.selectedKinId && !state.selectedKinAmbient && !state.ambientLoading) {
    void loadKinAmbient(state.selectedKinId);
  }
  renderActivity();
});
elements.settingTabs.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-setting]");
  if (!button) {
    return;
  }

  const nextTab = button.dataset.setting;
  if (!settingTabKeys.has(nextTab)) {
    return;
  }

  if (state.activeTab !== nextTab) {
    state.selectedHistoryHash = null;
  }
  state.activeTab = nextTab;
  renderActivity();
});
elements.voiceProviderInput.addEventListener("change", renderVoiceProviderFields);
elements.appSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveAppSettings();
});
elements.voiceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinVoice();
});
elements.kinHermesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinAmbient();
});
elements.chatDynamismMinInput.addEventListener("input", syncChatDynamismRangeLabels);
elements.chatDynamismMaxInput.addEventListener("input", syncChatDynamismRangeLabels);
elements.kinAnalyzeButton.addEventListener("click", () => {
  void analyzeSelectedKin();
});
elements.chatExportRangeButton.addEventListener("click", () => {
  void exportSelectedChat(false);
});
elements.chatExportAllButton.addEventListener("click", () => {
  void exportSelectedChat(true);
});

window.kinagent.onEvent((message) => {
  if (message.channel === "runtime-startup-error") {
    elements.sessionLine.textContent = message.payload?.error || "Runtime startup failed";
    elements.monitorLine.textContent = "Runtime startup failed";
    return;
  }

  if (message.channel === "monitor-line") {
    handleMonitorLine(message.payload);
    return;
  }

  if (message.channel === "voice-audio") {
    void playVoiceAudio(message.payload);
    return;
  }

  if (message.channel === "journal-suggestion-created") {
    upsertJournalSuggestion(message.payload);
    renderJournalSuggestionNotice(message.payload);
    renderActivity();
    return;
  }

  if (message.channel === "journal-suggestions-updated") {
    state.journalSuggestions = message.payload || [];
    renderActivity();
    return;
  }

  if (message.channel === "journal-suggestion-focus") {
    void focusJournalSuggestion(message.payload);
    return;
  }

  if (message.channel === "chat-export-progress") {
    renderChatExportProgress(message.payload);
    return;
  }

  if (message.channel === "kin-analysis-progress") {
    renderKinAnalysisProgress(message.payload);
    return;
  }

  if (message.channel === "monitor-started") {
    markSubscriptionRunning(message.payload?.kinId, true);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-stopped" || message.channel === "monitor-exit") {
    markSubscriptionRunning(message.payload?.kinId, false);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-error") {
    markSubscriptionRunning(message.payload?.kinId, false);
    updateMonitorRunning();
    elements.monitorLine.textContent = message.payload?.error || message.payload || "Monitor error";
    return;
  }

  if (message.channel === "group-monitor-started") {
    markGroupSubscriptionRunning(message.payload?.groupId, true);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "group-monitor-stopped" || message.channel === "group-monitor-exit") {
    markGroupSubscriptionRunning(message.payload?.groupId, false);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "group-monitor-error") {
    markGroupSubscriptionRunning(message.payload?.groupId, false);
    updateMonitorRunning();
    elements.monitorLine.textContent = message.payload?.error || message.payload || "Group monitor error";
    return;
  }

  if (message.channel === "session-updated") {
    renderStatus(message.payload);
    return;
  }

  if (message.channel === "session-keepalive") {
    elements.sessionLine.textContent = message.payload.ok
      ? message.payload.warmed
        ? "Session warmed"
        : "Session refreshed"
      : "Session refresh failed";
    return;
  }

  if (message.channel === "kins-updated") {
    state.subscriptions = message.payload || [];
    state.kins = state.subscriptions.map((subscription) => subscription.kin);
    clearMissingSelectedKin();
    updateMonitorRunning();
    renderKinSubscriptions();
    renderMonitorState();
    renderActivity();
    return;
  }

  if (message.channel === "groups-updated") {
    state.groupSubscriptions = message.payload || [];
    state.groups = state.groupSubscriptions.map((subscription) => subscription.group);
    clearMissingSelectedGroup();
    updateMonitorRunning();
    renderGroupSubscriptions();
    renderMonitorState();
    return;
  }

  if (message.channel === "kins-refresh-error") {
    elements.kinRefreshLine.textContent = refreshErrorLine(message.payload, "Kin refresh failed");
    return;
  }

  if (message.channel === "groups-refresh-error") {
    elements.groupRefreshLine.textContent = refreshErrorLine(message.payload, "Group refresh failed");
  }
});

refreshStatus().catch((error) => {
  elements.sessionLine.textContent = error.message;
});

async function refreshStatus() {
  const status = await window.kinagent.getStatus();
  renderStatus(status);
}

function renderStatus(status) {
  state.kins = status.kins || [];
  state.subscriptions = status.subscriptions || [];
  state.groups = status.groups || [];
  state.groupSubscriptions = status.groupSubscriptions || [];
  state.journalSuggestions = status.journalSuggestions || [];
  state.monitorRunning = Boolean(status.monitorRunning);
  state.sessionAvailable = Boolean(status.session?.available);
  state.kinRefresh = status.kinRefresh || null;
  state.groupRefresh = status.groupRefresh || null;

  elements.sessionLine.textContent = status.session.available ? "Session saved" : "No saved session";
  elements.firebaseStatus.textContent = status.session.hasFirebaseAuth ? "Ready" : "Missing";
  elements.appCheckStatus.textContent = status.appCheckPresent ? "Ready" : "Missing";
  elements.expiryStatus.textContent = status.session.expirationIso || "Unknown";

  clearMissingSelectedKin();
  clearMissingSelectedGroup();
  renderKinSubscriptions();
  renderGroupSubscriptions();
  renderMonitorState();
  renderActivity();
}

function renderKinSubscriptions() {
  elements.kinSubscriptionList.replaceChildren();
  elements.kinSubscriptionList.hidden = !state.kinsExpanded;
  elements.toggleKinsButton.textContent = state.kinsExpanded ? "Hide" : "Manage";
  elements.toggleKinsButton.setAttribute("aria-expanded", String(state.kinsExpanded));

  const totalCount = state.subscriptions.length;
  const enabledCount = state.subscriptions.filter((subscription) => subscription.enabled).length;
  const runningCount = state.subscriptions.filter((subscription) => subscription.running).length;
  const disabledCount = totalCount - enabledCount;

  if (state.kinRefresh && !state.kinRefresh.ok) {
    elements.kinRefreshLine.textContent = refreshErrorLine(state.kinRefresh.error, "Kin refresh failed");
  } else if (totalCount > 0) {
    elements.kinRefreshLine.textContent = [
      `${totalCount} Kins`,
      `${runningCount} live`,
      disabledCount > 0 ? `${disabledCount} off` : null
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    elements.kinRefreshLine.textContent = state.sessionAvailable ? "Waiting for Kin list" : loginOnboardingMessage;
  }

  elements.toggleKinsButton.disabled = state.subscriptions.length === 0;

  if (!state.kinsExpanded) {
    return;
  }

  if (state.subscriptions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No Kins discovered yet";
    elements.kinSubscriptionList.append(empty);
    return;
  }

  for (const subscription of state.subscriptions) {
    const kin = subscription.kin || {};
    const row = document.createElement("div");
    row.className = `kin-row selectable${state.selectedKinId === kin.aiId && !state.selectedGroupId ? " selected" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Manage ${kin.name || kin.aiId || "Kin"}`);
    row.addEventListener("click", () => {
      void selectKin(kin.aiId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void selectKin(kin.aiId);
      }
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(subscription.enabled);
    checkbox.setAttribute("aria-label", `Monitor ${kin.name || kin.aiId || "Kin"}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      runAction(checkbox.checked ? "Enabling Kin" : "Disabling Kin", async () => {
        await window.kinagent.setKinEnabled({ kinId: kin.aiId, enabled: checkbox.checked });
        await refreshStatus();
      });
    });

    const text = document.createElement("span");
    text.className = "kin-name";
    text.textContent = kin.name || kin.aiId || "Kin";

    const status = document.createElement("span");
    status.className = `kin-state ${subscription.running ? "running" : subscription.enabled ? "enabled" : "disabled"}`;
    status.textContent = subscription.running ? "Live" : subscription.enabled ? "Queued" : "Off";

    row.append(checkbox, text, status);
    elements.kinSubscriptionList.append(row);
  }
}

function renderGroupSubscriptions() {
  elements.groupSubscriptionList.replaceChildren();
  elements.groupSubscriptionList.hidden = !state.groupsExpanded;
  elements.toggleGroupsButton.textContent = state.groupsExpanded ? "Hide" : "Manage";
  elements.toggleGroupsButton.setAttribute("aria-expanded", String(state.groupsExpanded));

  const totalCount = state.groupSubscriptions.length;
  const enabledCount = state.groupSubscriptions.filter((subscription) => subscription.enabled).length;
  const runningCount = state.groupSubscriptions.filter((subscription) => subscription.running).length;
  const disabledCount = totalCount - enabledCount;

  if (state.groupRefresh && !state.groupRefresh.ok) {
    elements.groupRefreshLine.textContent = refreshErrorLine(state.groupRefresh.error, "Group refresh failed");
  } else if (totalCount > 0) {
    elements.groupRefreshLine.textContent = [
      `${totalCount} groups`,
      `${runningCount} live`,
      disabledCount > 0 ? `${disabledCount} off` : null
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    elements.groupRefreshLine.textContent = state.sessionAvailable ? "Waiting for group list" : loginOnboardingMessage;
  }

  elements.toggleGroupsButton.disabled = state.groupSubscriptions.length === 0;

  if (!state.groupsExpanded) {
    return;
  }

  if (state.groupSubscriptions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No groups discovered yet";
    elements.groupSubscriptionList.append(empty);
    return;
  }

  for (const subscription of state.groupSubscriptions) {
    const group = subscription.group || {};
    const row = document.createElement("div");
    row.className = `kin-row selectable${state.selectedGroupId === group.groupId ? " selected" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Manage ${group.name || group.groupId || "Group"}`);
    row.addEventListener("click", () => {
      selectGroup(group.groupId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectGroup(group.groupId);
      }
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(subscription.enabled);
    checkbox.setAttribute("aria-label", `Monitor ${group.name || group.groupId || "Group"}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      runAction(checkbox.checked ? "Enabling group" : "Disabling group", async () => {
        await window.kinagent.setGroupEnabled({ groupId: group.groupId, enabled: checkbox.checked });
        await refreshStatus();
      });
    });

    const text = document.createElement("span");
    text.className = "kin-name";
    text.textContent = group.name || group.groupId || "Group";

    const status = document.createElement("span");
    status.className = `kin-state ${subscription.running ? "running" : subscription.enabled ? "enabled" : "disabled"}`;
    status.textContent = subscription.running ? "Live" : subscription.enabled ? "Queued" : "Off";

    row.append(checkbox, text, status);
    elements.groupSubscriptionList.append(row);
  }
}

function refreshErrorLine(error, fallback) {
  if (!state.sessionAvailable || isMissingSessionError(error)) {
    return loginOnboardingMessage;
  }

  return error || fallback;
}

function isMissingSessionError(error) {
  return typeof error === "string" && error.includes("No Kindroid browser session found");
}

function renderMonitorState() {
  if ((state.activeTab || "monitor") !== "monitor") {
    return;
  }

  const selectedGroup = currentSelectedGroup();
  if (selectedGroup) {
    const subscription = state.groupSubscriptions.find((item) => item.group?.groupId === selectedGroup.groupId);
    const visibleCount = visibleMonitorMessages().length;
    elements.monitorLine.textContent = [
      subscription?.running
        ? "Group subscription live"
        : subscription?.enabled
          ? "Group subscription queued"
          : "Group off",
      `${visibleCount} message${visibleCount === 1 ? "" : "s"} shown`
    ].join(" · ");
    return;
  }

  const selectedKin = state.activeTab === "monitor" ? currentSelectedKin() : null;
  if (selectedKin) {
    const subscription = state.subscriptions.find((item) => item.kin?.aiId === selectedKin.aiId);
    const visibleCount = visibleMonitorMessages().length;
    elements.monitorLine.textContent = [
      subscription?.running ? "Kin subscription live" : subscription?.enabled ? "Kin subscription queued" : "Kin off",
      `${visibleCount} message${visibleCount === 1 ? "" : "s"} shown`
    ].join(" · ");
    return;
  }

  const runningCount = state.subscriptions.filter((subscription) => subscription.running).length;
  const runningGroupCount = state.groupSubscriptions.filter((subscription) => subscription.running).length;
  const totalRunning = runningCount + runningGroupCount;
  elements.monitorLine.textContent = totalRunning > 0 ? `${totalRunning} subscriptions live` : "No live subscriptions";
}

async function selectKin(kinId) {
  if (!kinId) {
    return;
  }

  state.selectedKinId = kinId;
  state.selectedGroupId = null;
  state.activeTab = ["monitor", "app-settings"].includes(state.activeTab) ? "backstory" : state.activeTab;
  state.selectedHistoryHash = null;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
  state.selectedKinAmbient = null;
  state.journalError = null;
  state.voiceError = null;
  state.ambientError = null;
  resetKinActionPlaceholders();
  renderKinSubscriptions();
  renderGroupSubscriptions();
  renderActivity();
  void loadKinVoice(kinId);
  void loadKinAmbient(kinId);

  try {
    state.selectedKinCapture = await withTimeout(
      window.kinagent.getCapturedKin({ kinId }),
      captureRequestTimeoutMs,
      "Captured settings request timed out."
    );
  } catch (error) {
    state.captureError = error.message || String(error);
  } finally {
    state.captureLoading = false;
    renderActivity();
  }
}

function selectGroup(groupId) {
  if (!groupId) {
    return;
  }

  state.selectedGroupId = groupId;
  state.selectedKinId = null;
  state.activeTab = "monitor";
  state.selectedHistoryHash = null;
  state.captureLoading = false;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
  state.selectedKinAmbient = null;
  state.voiceError = null;
  state.ambientError = null;
  state.voiceLoading = false;
  state.ambientLoading = false;
  resetKinActionPlaceholders();
  renderKinSubscriptions();
  renderGroupSubscriptions();
  renderMonitorState();
  renderActivity();
}

async function loadKinVoice(kinId) {
  state.voiceLoading = true;
  state.voiceError = null;
  renderActivity();

  try {
    state.selectedKinVoice = await window.kinagent.getKinVoicePreference({ kinId });
  } catch (error) {
    state.voiceError = error.message || String(error);
  } finally {
    state.voiceLoading = false;
    renderActivity();
  }
}

async function loadKinAmbient(kinId) {
  state.ambientLoading = true;
  state.ambientError = null;
  renderActivity();

  try {
    state.selectedKinAmbient = await window.kinagent.getKinAmbientPreference({ kinId });
  } catch (error) {
    state.ambientError = error.message || String(error);
  } finally {
    state.ambientLoading = false;
    renderActivity();
  }
}

async function loadAppSettings() {
  state.appSettingsLoading = true;
  state.appSettingsError = null;
  renderActivity();

  try {
    state.appSettings = await window.kinagent.getSettings();
  } catch (error) {
    state.appSettingsError = error.message || String(error);
  } finally {
    state.appSettingsLoading = false;
    renderActivity();
  }
}

function renderActivity() {
  const activeTab = state.activeTab || "monitor";
  const activeMode = modeForTab(activeTab);
  const isMonitor = activeMode === "monitor";
  const isVoice = activeMode === "voice";
  const isHermes = activeMode === "hermes";
  const isAnalyze = activeMode === "analyze";
  const isExport = activeMode === "export";
  const isAppSettings = activeMode === "app-settings";
  const kinModes = ["settings", "journal", "hermes", "voice", "analyze", "export"];

  renderJournalTabBadge();
  for (const button of elements.detailTabs.querySelectorAll("[data-mode]")) {
    if (button.dataset.mode === "settings") {
      button.hidden = Boolean(state.selectedGroupId);
    } else if (button.dataset.mode === "export") {
      button.hidden = !state.selectedGroupId;
    } else {
      button.hidden = false;
    }
    const selected =
      button.dataset.mode === activeMode || (button.dataset.mode === "settings" && kinModes.includes(activeMode));
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.kinDetailTabs.hidden = Boolean(
    state.selectedGroupId || !state.selectedKinId || !kinModes.includes(activeMode)
  );
  for (const button of elements.kinDetailTabs.querySelectorAll("[data-mode]")) {
    const selected = button.dataset.mode === activeMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.settingTabs.hidden = Boolean(state.selectedGroupId || activeMode !== "settings");
  for (const button of elements.settingTabs.querySelectorAll("[data-setting]")) {
    const selected = button.dataset.setting === currentSettingTab();
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.monitorPane.hidden = !isMonitor;
  elements.detailPane.hidden = isMonitor;
  elements.clearButton.hidden = !isMonitor;

  if (isMonitor) {
    const selectedKin = currentSelectedKin();
    const selectedGroup = currentSelectedGroup();
    elements.activityTitle.textContent = selectedGroup
      ? `${selectedGroup.name || "Group"} · Monitor`
      : selectedKin
        ? `${selectedKin.name || "Kin"} · Monitor`
        : "Incoming Messages";
    renderMessageList();
    renderMonitorState();
    return;
  }

  if (isAppSettings) {
    elements.activityTitle.textContent = "Settings";
    elements.monitorLine.textContent = "Application configuration";
    renderAppSettingsTab();
    return;
  }

  const selectedGroup = currentSelectedGroup();
  if (selectedGroup && isExport) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Export`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupExportTab(selectedGroup);
    return;
  }

  const selectedKin = currentSelectedKin();
  const field = currentCapturedField();
  const tabLabel = field?.label || tabLabelFor(activeTab);
  elements.activityTitle.textContent = selectedKin ? `${selectedKin.name || "Kin"} · ${tabLabel}` : tabLabel;
  elements.monitorLine.textContent = subtitleForDetailMode(activeMode);

  if (!state.selectedKinId) {
    renderDetailEmpty("Select Manage on a Kin to inspect captured settings.");
    return;
  }

  if (isVoice) {
    renderVoiceTab(selectedKin);
    return;
  }

  if (isHermes) {
    renderKinHermesTab(selectedKin);
    return;
  }

  if (isAnalyze) {
    renderKinAnalyzeTab(selectedKin);
    return;
  }

  if (isExport) {
    renderKinExportTab(selectedKin);
    return;
  }

  if (state.captureLoading) {
    renderDetailEmpty("Loading captured settings.");
    return;
  }

  if (state.captureError) {
    renderDetailEmpty(state.captureError);
    return;
  }

  if (!state.selectedKinCapture?.ok) {
    renderDetailEmpty(state.selectedKinCapture?.error || "No captured state found for this Kin yet.");
    return;
  }

  if (!field || !field.available) {
    renderDetailContent({
      content: "No captured value for this setting.",
      history: [],
      stats: detailStats(selectedKin, field, state.selectedKinCapture)
    });
    return;
  }

  renderDetailContent({
    content: field.content || "",
    history: field.history || [],
    stats: detailStats(selectedKin, field, state.selectedKinCapture)
  });
}

function renderDetailEmpty(message) {
  elements.kinDetailEmpty.hidden = false;
  elements.kinDetailEmpty.textContent = message;
  elements.kinDetailContent.hidden = true;
  elements.kinDetailContent.classList.remove("app-settings-content", "form-detail-content");
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
}

function renderDetailContent({ content, history, stats }) {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "form-detail-content");
  elements.fieldContent.hidden = false;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = false;
  const selectedEntryIndex = history.findIndex((entry) => entry.hash === state.selectedHistoryHash);
  const selectedEntry = selectedEntryIndex >= 0 ? history[selectedEntryIndex] : null;
  const previousEntry = selectedEntryIndex >= 0 ? history[selectedEntryIndex + 1] : null;
  renderFieldContent(content, selectedEntry, previousEntry);
  renderJournalSuggestions();

  elements.detailStats.replaceChildren();
  const visibleStats = selectedEntry
    ? [...stats, { label: "Viewing", value: `${formatTime(selectedEntry.committedAt)} (${selectedEntry.shortHash})` }]
    : stats;
  for (const stat of visibleStats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }

  elements.timelineList.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No recorded changes for this setting.";
    elements.timelineList.append(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `timeline-entry${entry.hash === state.selectedHistoryHash ? " active" : ""}`;
    item.title = entry.subject || "";
    item.addEventListener("click", () => {
      state.selectedHistoryHash = state.selectedHistoryHash === entry.hash ? null : entry.hash;
      renderActivity();
    });

    const date = document.createElement("div");
    date.className = "timeline-date";
    date.textContent = formatTime(entry.committedAt);

    const summary = document.createElement("p");
    summary.textContent = entry.summary || "Captured value";

    const change = document.createElement("span");
    change.className = "timeline-change";
    change.textContent = formatTimelineChange(entry);

    const hash = document.createElement("span");
    hash.textContent = entry.shortHash;

    item.append(date, summary, change, hash);
    elements.timelineList.append(item);
  }
}

function renderAppSettingsTab() {
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
  elements.kinDetailContent.classList.remove("form-detail-content");
  elements.kinDetailContent.classList.add("app-settings-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.appSettingsForm.hidden = false;
  elements.timeline.hidden = true;
  elements.detailStats.replaceChildren();

  const stats = [
    { label: "Config", value: state.appSettings.configPath || "Unavailable" },
    { label: "Data", value: state.appSettings.userDataDir || "Unavailable" },
    { label: "Hermes", value: config.hermes?.enabled ? "Enabled" : "Off" },
    { label: "Voice", value: config.voice?.enabled ? providerLabel(config.voice?.provider) : "Off" }
  ];
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }

  populateAppSettingsForm(config);
}

function populateAppSettingsForm(config) {
  const bridge = config.bridge || {};
  const hermes = config.hermes || {};
  const currentScene = hermes.currentSceneUpdates || {};
  const journal = hermes.journalSuggestions || {};
  const voice = config.voice || {};
  const openai = voice.openai || {};
  const elevenlabs = voice.elevenlabs || {};

  elements.settingsLogLevelInput.value = bridge.logLevel || "info";
  elements.settingsDedupeWindowInput.value = String(bridge.dedupeWindowSeconds || 180);
  elements.settingsPathLine.textContent = state.appSettings.configPath || "";

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
  if (state.appSettings.saved) {
    elements.appSettingsStatusLine.textContent = "Saved. Restart Kinagent for running services to use these settings.";
  } else {
    elements.appSettingsStatusLine.textContent = "Changes are written to the desktop config file.";
  }
}

function renderVoiceTab(selectedKin) {
  if (state.voiceLoading) {
    renderDetailEmpty("Loading voice settings.");
    return;
  }

  if (state.voiceError) {
    renderDetailEmpty(state.voiceError);
    return;
  }

  if (!state.selectedKinVoice?.ok) {
    renderDetailEmpty("No voice settings found for this Kin.");
    return;
  }

  const preference = state.selectedKinVoice.preference || {};
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = false;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;
  elements.voiceEnabledInput.checked = Boolean(preference.enabled);
  elements.voiceProviderInput.value = preference.provider || "openai";
  renderOpenAiVoiceOptions(state.selectedKinVoice.openAiVoiceOptions || [], preference.openaiVoice || "marin");
  elements.elevenLabsVoiceInput.value = preference.elevenLabsVoiceId || "";
  elements.filterNarrationInput.checked = preference.filterNarrationForTts !== false;
  elements.narrationDelimiterInput.value = preference.narrationDelimiter || "*";
  elements.openAiInstructionsInput.value = preference.openaiInstructions || "";
  elements.voiceSaveButton.disabled = state.voiceSaving;
  renderVoiceProviderFields();
  renderVoiceStatusLine();
  renderVoiceStats(selectedKin, preference);
}

function renderKinHermesTab(selectedKin) {
  if (state.ambientLoading) {
    renderDetailEmpty("Loading Hermes settings.");
    return;
  }

  if (state.ambientError) {
    renderDetailEmpty(state.ambientError);
    return;
  }

  if (!state.selectedKinAmbient?.ok) {
    renderDetailEmpty("No Hermes settings found for this Kin.");
    return;
  }

  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = false;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;
  elements.ambientContextEnabledInput.checked = state.selectedKinAmbient.enabled !== false;
  const chatDynamism = state.selectedKinAmbient.chatDynamism || {};
  elements.chatDynamismCurrentValue.textContent = chatDynamismCurrentLabel(
    state.selectedKinAmbient.currentChatDynamism
  );
  elements.chatDynamismEnabledInput.checked = Boolean(chatDynamism.enabled);
  elements.chatDynamismMinInput.value = String(chatDynamism.min ?? chatDynamismSlider.practicalMin);
  elements.chatDynamismMaxInput.value = String(chatDynamism.max ?? chatDynamismSlider.practicalMax);
  syncChatDynamismRangeLabels();
  elements.kinHermesSaveButton.disabled = state.ambientSaving;
  elements.kinHermesStatusLine.textContent = hermesStatusLine(state.selectedKinAmbient);
  renderKinHermesStats(selectedKin, state.selectedKinAmbient);
}

function renderKinAnalyzeTab(selectedKin) {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = false;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;
  elements.kinAnalyzeButton.disabled = state.kinAnalysisRunning;
  elements.kinAnalyzeReport.hidden = !state.kinAnalysisReport;
  renderMarkdownReport(elements.kinAnalyzeReport, state.kinAnalysisReport);
  renderKinActionStats(selectedKin, "Analysis", state.kinAnalysisRunning ? "Running" : "Manual");
}

function renderKinExportTab(selectedKin) {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = false;
  elements.timeline.hidden = true;
  elements.chatExportTitle.textContent = "Export";
  elements.chatExportDescription.textContent = "Export decrypted direct chat history for this Kin.";
  elements.chatExportRangeButton.disabled = state.chatExportSaving;
  elements.chatExportAllButton.disabled = state.chatExportSaving;
  renderKinActionStats(selectedKin, "Export", "Pending");
}

function renderGroupExportTab(selectedGroup) {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = false;
  elements.timeline.hidden = true;
  elements.chatExportTitle.textContent = "Export Group";
  elements.chatExportDescription.textContent =
    "Export decrypted group chat history with Kin names resolved from message AI IDs.";
  elements.chatExportRangeButton.disabled = state.chatExportSaving;
  elements.chatExportAllButton.disabled = state.chatExportSaving;
  renderGroupActionStats(selectedGroup, "Export", "Pending");
}

function renderKinHermesStats(selectedKin, preference) {
  const current = preference.currentChatDynamism || {};
  const chatDynamism = preference.chatDynamism || {};
  const stats = [
    { label: "Kin", value: selectedKin?.name || state.selectedKinId || "Unknown" },
    { label: "Ambient", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Dynamism", value: current.display || "Unknown" },
    { label: "Drift", value: chatDynamism.enabled ? `${chatDynamism.min} - ${chatDynamism.max}` : "Off" }
  ];

  elements.detailStats.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }
}

function renderKinActionStats(selectedKin, action, status) {
  const stats = [
    { label: "Kin", value: selectedKin?.name || state.selectedKinId || "Unknown" },
    { label: "Action", value: action },
    { label: "Status", value: status },
    { label: "Mode", value: "Manual" }
  ];

  elements.detailStats.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }
}

function renderGroupActionStats(selectedGroup, action, status) {
  const stats = [
    { label: "Group", value: selectedGroup?.name || state.selectedGroupId || "Unknown" },
    { label: "Action", value: action },
    { label: "Status", value: status },
    { label: "Mode", value: "Manual" }
  ];

  elements.detailStats.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }
}

function renderVoiceStats(selectedKin, preference) {
  const providers = state.selectedKinVoice.configuredProviders || {};
  const stats = [
    { label: "Kin", value: selectedKin?.name || state.selectedKinId || "Unknown" },
    { label: "Voice", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Provider", value: providerLabel(preference.provider) },
    {
      label: "Ready",
      value: state.selectedKinVoice.globalEnabled && providers[preference.provider] ? "Yes" : "No"
    }
  ];

  elements.detailStats.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }
}

function renderOpenAiVoiceOptions(options, selectedVoice) {
  const values = options.length > 0 ? options : [selectedVoice || "marin"];
  elements.openAiVoiceInput.replaceChildren();
  for (const voice of values) {
    const option = document.createElement("option");
    option.value = voice;
    option.textContent = voice;
    elements.openAiVoiceInput.append(option);
  }
  elements.openAiVoiceInput.value = selectedVoice || values[0] || "marin";
}

function renderVoiceProviderFields() {
  const provider = elements.voiceProviderInput.value;
  elements.openAiVoiceLabel.hidden = provider !== "openai";
  elements.openAiInstructionsInput.closest("label").hidden = provider !== "openai";
  elements.elevenLabsVoiceLabel.hidden = provider !== "elevenlabs";
  renderVoiceStatusLine();
}

function renderVoiceStatusLine() {
  if (!state.selectedKinVoice?.ok) {
    elements.voiceStatusLine.textContent = "";
    return;
  }

  const provider = elements.voiceProviderInput.value;
  const providers = state.selectedKinVoice.configuredProviders || {};
  if (!state.selectedKinVoice.globalEnabled) {
    elements.voiceStatusLine.textContent = "Voice is off globally. This Kin setting is saved but will not play yet.";
    return;
  }

  if (!providers[provider]) {
    elements.voiceStatusLine.textContent =
      provider === "openai" ? "OpenAI is missing an API key." : "ElevenLabs is missing an API key.";
    return;
  }

  if (provider === "elevenlabs" && !elements.elevenLabsVoiceInput.value.trim()) {
    elements.voiceStatusLine.textContent = "ElevenLabs requires a voice ID for this Kin.";
    return;
  }

  elements.voiceStatusLine.textContent = "Voice settings are ready for this Kin.";
}

async function saveAppSettings() {
  state.appSettingsSaving = true;
  state.appSettingsError = null;
  elements.appSettingsStatusLine.textContent = "Saving settings.";
  elements.appSettingsSaveButton.disabled = true;

  try {
    state.appSettings = await window.kinagent.saveSettings(readAppSettingsForm());
    elements.monitorLine.textContent = "Settings saved.";
  } catch (error) {
    state.appSettingsError = error.message || String(error);
  } finally {
    state.appSettingsSaving = false;
    renderActivity();
  }
}

function readAppSettingsForm() {
  return {
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

function numberInputValue(input) {
  return Number(input.value);
}

async function saveSelectedKinVoice() {
  if (!state.selectedKinId) {
    return;
  }

  const preference = {
    enabled: elements.voiceEnabledInput.checked,
    provider: elements.voiceProviderInput.value,
    openaiVoice: elements.openAiVoiceInput.value,
    openaiInstructions: elements.openAiInstructionsInput.value,
    elevenLabsVoiceId: elements.elevenLabsVoiceInput.value,
    filterNarrationForTts: elements.filterNarrationInput.checked,
    narrationDelimiter: elements.narrationDelimiterInput.value
  };

  state.voiceSaving = true;
  renderActivity();
  try {
    state.selectedKinVoice = await window.kinagent.setKinVoicePreference({
      kinId: state.selectedKinId,
      preference
    });
    state.voiceError = null;
    elements.monitorLine.textContent = "Voice settings saved.";
  } catch (error) {
    state.voiceError = error.message || String(error);
  } finally {
    state.voiceSaving = false;
    renderActivity();
  }
}

async function saveSelectedKinAmbient() {
  if (!state.selectedKinId) {
    return;
  }

  const enabled = elements.ambientContextEnabledInput.checked;
  const chatDynamism = readChatDynamismPreferenceForm();

  state.ambientSaving = true;
  renderActivity();
  try {
    state.selectedKinAmbient = await window.kinagent.setKinAmbientPreference({
      kinId: state.selectedKinId,
      enabled,
      chatDynamism
    });
    state.subscriptions = state.subscriptions.map((subscription) =>
      subscription.kin?.aiId === state.selectedKinId
        ? {
            ...subscription,
            ambientContextEnabled: state.selectedKinAmbient.enabled,
            chatDynamism: state.selectedKinAmbient.chatDynamism
          }
        : subscription
    );
    state.ambientError = null;
    elements.monitorLine.textContent = "Hermes settings saved.";
  } catch (error) {
    state.ambientError = error.message || String(error);
  } finally {
    state.ambientSaving = false;
    renderActivity();
  }
}

function readChatDynamismPreferenceForm() {
  const min = Number(elements.chatDynamismMinInput.value);
  const max = Number(elements.chatDynamismMaxInput.value);
  return {
    enabled: elements.chatDynamismEnabledInput.checked,
    min: Math.min(min, max),
    max: Math.max(min, max)
  };
}

function syncChatDynamismRangeLabels() {
  const min = Number(elements.chatDynamismMinInput.value);
  const max = Number(elements.chatDynamismMaxInput.value);
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  elements.chatDynamismMinValue.textContent = lower.toFixed(2);
  elements.chatDynamismMaxValue.textContent = upper.toFixed(2);

  const sliderMin = Number(elements.chatDynamismMinInput.min || chatDynamismSlider.hardMin);
  const sliderMax = Number(elements.chatDynamismMinInput.max || chatDynamismSlider.hardMax);
  const span = sliderMax - sliderMin || 1;
  const start = ((lower - sliderMin) / span) * 100;
  const end = ((upper - sliderMin) / span) * 100;
  const softLow = ((chatDynamismSlider.practicalMin - sliderMin) / span) * 100;
  const softHigh = ((chatDynamismSlider.practicalMax - sliderMin) / span) * 100;
  elements.chatDynamismRangeControl.style.setProperty("--range-start", `${start}%`);
  elements.chatDynamismRangeControl.style.setProperty("--range-end", `${end}%`);
  elements.chatDynamismRangeControl.style.setProperty("--soft-low", `${softLow}%`);
  elements.chatDynamismRangeControl.style.setProperty("--soft-high", `${softHigh}%`);
}

function chatDynamismCurrentLabel(value) {
  if (!value) {
    return "Unknown";
  }

  const base = value.display || (typeof value.numeric === "number" ? value.numeric.toFixed(2) : "Unknown");
  return typeof value.numeric === "number" ? `${base} (${value.numeric.toFixed(2)})` : base;
}

function hermesStatusLine(preference) {
  const ambient = preference.enabled ? "Ambient context is allowed" : "Ambient context is disabled";
  const chatDynamism = preference.chatDynamism?.enabled
    ? `Chat Dynamism drift suggestions are allowed from ${preference.chatDynamism.min} to ${preference.chatDynamism.max}.`
    : "Chat Dynamism drift suggestions are disabled.";
  return `${ambient}. ${chatDynamism}`;
}

function resetKinActionPlaceholders() {
  elements.chatExportFromInput.value = "";
  elements.chatExportToInput.value = "";
  elements.kinAnalyzeProgress.hidden = true;
  elements.kinAnalyzeProgress.value = 0;
  state.kinAnalysisReport = "";
  elements.chatExportProgress.hidden = true;
  elements.chatExportProgress.value = 0;
  elements.kinAnalyzeStatusLine.textContent = "";
  elements.kinAnalyzeReport.hidden = true;
  elements.kinAnalyzeReport.replaceChildren();
  elements.chatExportStatusLine.textContent = "";
}

async function analyzeSelectedKin() {
  if (!state.selectedKinId || state.kinAnalysisRunning) {
    return;
  }

  state.kinAnalysisRunning = true;
  state.kinAnalysisJobId = null;
  state.kinAnalysisReport = "";
  elements.kinAnalyzeProgress.hidden = false;
  elements.kinAnalyzeProgress.removeAttribute("value");
  elements.kinAnalyzeStatusLine.textContent = "Preparing Kin analysis.";
  elements.kinAnalyzeReport.hidden = true;
  elements.kinAnalyzeReport.replaceChildren();
  renderActivity();

  try {
    const result = await window.kinagent.analyzeKin({ kinId: state.selectedKinId });
    state.kinAnalysisJobId = result.jobId || state.kinAnalysisJobId;
    state.kinAnalysisReport = result.reportMarkdown || "";
    renderMarkdownReport(elements.kinAnalyzeReport, state.kinAnalysisReport);
    elements.kinAnalyzeReport.hidden = !state.kinAnalysisReport;
    elements.kinAnalyzeStatusLine.textContent = `Analysis complete with ${result.findingCount} finding${
      result.findingCount === 1 ? "" : "s"
    }.`;
  } catch (error) {
    elements.kinAnalyzeStatusLine.textContent = error.message || String(error);
  } finally {
    state.kinAnalysisRunning = false;
    state.kinAnalysisJobId = null;
    elements.kinAnalyzeProgress.hidden = true;
    elements.kinAnalyzeProgress.value = 0;
    renderActivity();
  }
}

function renderKinAnalysisProgress(progress) {
  if (!progress || !state.kinAnalysisRunning) {
    return;
  }

  if (progress.jobId) {
    state.kinAnalysisJobId = progress.jobId;
  }
  if (progress.phase === "complete") {
    elements.kinAnalyzeProgress.hidden = true;
    elements.kinAnalyzeProgress.value = 0;
    elements.kinAnalyzeStatusLine.textContent = progress.message || "Analysis report ready.";
    return;
  }

  elements.kinAnalyzeProgress.hidden = false;
  elements.kinAnalyzeProgress.removeAttribute("value");
  elements.kinAnalyzeStatusLine.textContent = progress.message || "Running Kin analysis.";
}

function renderMarkdownReport(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown || "").split(/\r?\n/);
  let list = null;

  const closeList = () => {
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const element = document.createElement(level === 1 ? "h2" : level === 2 ? "h3" : "h4");
      element.textContent = heading[2];
      container.append(element);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!list) {
        list = document.createElement("ul");
        container.append(list);
      }
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.append(item);
      continue;
    }

    closeList();
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.append(paragraph);
  }
}

async function exportSelectedChat(exportAll) {
  if ((!state.selectedKinId && !state.selectedGroupId) || state.chatExportSaving) {
    return;
  }

  state.chatExportSaving = true;
  state.chatExportJobId = null;
  elements.chatExportProgress.hidden = false;
  elements.chatExportProgress.removeAttribute("value");
  elements.chatExportStatusLine.textContent = exportAll ? "Preparing full chat export." : "Preparing chat export.";
  renderActivity();

  try {
    const request = {
      fromDate: exportAll ? "" : elements.chatExportFromInput.value,
      toDate: exportAll ? "" : elements.chatExportToInput.value
    };
    const result = state.selectedGroupId
      ? await window.kinagent.exportGroupChat({ ...request, groupId: state.selectedGroupId })
      : await window.kinagent.exportKinChat({ ...request, kinId: state.selectedKinId });
    state.chatExportJobId = result.jobId || state.chatExportJobId;
    if (result.ok) {
      elements.chatExportStatusLine.textContent = `Exported ${result.exportedCount} chat entries to ${result.filePath}.`;
    } else if (result.canceled) {
      elements.chatExportStatusLine.textContent = `Export prepared ${result.exportedCount} chat entries; save was canceled.`;
    } else {
      elements.chatExportStatusLine.textContent = "Export did not complete.";
    }
  } catch (error) {
    elements.chatExportStatusLine.textContent = error.message || String(error);
  } finally {
    state.chatExportSaving = false;
    state.chatExportJobId = null;
    elements.chatExportProgress.hidden = true;
    elements.chatExportProgress.value = 0;
    renderActivity();
  }
}

function renderChatExportProgress(progress) {
  if (!progress || !state.chatExportSaving) {
    return;
  }

  if (progress.jobId) {
    state.chatExportJobId = progress.jobId;
  }
  if (progress.phase === "complete") {
    elements.chatExportProgress.hidden = true;
    elements.chatExportProgress.value = 0;
    elements.chatExportStatusLine.textContent = progress.message || "Transcript ready.";
    return;
  }

  elements.chatExportProgress.hidden = false;
  if (typeof progress.total === "number" && progress.total > 0) {
    elements.chatExportProgress.max = progress.total;
    elements.chatExportProgress.value = progress.processed || 0;
  } else {
    elements.chatExportProgress.removeAttribute("value");
  }
  elements.chatExportStatusLine.textContent = progress.message || "Exporting chat.";
}

function detailStats(selectedKin, field, capture) {
  return [
    { label: "Kin", value: selectedKin?.name || capture.kinId || "Unknown" },
    { label: "Capture", value: capture.folderName || "Unavailable" },
    { label: "Setting", value: field?.label || tabLabelFor(state.activeTab) },
    { label: "Changes", value: String(field?.history?.length || 0) }
  ];
}

function renderFieldContent(content, selectedEntry, previousEntry) {
  elements.fieldContent.replaceChildren();

  if (!selectedEntry) {
    elements.fieldContent.textContent = content;
    return;
  }

  for (const line of renderSelectedHistoryDiff(selectedEntry, previousEntry)) {
    elements.fieldContent.append(createDiffLine(line));
  }
}

function renderJournalSuggestions() {
  const panel = elements.journalSuggestionPanel;
  panel.replaceChildren();
  const suggestions = selectedKinJournalSuggestions();
  panel.hidden = state.activeTab !== "journal" || suggestions.length === 0;
  if (panel.hidden) {
    return;
  }

  if (state.journalError) {
    const error = document.createElement("p");
    error.className = "panel-note";
    error.textContent = state.journalError;
    panel.append(error);
  }

  for (const suggestion of suggestions) {
    panel.append(createJournalSuggestionElement(suggestion));
  }
}

function createJournalSuggestionElement(suggestion) {
  const item = document.createElement("article");
  const action = suggestionAction(suggestion);
  item.className = `journal-suggestion ${action}`;

  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.className = "journal-suggestion-heading";
  const title = document.createElement("strong");
  title.textContent = suggestion.title || (suggestion.strongEvent ? "Strong journal suggestion" : "Journal suggestion");
  const meta = document.createElement("div");
  meta.className = "journal-suggestion-meta";
  appendSuggestionBadge(meta, action === "delete" ? "Delete review" : "Create review");
  if (action === "create") {
    const bucketLabel = categoryLabel(suggestion.category);
    const detailLabel = categoryDetailLabel(suggestion.categoryDetail);
    appendSuggestionBadge(meta, bucketLabel);
    if (detailLabel && detailLabel !== bucketLabel) {
      appendSuggestionBadge(meta, detailLabel);
    }
  }
  if (suggestion.strongEvent) {
    appendSuggestionBadge(meta, "Strong event");
  }
  heading.append(title, meta);
  const date = document.createElement("span");
  date.textContent = formatTime(suggestion.createdAt);
  header.append(heading, date);

  const entry = document.createElement("p");
  entry.textContent =
    action === "delete"
      ? suggestion.targetJournalEntry || suggestion.targetJournalTitle || "Selected journal entry will be deleted."
      : suggestion.entry || "";

  const details = document.createElement("dl");
  if (action === "delete") {
    appendSuggestionDetail(details, "Target", suggestion.targetJournalTitle || suggestion.targetJournalEntryId);
  }
  appendSuggestionDetail(details, "Reason", suggestion.durabilityReason);
  appendSuggestionListDetail(details, "Evidence", suggestion.evidence || []);
  if (action === "create") {
    appendSuggestionListDetail(details, "Keyphrases", suggestion.keyphrases || []);
  }

  const actions = document.createElement("div");
  actions.className = "journal-suggestion-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent =
    state.journalSavingId === suggestion.id
      ? action === "delete"
        ? "Deleting"
        : "Accepting"
      : action === "delete"
        ? "Delete"
        : "Accept";
  accept.disabled = Boolean(state.journalSavingId);
  accept.addEventListener("click", () => {
    void acceptJournalSuggestion(suggestion.id);
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = "Dismiss";
  dismiss.disabled = Boolean(state.journalSavingId);
  dismiss.addEventListener("click", () => {
    void dismissJournalSuggestion(suggestion.id);
  });

  actions.append(accept, dismiss);
  item.append(header, entry, details, actions);
  return item;
}

function appendSuggestionBadge(container, label) {
  if (!label) {
    return;
  }

  const badge = document.createElement("span");
  badge.className = "journal-suggestion-badge";
  badge.textContent = label;
  container.append(badge);
}

function appendSuggestionDetail(list, label, value) {
  if (!value) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  list.append(term, detail);
}

function appendSuggestionListDetail(list, label, values) {
  const visibleValues = values.map((value) => String(value).trim()).filter(Boolean);
  if (visibleValues.length === 0) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  const valueList = document.createElement("ul");
  for (const value of visibleValues) {
    const item = document.createElement("li");
    item.textContent = value;
    valueList.append(item);
  }
  detail.append(valueList);
  list.append(term, detail);
}

function categoryLabel(category) {
  const labels = {
    relationship_milestone: "Relationship milestone",
    world_capsule: "World capsule",
    behavior_callback: "Behavior callback",
    personal_fact: "Personal fact",
    resolved_conflict: "Resolved conflict",
    backstory_hook: "Backstory hook",
    important_decision: "Important decision",
    recurring_pattern: "Recurring pattern",
    other_durable_event: "Durable event"
  };
  return labels[category] || "";
}

function categoryDetailLabel(detail) {
  return typeof detail === "string" ? detail.trim() : "";
}

function renderJournalTabBadge() {
  const button = elements.kinDetailTabs.querySelector('[data-mode="journal"]');
  if (!button) {
    return;
  }

  const count = pendingJournalSuggestionCount();
  button.replaceChildren(document.createTextNode("Journal"));
  if (count > 0) {
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = String(count);
    button.append(badge);
  }
}

async function acceptJournalSuggestion(id) {
  state.journalSavingId = id;
  state.journalError = null;
  renderActivity();
  try {
    await window.kinagent.acceptJournalSuggestion({ id });
    state.journalSuggestions = await window.kinagent.listJournalSuggestions();
    if (state.selectedKinId) {
      state.selectedKinCapture = await withTimeout(
        window.kinagent.getCapturedKin({ kinId: state.selectedKinId }),
        captureRequestTimeoutMs,
        "Captured settings request timed out."
      );
    }
    elements.monitorLine.textContent = "Journal review accepted and capture refreshed.";
  } catch (error) {
    state.journalError = error.message || String(error);
  } finally {
    state.journalSavingId = null;
    renderActivity();
  }
}

async function dismissJournalSuggestion(id) {
  state.journalError = null;
  try {
    await window.kinagent.dismissJournalSuggestion({ id });
    state.journalSuggestions = await window.kinagent.listJournalSuggestions();
  } catch (error) {
    state.journalError = error.message || String(error);
  }
  renderActivity();
}

function selectedKinJournalSuggestions() {
  if (!state.selectedKinId) {
    return [];
  }

  return state.journalSuggestions.filter((suggestion) => suggestion.aiId === state.selectedKinId);
}

function suggestionAction(suggestion) {
  return suggestion?.action === "delete" ? "delete" : "create";
}

function pendingJournalSuggestionCount() {
  return state.selectedKinId ? selectedKinJournalSuggestions().length : state.journalSuggestions.length;
}

function upsertJournalSuggestion(suggestion) {
  if (!suggestion?.id) {
    return;
  }

  state.journalSuggestions = [
    suggestion,
    ...state.journalSuggestions.filter((current) => current.id !== suggestion.id)
  ];
}

function renderJournalSuggestionNotice(suggestion) {
  const selectedKin = state.kins.find((kin) => kin.aiId === suggestion?.aiId);
  elements.monitorLine.textContent = `Journal suggestion ready for ${selectedKin?.name || suggestion?.aiId || "Kin"}.`;
}

async function focusJournalSuggestion(suggestion) {
  if (!suggestion?.aiId) {
    return;
  }

  state.activeTab = "journal";
  await selectKin(suggestion.aiId);
  state.activeTab = "journal";
  renderActivity();
}

function currentCapturedField() {
  return state.selectedKinCapture?.fields?.find((field) => field.key === state.activeTab) || null;
}

function currentSelectedKin() {
  return state.kins.find((kin) => kin.aiId === state.selectedKinId) || null;
}

function currentSelectedGroup() {
  return state.groups.find((group) => group.groupId === state.selectedGroupId) || null;
}

function clearMissingSelectedKin() {
  if (!state.selectedKinId) {
    return;
  }

  if (!state.kins.some((kin) => kin.aiId === state.selectedKinId)) {
    state.selectedKinId = null;
    state.selectedKinCapture = null;
    state.selectedKinVoice = null;
    state.selectedKinAmbient = null;
    state.captureError = null;
    state.voiceError = null;
    state.ambientError = null;
    state.captureLoading = false;
    state.voiceLoading = false;
    state.ambientLoading = false;
    resetKinActionPlaceholders();
    state.activeTab = "monitor";
    state.selectedHistoryHash = null;
  }
}

function clearMissingSelectedGroup() {
  if (!state.selectedGroupId) {
    return;
  }

  if (!state.groups.some((group) => group.groupId === state.selectedGroupId)) {
    state.selectedGroupId = null;
  }
}

function tabLabelFor(tab) {
  if (tab === "journal") {
    return "Journal";
  }

  if (tab === "hermes") {
    return "Hermes";
  }

  if (tab === "voice") {
    return "Voice";
  }

  if (tab === "analyze") {
    return "Analyze";
  }

  if (tab === "export") {
    return "Export";
  }

  const settingButton = elements.settingTabs.querySelector(`[data-setting="${tab}"]`);
  if (settingButton) {
    return settingButton.textContent?.trim() || "Detail";
  }

  const modeButton = elements.detailTabs.querySelector(`[data-mode="${modeForTab(tab)}"]`);
  return modeButton?.textContent?.trim() || "Detail";
}

function tabForMode(mode) {
  if (mode === "app-settings") {
    return "app-settings";
  }

  if (mode === "settings") {
    return currentSettingTab();
  }

  return ["journal", "hermes", "voice", "analyze", "export"].includes(mode) ? mode : "monitor";
}

function modeForTab(tab) {
  if (tab === "app-settings") {
    return "app-settings";
  }

  if (settingTabKeys.has(tab)) {
    return "settings";
  }

  return ["journal", "hermes", "voice", "analyze", "export"].includes(tab) ? tab : "monitor";
}

function currentSettingTab() {
  return settingTabKeys.has(state.activeTab) ? state.activeTab : "backstory";
}

function subtitleForDetailMode(mode) {
  if (mode === "app-settings") {
    return "Application configuration";
  }

  if (mode === "voice") {
    return "Voice configuration";
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

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function handleMonitorLine(payload) {
  if (payload.type === "kindroid.chat.message" || payload.type === "kindroid.hermes_context") {
    addMonitorMessage(payload);
    return;
  }

  if (payload.message) {
    elements.monitorLine.textContent = payload.message;
    return;
  }

  if (payload.line) {
    elements.monitorLine.textContent = payload.line;
  }
}

function addMonitorMessage(message) {
  state.monitorMessages.unshift(message);
  state.monitorMessages = state.monitorMessages.slice(0, maxMonitorMessages);
  renderMessageList();
  renderMonitorState();
}

function renderMessageList() {
  elements.messageList.replaceChildren();
  for (const message of visibleMonitorMessages()) {
    elements.messageList.append(createMessageElement(message));
  }
}

function visibleMonitorMessages() {
  return filterVisibleMonitorMessages(state.monitorMessages, state);
}

function clearVisibleMonitorMessages() {
  const visible = new Set(visibleMonitorMessages());
  state.monitorMessages = state.monitorMessages.filter((message) => !visible.has(message));
  renderMessageList();
  renderMonitorState();
}

async function runAction(label, action) {
  const previous = elements.monitorLine.textContent;
  elements.monitorLine.textContent = label;
  try {
    await action();
  } catch (error) {
    elements.monitorLine.textContent = error.message || String(error);
    return;
  }

  if (elements.monitorLine.textContent === label) {
    elements.monitorLine.textContent = previous;
  }
}

function markSubscriptionRunning(kinId, running) {
  if (!kinId) {
    return;
  }

  state.subscriptions = state.subscriptions.map((subscription) =>
    subscription.kin?.aiId === kinId ? { ...subscription, running } : subscription
  );
  renderKinSubscriptions();
}

function markGroupSubscriptionRunning(groupId, running) {
  if (!groupId) {
    return;
  }

  state.groupSubscriptions = state.groupSubscriptions.map((subscription) =>
    subscription.group?.groupId === groupId ? { ...subscription, running } : subscription
  );
  renderGroupSubscriptions();
}

function updateMonitorRunning() {
  state.monitorRunning =
    state.subscriptions.some((subscription) => subscription.running) ||
    state.groupSubscriptions.some((subscription) => subscription.running);
}
