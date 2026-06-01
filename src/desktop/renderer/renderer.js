const state = {
  kins: [],
  monitorRunning: false
};

const elements = {
  sessionLine: document.querySelector("#sessionLine"),
  firebaseStatus: document.querySelector("#firebaseStatus"),
  appCheckStatus: document.querySelector("#appCheckStatus"),
  expiryStatus: document.querySelector("#expiryStatus"),
  kinSelect: document.querySelector("#kinSelect"),
  manualKinInput: document.querySelector("#manualKinInput"),
  pageSizeInput: document.querySelector("#pageSizeInput"),
  monitorLine: document.querySelector("#monitorLine"),
  messageList: document.querySelector("#messageList"),
  loginStartButton: document.querySelector("#loginStartButton"),
  loginSaveButton: document.querySelector("#loginSaveButton"),
  openKindroidButton: document.querySelector("#openKindroidButton"),
  monitorStartButton: document.querySelector("#monitorStartButton"),
  monitorStopButton: document.querySelector("#monitorStopButton"),
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
elements.monitorStartButton.addEventListener("click", () =>
  runAction("Starting monitor", async () => {
    const kinId = selectedKinId();
    await window.kinagent.startMonitor({
      kinId,
      pageSize: numberValue(elements.pageSizeInput.value, 50)
    });
    state.monitorRunning = true;
    renderMonitorState();
  })
);
elements.monitorStopButton.addEventListener("click", () =>
  runAction("Stopping monitor", async () => {
    await window.kinagent.stopMonitor();
    state.monitorRunning = false;
    renderMonitorState();
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
    state.monitorRunning = true;
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-stopped" || message.channel === "monitor-exit") {
    state.monitorRunning = false;
    renderMonitorState();
    return;
  }

  if (message.channel === "monitor-error") {
    state.monitorRunning = false;
    elements.monitorLine.textContent = message.payload || "Monitor error";
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
  state.monitorRunning = Boolean(status.monitorRunning);

  elements.sessionLine.textContent = status.session.available ? "Session saved" : "No saved session";
  elements.firebaseStatus.textContent = status.session.hasFirebaseAuth ? "Ready" : "Missing";
  elements.appCheckStatus.textContent = status.appCheckPresent ? "Ready" : "Missing";
  elements.expiryStatus.textContent = status.session.expirationIso || "Unknown";

  renderKinSelect(status.config.configuredKins || [], state.kins);
  renderMonitorState();
}

function renderKinSelect(configuredKins, cachedKins) {
  const selected = elements.kinSelect.value;
  elements.kinSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = cachedKins.length || configuredKins.length ? "Select a Kin" : "No cached Kins";
  elements.kinSelect.append(placeholder);

  const options = [
    ...configuredKins.filter((kin) => kin.aiId).map((kin) => ({ name: kin.name, aiId: kin.aiId })),
    ...cachedKins.map((kin) => ({ name: kin.name || kin.aiId, aiId: kin.aiId }))
  ];

  const seen = new Set();
  for (const kin of options) {
    if (!kin.aiId || seen.has(kin.aiId)) {
      continue;
    }

    seen.add(kin.aiId);
    const option = document.createElement("option");
    option.value = kin.aiId;
    option.textContent = `${kin.name || "Kin"} (${kin.aiId})`;
    elements.kinSelect.append(option);
  }

  elements.kinSelect.value = selected;
}

function renderMonitorState() {
  elements.monitorLine.textContent = state.monitorRunning ? "Monitor running" : "Monitor stopped";
}

function selectedKinId() {
  const kinId = elements.manualKinInput.value.trim() || elements.kinSelect.value;
  if (!kinId) {
    throw new Error("Select a Kin or enter an AI ID.");
  }

  return kinId;
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

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
