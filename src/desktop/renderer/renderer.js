import { analyzeSelectedKin, renderKinAnalysisProgress, renderMarkdownReport } from "./analysisPanel.js";
import { renderAppSettingsTab, saveAppSettings } from "./appSettingsForm.js";
import { createVoiceAudioPlayer } from "./audioPlayback.js";
import {
  capturedDetailStats,
  renderDetailContent as renderCapturedDetailContent,
  renderDetailEmpty as renderCapturedDetailEmpty
} from "./capturedDetailPanel.js";
import { exportSelectedChat, renderChatExportProgress } from "./chatExportPanel.js";
import {
  journalSuggestionNotice,
  renderJournalSuggestions,
  renderJournalTabBadge,
  upsertJournalSuggestion
} from "./journalSuggestionsPanel.js";
import { createMessageElement, visibleMonitorMessages as filterVisibleMonitorMessages } from "./monitorMessages.js";
import {
  markGroupSubscriptionRunning,
  markKinSubscriptionRunning,
  renderGroupSubscriptions,
  renderKinSubscriptions
} from "./subscriptionLists.js";
import {
  handleDetailTabsClick,
  handleKinDetailTabsClick,
  handleSettingTabsClick,
  modeForTab,
  renderTabNavigation,
  subtitleForDetailMode,
  tabLabelFor
} from "./tabNavigation.js";
import {
  renderKinHermesTab,
  renderVoiceProviderFields,
  renderVoiceTab,
  saveSelectedKinAmbient,
  saveSelectedKinVoice,
  syncChatDynamismRangeLabels
} from "./voiceHermesForms.js";

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

function capturedDetailContext() {
  return {
    state,
    elements,
    onSelectHistoryEntry: (hash) => {
      state.selectedHistoryHash = hash;
      renderActivity();
    }
  };
}

function appSettingsContext() {
  return {
    state,
    elements,
    api: window.kinagent,
    renderActivity,
    renderDetailEmpty,
    loadAppSettings
  };
}

function renderDetailEmpty(message) {
  renderCapturedDetailEmpty(capturedDetailContext(), message);
}

function voiceHermesContext() {
  return {
    state,
    elements,
    api: window.kinagent,
    renderActivity,
    renderDetailEmpty,
    chatDynamismSlider
  };
}

function subscriptionListContext() {
  return {
    state,
    elements,
    loginOnboardingMessage,
    refreshErrorLine,
    onSelectKin: (kinId) => {
      void selectKin(kinId);
    },
    onSelectGroup: selectGroup,
    onSetKinEnabled: (kinId, enabled) => {
      void runAction(enabled ? "Enabling Kin" : "Disabling Kin", async () => {
        await window.kinagent.setKinEnabled({ kinId, enabled });
        await refreshStatus();
      });
    },
    onSetGroupEnabled: (groupId, enabled) => {
      void runAction(enabled ? "Enabling group" : "Disabling group", async () => {
        await window.kinagent.setGroupEnabled({ groupId, enabled });
        await refreshStatus();
      });
    }
  };
}

function journalSuggestionsContext() {
  return {
    state,
    elements,
    onAcceptSuggestion: (id) => {
      void acceptJournalSuggestion(id);
    },
    onDismissSuggestion: (id) => {
      void dismissJournalSuggestion(id);
    }
  };
}

