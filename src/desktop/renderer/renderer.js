const state = {
  kins: [],
  subscriptions: [],
  groups: [],
  groupSubscriptions: [],
  monitorRunning: false,
  kinRefresh: null,
  groupRefresh: null,
  kinsExpanded: false,
  groupsExpanded: false
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

window.kinagent.onEvent((message) => {
  if (message.channel === "monitor-line") {
    handleMonitorLine(message.payload);
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
    updateMonitorRunning();
    renderKinSubscriptions();
    renderMonitorState();
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

  renderKinSubscriptions();
  renderGroupSubscriptions();
  renderMonitorState();
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
    const row = document.createElement("label");
    row.className = "kin-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(subscription.enabled);
    checkbox.addEventListener("change", () =>
      runAction(checkbox.checked ? "Enabling Kin" : "Disabling Kin", async () => {
        await window.kinagent.setKinEnabled({ kinId: kin.aiId, enabled: checkbox.checked });
        await refreshStatus();
      })
    );

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
