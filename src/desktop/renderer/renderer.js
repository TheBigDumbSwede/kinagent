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
  kinRefresh: null,
  groupRefresh: null,
  kinsExpanded: false,
  groupsExpanded: false,
  selectedKinId: null,
  selectedGroupId: null,
  selectedKinCapture: null,
  selectedKinVoice: null,
  journalSuggestions: [],
  journalSavingId: null,
  journalError: null,
  captureLoading: false,
  captureError: null,
  voiceLoading: false,
  voiceError: null,
  voiceSaving: false,
  activeTab: "monitor",
  selectedHistoryHash: null,
  monitorMessages: []
};

const captureRequestTimeoutMs = 12_000;
const maxMonitorMessages = 500;
const settingTabKeys = new Set(["backstory", "directive", "memory", "example", "scene", "background", "profile"]);

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
  settingTabs: document.querySelector("#settingTabs"),
  monitorPane: document.querySelector("#monitorPane"),
  detailPane: document.querySelector("#detailPane"),
  kinDetailEmpty: document.querySelector("#kinDetailEmpty"),
  kinDetailContent: document.querySelector("#kinDetailContent"),
  detailStats: document.querySelector("#detailStats"),
  journalSuggestionPanel: document.querySelector("#journalSuggestionPanel"),
  fieldContent: document.querySelector("#fieldContent"),
  voiceForm: document.querySelector("#voiceForm"),
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
  if (state.activeTab === "voice" && state.selectedKinId && !state.selectedKinVoice && !state.voiceLoading) {
    void loadKinVoice(state.selectedKinId);
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
elements.voiceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinVoice();
});

window.kinagent.onEvent((message) => {
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
    elements.kinRefreshLine.textContent = message.payload || "Kin refresh failed";
    return;
  }

  if (message.channel === "groups-refresh-error") {
    elements.groupRefreshLine.textContent = message.payload || "Group refresh failed";
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
    elements.kinRefreshLine.textContent = state.kinRefresh.error || "Kin refresh failed";
  } else if (totalCount > 0) {
    elements.kinRefreshLine.textContent = [
      `${totalCount} Kins`,
      `${runningCount} live`,
      disabledCount > 0 ? `${disabledCount} off` : null
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    elements.kinRefreshLine.textContent = "Waiting for Kin list";
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
    elements.groupRefreshLine.textContent = state.groupRefresh.error || "Group refresh failed";
  } else if (totalCount > 0) {
    elements.groupRefreshLine.textContent = [
      `${totalCount} groups`,
      `${runningCount} live`,
      disabledCount > 0 ? `${disabledCount} off` : null
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    elements.groupRefreshLine.textContent = "Waiting for group list";
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
  state.activeTab = state.activeTab === "monitor" ? "backstory" : state.activeTab;
  state.selectedHistoryHash = null;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
  state.journalError = null;
  state.voiceError = null;
  renderKinSubscriptions();
  renderGroupSubscriptions();
  renderActivity();
  void loadKinVoice(kinId);

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
  state.voiceError = null;
  state.voiceLoading = false;
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

function renderActivity() {
  const activeTab = state.activeTab || "monitor";
  const activeMode = modeForTab(activeTab);
  const isMonitor = activeMode === "monitor";
  const isVoice = activeMode === "voice";

  for (const button of elements.detailTabs.querySelectorAll("[data-mode]")) {
    button.hidden = Boolean(state.selectedGroupId && button.dataset.mode !== "monitor");
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
}

function renderDetailContent({ content, history, stats }) {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.fieldContent.hidden = false;
  elements.journalSuggestionPanel.hidden = true;
  elements.voiceForm.hidden = true;
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
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.voiceForm.hidden = false;
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
  item.className = "journal-suggestion";

  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = suggestion.strongEvent ? "Strong journal suggestion" : "Journal suggestion";
  const date = document.createElement("span");
  date.textContent = formatTime(suggestion.createdAt);
  header.append(title, date);

  const entry = document.createElement("p");
  entry.textContent = suggestion.entry || "";

  const details = document.createElement("dl");
  appendSuggestionDetail(details, "Reason", suggestion.durabilityReason);
  appendSuggestionDetail(details, "Evidence", (suggestion.evidence || []).join(" | "));
  appendSuggestionDetail(details, "Keyphrases", (suggestion.keyphrases || []).join(", "));

  const actions = document.createElement("div");
  actions.className = "journal-suggestion-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = state.journalSavingId === suggestion.id ? "Accepting" : "Accept";
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
    elements.monitorLine.textContent = "Journal entry accepted.";
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
    state.captureError = null;
    state.voiceError = null;
    state.captureLoading = false;
    state.voiceLoading = false;
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
  const settingButton = elements.settingTabs.querySelector(`[data-setting="${tab}"]`);
  if (settingButton) {
    return settingButton.textContent?.trim() || "Detail";
  }

  const modeButton = elements.detailTabs.querySelector(`[data-mode="${modeForTab(tab)}"]`);
  return modeButton?.textContent?.trim() || "Detail";
}

function tabForMode(mode) {
  if (mode === "settings") {
    return currentSettingTab();
  }

  return mode === "journal" || mode === "voice" ? mode : "monitor";
}

function modeForTab(tab) {
  if (settingTabKeys.has(tab)) {
    return "settings";
  }

  return tab === "journal" || tab === "voice" ? tab : "monitor";
}

function currentSettingTab() {
  return settingTabKeys.has(state.activeTab) ? state.activeTab : "backstory";
}

function subtitleForDetailMode(mode) {
  if (mode === "voice") {
    return "Voice configuration";
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
  if (payload.type === "kindroid.chat.message") {
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
