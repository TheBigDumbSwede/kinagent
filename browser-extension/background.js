const NATIVE_HOST_NAME = "com.kinagent.bridge";
const KINDROID_URL_PATTERN = "https://kindroid.ai/*";
const POLL_INTERVAL_MS = 2000;
const RECONNECT_INTERVAL_MS = 5000;

let nativePort = null;
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

  nativePort.onMessage.addListener(handleNativeMessage);
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    stopPolling();
    scheduleReconnect();
  });

  postNativeMessage({ type: "browser-ready" });
  schedulePoll(500);
}

function handleNativeMessage(message) {
  if (!message || message.type !== "commands" || !Array.isArray(message.commands)) {
    return;
  }

  for (const command of message.commands) {
    dispatchCommand(command);
  }
}

function dispatchCommand(command) {
  if (!command || typeof command.type !== "string") {
    return;
  }

  chrome.tabs.query({ url: KINDROID_URL_PATTERN }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      if (command.type === "show-notice") {
        chrome.tabs.sendMessage(tab.id, {
          type: "kinagent-show-notice",
          text: typeof command.text === "string" ? command.text : "Kinagent is connected."
        });
      } else if (command.type === "reload-kindroid") {
        chrome.tabs.sendMessage(tab.id, { type: "kinagent-reload-kindroid" });
      }
    }
  });
}

function pollNativeHost() {
  if (!postNativeMessage({ type: "poll" })) {
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
