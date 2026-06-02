import { formatTime } from "./formatters.js";

export function visibleMonitorMessages(messages, { selectedGroupId, selectedKinId, activeTab }) {
  if (selectedGroupId) {
    return messages.filter((message) => message.groupId === selectedGroupId);
  }

  if (selectedKinId && activeTab === "monitor") {
    return messages.filter((message) => message.kinId === selectedKinId);
  }

  return messages;
}

export function createMessageElement(message) {
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
  return item;
}
