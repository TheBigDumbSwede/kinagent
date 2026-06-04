import { formatTime } from "./formatters.js";

export interface MonitorMessage {
  type?: string;
  id?: string | null;
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

export interface MonitorSubscription {
  enabled?: boolean;
  running?: boolean;
  kin?: {
    aiId?: string | null;
  };
  group?: {
    groupId?: string | null;
  };
}

export interface MonitorEntity {
  aiId?: string | null;
  groupId?: string | null;
}

export interface MonitorPanelState extends MonitorMessageFilter {
  monitorMessages: MonitorMessage[];
  subscriptions: MonitorSubscription[];
  groupSubscriptions: MonitorSubscription[];
}

export interface MonitorPanelElements {
  monitorLine: HTMLElement;
  messageList: HTMLElement;
}

export interface MonitorPanelContext {
  state: MonitorPanelState;
  elements: MonitorPanelElements;
  selectedKin: MonitorEntity | null;
  selectedGroup: MonitorEntity | null;
  maxMonitorMessages: number;
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

export function renderMonitorState(context: MonitorPanelContext): void {
  const { state, elements } = context;
  if ((state.activeTab || "monitor") !== "monitor") {
    return;
  }

  if (context.selectedGroup) {
    const subscription = state.groupSubscriptions.find(
      (item) => item.group?.groupId === context.selectedGroup?.groupId
    );
    const visibleCount = currentVisibleMonitorMessages(state).length;
    elements.monitorLine.textContent = [
      subscription?.running
        ? "Group subscription live"
        : subscription?.enabled
          ? "Group subscription queued"
          : "Group off",
      messageCountLabel(visibleCount)
    ].join(" · ");
    return;
  }

  if (context.selectedKin) {
    const subscription = state.subscriptions.find((item) => item.kin?.aiId === context.selectedKin?.aiId);
    const visibleCount = currentVisibleMonitorMessages(state).length;
    elements.monitorLine.textContent = [
      subscription?.running ? "Kin subscription live" : subscription?.enabled ? "Kin subscription queued" : "Kin off",
      messageCountLabel(visibleCount)
    ].join(" · ");
    return;
  }

  const runningCount = state.subscriptions.filter((subscription) => subscription.running).length;
  const runningGroupCount = state.groupSubscriptions.filter((subscription) => subscription.running).length;
  const totalRunning = runningCount + runningGroupCount;
  elements.monitorLine.textContent = totalRunning > 0 ? `${totalRunning} subscriptions live` : "No live subscriptions";
}

export function handleMonitorLine(
  context: MonitorPanelContext,
  payload: MonitorMessage & { message?: string; line?: string }
): void {
  if (payload.type === "kindroid.chat.message" || payload.type === "kindroid.hermes_context") {
    addMonitorMessage(context, payload);
    return;
  }

  if (payload.type === "kindroid.chat.deleted") {
    removeDeletedMonitorMessage(context, payload);
    return;
  }

  if (payload.message) {
    context.elements.monitorLine.textContent = payload.message;
    return;
  }

  if (payload.line) {
    context.elements.monitorLine.textContent = payload.line;
  }
}

export function addMonitorMessage(context: MonitorPanelContext, message: MonitorMessage): void {
  context.state.monitorMessages.unshift(message);
  context.state.monitorMessages = context.state.monitorMessages.slice(0, context.maxMonitorMessages);
  renderMessageList(context);
  renderMonitorState(context);
}

export function removeDeletedMonitorMessage(context: MonitorPanelContext, message: MonitorMessage): void {
  if (!message.id) {
    return;
  }

  const beforeCount = context.state.monitorMessages.length;
  context.state.monitorMessages = context.state.monitorMessages.filter((current) => {
    if (current.id !== message.id) {
      return true;
    }
    if (message.groupId) {
      return current.groupId !== message.groupId;
    }
    if (message.kinId) {
      return current.kinId !== message.kinId;
    }
    return false;
  });
  const removedCount = beforeCount - context.state.monitorMessages.length;
  renderMessageList(context);
  renderMonitorState(context);
  context.elements.monitorLine.textContent =
    removedCount > 0
      ? `${removedCount} deleted or rewound message${removedCount === 1 ? "" : "s"} removed.`
      : "Message deletion observed.";
}

export function renderMessageList(context: Pick<MonitorPanelContext, "state" | "elements">): void {
  context.elements.messageList.replaceChildren();
  for (const message of currentVisibleMonitorMessages(context.state)) {
    context.elements.messageList.append(createMessageElement(message));
  }
}

export function currentVisibleMonitorMessages(state: MonitorPanelState): MonitorMessage[] {
  return visibleMonitorMessages(state.monitorMessages, state);
}

export function clearVisibleMonitorMessages(context: MonitorPanelContext): void {
  const visible = new Set(currentVisibleMonitorMessages(context.state));
  context.state.monitorMessages = context.state.monitorMessages.filter((message) => !visible.has(message));
  renderMessageList(context);
  renderMonitorState(context);
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

function messageCountLabel(count: number): string {
  return `${count} message${count === 1 ? "" : "s"} shown`;
}
