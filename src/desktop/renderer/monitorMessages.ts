import { formatTime } from "./formatters.js";

export interface MonitorMessage {
  type?: string;
  kinId?: string | null;
  kinName?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  sender?: string | null;
  senderLabel?: string | null;
  source?: string | null;
  timestamp?: string | null;
  text?: string | null;
  textDecrypted?: boolean;
  visibleMessage?: string | null;
}

export interface MonitorMessageFilter {
  selectedGroupId?: string | null;
  selectedKinId?: string | null;
  activeTab?: string | null;
}

export function visibleMonitorMessages(
  messages: MonitorMessage[],
  { selectedGroupId, selectedKinId, activeTab }: MonitorMessageFilter
): MonitorMessage[] {
  if (selectedGroupId) {
    return messages.filter((message) => message.groupId === selectedGroupId);
  }

  if (selectedKinId && activeTab === "monitor") {
    return messages.filter((message) => message.kinId === selectedKinId);
  }

  return messages;
}

export function createMessageElement(message: MonitorMessage): HTMLElement {
  const item = document.createElement("article");
  item.className = `message ${message.sender || ""}`;
  if (message.type === "kindroid.hermes_context") {
    item.classList.add("hermes-context");
  }

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = [
    message.kinName,
    message.groupName,
    message.senderLabel || message.sender || "unknown",
    message.type === "kindroid.hermes_context" && message.source ? `source: ${message.source}` : null,
    formatTime(message.timestamp),
    message.type === "kindroid.hermes_context" ? null : message.textDecrypted ? "decrypted" : "not decrypted"
  ]
    .filter(Boolean)
    .join(" · ");

  const text = document.createElement("p");
  text.textContent = message.text || "";

  item.append(meta);
  if (message.type === "kindroid.hermes_context" && message.visibleMessage) {
    const visible = document.createElement("p");
    visible.className = "message-secondary";
    visible.textContent = `Visible turn: ${message.visibleMessage}`;
    item.append(visible);
  }
  item.append(text);
  return item;
}