function tabNavigationContext() {
  return {
    state,
    elements,
    loadAppSettings: () => {
      void loadAppSettings();
    },
    loadKinVoice: (kinId) => {
      void loadKinVoice(kinId);
    },
    loadKinAmbient: (kinId) => {
      void loadKinAmbient(kinId);
    },
    renderActivity
  };
}

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
  renderKinSubscriptions(subscriptionListContext());
});
elements.refreshKinsButton.addEventListener("click", () =>
  runAction("Refreshing Kins", async () => {
    await window.kinagent.refreshKins();
    await refreshStatus();
  })
);
elements.toggleGroupsButton.addEventListener("click", () => {
  state.groupsExpanded = !state.groupsExpanded;
  renderGroupSubscriptions(subscriptionListContext());
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
  handleDetailTabsClick(tabNavigationContext(), event);
});
elements.kinDetailTabs.addEventListener("click", (event) => {
  handleKinDetailTabsClick(tabNavigationContext(), event);
});
elements.settingTabs.addEventListener("click", (event) => {
  handleSettingTabsClick(tabNavigationContext(), event);
});
elements.voiceProviderInput.addEventListener("change", () => {
  renderVoiceProviderFields(voiceHermesContext());
});
elements.appSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveAppSettings(appSettingsContext());
});
elements.voiceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinVoice(voiceHermesContext());
});
elements.kinHermesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinAmbient(voiceHermesContext());
});
elements.chatDynamismMinInput.addEventListener("input", () => {
  syncChatDynamismRangeLabels(voiceHermesContext());
});
elements.chatDynamismMaxInput.addEventListener("input", () => {
  syncChatDynamismRangeLabels(voiceHermesContext());
});
elements.kinAnalyzeButton.addEventListener("click", () => {
  void analyzeSelectedKin({ state, elements, api: window.kinagent, renderActivity });
});
elements.chatExportRangeButton.addEventListener("click", () => {
  void exportSelectedChat({ state, elements, api: window.kinagent, renderActivity }, false);
});
elements.chatExportAllButton.addEventListener("click", () => {
  void exportSelectedChat({ state, elements, api: window.kinagent, renderActivity }, true);
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
    upsertJournalSuggestion(state, message.payload);
    elements.monitorLine.textContent = journalSuggestionNotice(state, message.payload);
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
    renderChatExportProgress({ state, elements }, message.payload);
    return;
  }

  if (message.channel === "kin-analysis-progress") {
    renderKinAnalysisProgress({ state, elements }, message.payload);
    return;
  }

  if (message.channel === "monitor-started") {
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, true);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-stopped" || message.channel === "monitor-exit") {
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, false);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-error") {
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, false);
    updateMonitorRunning();
    elements.monitorLine.textContent = message.payload?.error || message.payload || "Monitor error";
    return;
  }

  if (message.channel === "group-monitor-started") {
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, true);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "group-monitor-stopped" || message.channel === "group-monitor-exit") {
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, false);
    updateMonitorRunning();
    renderMonitorState();
    return;
  }

  if (message.channel === "group-monitor-error") {
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, false);
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
    renderKinSubscriptions(subscriptionListContext());
    renderMonitorState();
    renderActivity();
    return;
  }

  if (message.channel === "groups-updated") {
    state.groupSubscriptions = message.payload || [];
    state.groups = state.groupSubscriptions.map((subscription) => subscription.group);
    clearMissingSelectedGroup();
    updateMonitorRunning();
    renderGroupSubscriptions(subscriptionListContext());
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
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
  renderMonitorState();
  renderActivity();
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
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
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
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
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

  renderJournalTabBadge(journalSuggestionsContext());
  renderTabNavigation(tabNavigationContext(), activeMode);

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
    renderAppSettingsTab(appSettingsContext());
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
  const tabLabel = field?.label || tabLabelFor(tabNavigationContext(), activeTab);
  elements.activityTitle.textContent = selectedKin ? `${selectedKin.name || "Kin"} · ${tabLabel}` : tabLabel;
  elements.monitorLine.textContent = subtitleForDetailMode(activeMode);

  if (!state.selectedKinId) {
    renderDetailEmpty("Select Manage on a Kin to inspect captured settings.");
    return;
  }

  if (isVoice) {
    renderVoiceTab(voiceHermesContext(), selectedKin);
    return;
  }

  if (isHermes) {
    renderKinHermesTab(voiceHermesContext(), selectedKin);
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
    renderCapturedDetailContent(capturedDetailContext(), {
      content: "No captured value for this setting.",
      history: [],
      stats: capturedDetailStats({
        selectedKin,
        field,
        capture: state.selectedKinCapture,
        fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
      })
    });
    renderJournalSuggestions(journalSuggestionsContext());
    return;
  }

  renderCapturedDetailContent(capturedDetailContext(), {
    content: field.content || "",
    history: field.history || [],
    stats: capturedDetailStats({
      selectedKin,
      field,
      capture: state.selectedKinCapture,
      fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
    })
  });
  renderJournalSuggestions(journalSuggestionsContext());
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

function updateMonitorRunning() {
  state.monitorRunning =
    state.subscriptions.some((subscription) => subscription.running) ||
    state.groupSubscriptions.some((subscription) => subscription.running);
}
