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
  selectedKinCapture: null,
  selectedKinVoice: null,
  captureLoading: false,
  captureError: null,
  voiceLoading: false,
  voiceError: null,
  voiceSaving: false,
  activeTab: "monitor"
};

const captureRequestTimeoutMs = 12_000;

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
  monitorPane: document.querySelector("#monitorPane"),
  detailPane: document.querySelector("#detailPane"),
  kinDetailEmpty: document.querySelector("#kinDetailEmpty"),
  kinDetailContent: document.querySelector("#kinDetailContent"),
  detailStats: document.querySelector("#detailStats"),
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
  elements.messageList.replaceChildren();
});
elements.detailTabs.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-tab]");
  if (!button) {
    return;
  }

  state.activeTab = button.dataset.tab;
  if (state.activeTab === "voice" && state.selectedKinId && !state.selectedKinVoice && !state.voiceLoading) {
    void loadKinVoice(state.selectedKinId);
  }
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
  state.monitorRunning = Boolean(status.monitorRunning);
  state.kinRefresh = status.kinRefresh || null;
  state.groupRefresh = status.groupRefresh || null;

  elements.sessionLine.textContent = status.session.available ? "Session saved" : "No saved session";
  elements.firebaseStatus.textContent = status.session.hasFirebaseAuth ? "Ready" : "Missing";
  elements.appCheckStatus.textContent = status.appCheckPresent ? "Ready" : "Missing";
  elements.expiryStatus.textContent = status.session.expirationIso || "Unknown";

  clearMissingSelectedKin();
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
    row.className = `kin-row selectable${state.selectedKinId === kin.aiId ? " selected" : ""}`;
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
    const row = document.createElement("label");
    row.className = "kin-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(subscription.enabled);
    checkbox.addEventListener("change", () =>
      runAction(checkbox.checked ? "Enabling group" : "Disabling group", async () => {
        await window.kinagent.setGroupEnabled({ groupId: group.groupId, enabled: checkbox.checked });
        await refreshStatus();
      })
    );

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
  state.activeTab = state.activeTab === "monitor" ? "backstory" : state.activeTab;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
  state.voiceError = null;
  renderKinSubscriptions();
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
  const isMonitor = activeTab === "monitor";
  const isVoice = activeTab === "voice";

  for (const button of elements.detailTabs.querySelectorAll("[data-tab]")) {
    const selected = button.dataset.tab === activeTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  }

  elements.monitorPane.hidden = !isMonitor;
  elements.detailPane.hidden = isMonitor;
  elements.clearButton.hidden = !isMonitor;

  if (isMonitor) {
    elements.activityTitle.textContent = "Incoming Messages";
    return;
  }

  const selectedKin = currentSelectedKin();
  const field = currentCapturedField();
  const tabLabel = field?.label || tabLabelFor(activeTab);
  elements.activityTitle.textContent = selectedKin ? `${selectedKin.name || "Kin"} · ${tabLabel}` : tabLabel;

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
  elements.voiceForm.hidden = true;
  elements.timeline.hidden = false;
  elements.fieldContent.textContent = content;

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

  elements.timelineList.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No recorded changes for this setting.";
    elements.timelineList.append(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("article");
    item.className = "timeline-entry";

    const date = document.createElement("div");
    date.className = "timeline-date";
    date.textContent = formatTime(entry.committedAt);

    const subject = document.createElement("p");
    subject.textContent = entry.subject || "Captured state";

    const hash = document.createElement("span");
    hash.textContent = entry.shortHash;

    item.append(date, subject, hash);
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

function currentCapturedField() {
  return state.selectedKinCapture?.fields?.find((field) => field.key === state.activeTab) || null;
}

function currentSelectedKin() {
  return state.kins.find((kin) => kin.aiId === state.selectedKinId) || null;
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
  }
}

function tabLabelFor(tab) {
  const button = elements.detailTabs.querySelector(`[data-tab="${tab}"]`);
  return button?.textContent?.trim() || "Detail";
}

function providerLabel(provider) {
  return provider === "elevenlabs" ? "ElevenLabs" : "OpenAI";
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

const voiceAudio = {
  context: null,
  nextStartTime: 0
};

async function playVoiceAudio(payload) {
  if (!payload?.audio || payload.format !== "mp3") {
    return;
  }

  try {
    const context = voiceAudio.context || new AudioContext();
    voiceAudio.context = context;
    if (context.state === "suspended") {
      await context.resume();
    }

    const audio = audioPayloadToArrayBuffer(payload.audio);
    const decoded = await context.decodeAudioData(audio.slice(0));
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);

    const now = context.currentTime;
    const boundaryGapSeconds = Math.max(0, Number(payload.boundaryGapMs ?? 80)) / 1000;
    const startAt = Math.max(now + 0.02, voiceAudio.nextStartTime + boundaryGapSeconds);
    source.start(startAt);
    voiceAudio.nextStartTime = startAt + decoded.duration;
    source.onended = () => {
      if (context.currentTime >= voiceAudio.nextStartTime - 0.05) {
        voiceAudio.nextStartTime = 0;
      }
    };
  } catch (error) {
    elements.monitorLine.textContent = `Voice playback failed: ${error.message || String(error)}`;
  }
}

function audioPayloadToArrayBuffer(audio) {
  if (audio instanceof ArrayBuffer) {
    return audio;
  }

  if (ArrayBuffer.isView(audio)) {
    return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  }

  throw new Error("Unsupported audio payload.");
}

function handleMonitorLine(payload) {
  if (payload.type === "kindroid.chat.message") {
    addMessage(payload);
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

function addMessage(message) {
  const item = document.createElement("article");
  item.className = `message ${message.sender || ""}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = [
    message.kinName,
    message.groupName,
    message.sender || "unknown",
    formatTime(message.timestamp),
    message.textDecrypted ? "decrypted" : "not decrypted"
  ]
    .filter(Boolean)
    .join(" · ");

  const text = document.createElement("p");
  text.textContent = message.text || "";

  item.append(meta, text);
  elements.messageList.prepend(item);
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

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
