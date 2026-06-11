const NATIVE_HOST_NAME = "com.kinagent.bridge";
const KINDROID_URL_PATTERN = "https://kindroid.ai/*";
const BRIDGE_PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 2000;
const RECONNECT_INTERVAL_MS = 5000;

let nativePort = null;
let bridgeSessionId = null;
let pollTimer = null;
let reconnectTimer = null;
let sequence = 0;

connectNativeHost();

chrome.runtime.onInstalled.addListener(() => {
  connectNativeHost();
});

chrome.runtime.onStartup.addListener(() => {
  connectNativeHost();
});

function connectNativeHost() {
  if (nativePort) {
    return;
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch {
    scheduleReconnect();
    return;
  }

  bridgeSessionId = null;
  nativePort.onMessage.addListener(handleNativeMessage);
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    bridgeSessionId = null;
    stopPolling();
    scheduleReconnect();
  });

  postNativeMessage({ type: "hello" });
}

function handleNativeMessage(message) {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "bridge-ready" && message.protocolVersion === BRIDGE_PROTOCOL_VERSION) {
    if (typeof message.sessionId !== "string" || message.sessionId.length === 0) {
      return;
    }

    bridgeSessionId = message.sessionId;
    postNativeMessage({ type: "browser-ready" });
    schedulePoll(500);
    return;
  }

  if (message.type === "commands" && Array.isArray(message.commands)) {
    for (const command of message.commands) {
      dispatchCommand(command);
    }
    return;
  }

  if (message.type === "error" && !bridgeSessionId) {
    stopPolling();
    scheduleReconnect();
  }
}

function dispatchCommand(command) {
  if (!command || typeof command.type !== "string") {
    return;
  }

  const commandId = typeof command.id === "string" ? command.id : null;
  let handled = command.type === "show-notice" || command.type === "reload-kindroid";

  chrome.tabs.query({ url: KINDROID_URL_PATTERN }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      if (command.type === "show-notice") {
        sendKindroidNotice(tab.id, typeof command.text === "string" ? command.text : "Kinagent is connected.");
      } else if (command.type === "reload-kindroid") {
        sendKindroidNotice(tab.id, "Kinagent is reloading this Kindroid tab.");
        setTimeout(() => {
          chrome.tabs.reload(tab.id).catch(() => undefined);
        }, 500);
      }
    }

    if (commandId) {
      postNativeMessage({
        type: "command-ack",
        commandIds: [commandId],
        status: handled ? "accepted" : "unsupported"
      });
    }
  });
}

function sendKindroidNotice(tabId, text) {
  chrome.tabs
    .sendMessage(tabId, {
      type: "kinagent-show-notice",
      text
    })
    .catch(() => undefined);
}

function pollNativeHost() {
  if (!bridgeSessionId || !postNativeMessage({ type: "poll" })) {
    scheduleReconnect();
    return;
  }

  schedulePoll(POLL_INTERVAL_MS);
}

function postNativeMessage(message) {
  if (!nativePort) {
    return false;
  }

  nativePort.postMessage({
    id: `kinagent-extension-${Date.now()}-${++sequence}`,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    extensionId: chrome.runtime.id,
    ...(bridgeSessionId ? { sessionId: bridgeSessionId } : {}),
    ...message
  });
  return true;
}

function schedulePoll(delayMs) {
  stopPolling();
  pollTimer = setTimeout(pollNativeHost, delayMs);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNativeHost();
  }, RECONNECT_INTERVAL_MS);
}
