import type { GroupSubscriptionSummary, KinSubscriptionSummary } from "./rendererTypes.js";

export interface SubscriptionListState {
  subscriptions: KinSubscriptionSummary[];
  groupSubscriptions: GroupSubscriptionSummary[];
  kinsExpanded: boolean;
  groupsExpanded: boolean;
  selectedKinId: string | null;
  selectedGroupId: string | null;
  kinRefresh: { ok?: boolean; error?: string } | null;
  groupRefresh: { ok?: boolean; error?: string } | null;
  sessionAvailable: boolean;
}

export interface SubscriptionListElements {
  kinRefreshLine: HTMLElement;
  kinSubscriptionList: HTMLElement;
  toggleKinsButton: HTMLButtonElement;
  groupRefreshLine: HTMLElement;
  groupSubscriptionList: HTMLElement;
  toggleGroupsButton: HTMLButtonElement;
}

export interface SubscriptionListContext {
  state: SubscriptionListState;
  elements: SubscriptionListElements;
  loginOnboardingMessage: string;
  refreshErrorLine: (error: string | undefined, fallback: string) => string;
  onSelectKin: (kinId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onSetKinEnabled: (kinId: string, enabled: boolean) => void;
  onSetGroupEnabled: (groupId: string, enabled: boolean) => void;
}

export function renderKinSubscriptions(context: SubscriptionListContext): void {
  const { state, elements } = context;
  elements.kinSubscriptionList.replaceChildren();
  elements.kinSubscriptionList.hidden = !state.kinsExpanded;
  elements.toggleKinsButton.textContent = state.kinsExpanded ? "Hide" : "Manage";
  elements.toggleKinsButton.setAttribute("aria-expanded", String(state.kinsExpanded));

  const totalCount = state.subscriptions.length;
  const enabledCount = state.subscriptions.filter((subscription) => subscription.enabled).length;
  const runningCount = state.subscriptions.filter((subscription) => subscription.running).length;
  const disabledCount = totalCount - enabledCount;

  if (state.kinRefresh && !state.kinRefresh.ok) {
    elements.kinRefreshLine.textContent = context.refreshErrorLine(state.kinRefresh.error, "Kin refresh failed");
  } else if (totalCount > 0) {
    elements.kinRefreshLine.textContent = subscriptionSummaryText(totalCount, runningCount, disabledCount, "Kins");
  } else {
    elements.kinRefreshLine.textContent = state.sessionAvailable
      ? "Waiting for Kin list"
      : context.loginOnboardingMessage;
  }

  elements.toggleKinsButton.disabled = state.subscriptions.length === 0;

  if (!state.kinsExpanded) {
    return;
  }

  if (state.subscriptions.length === 0) {
    elements.kinSubscriptionList.append(emptyLine("No Kins discovered yet"));
    return;
  }

  for (const subscription of state.subscriptions) {
    elements.kinSubscriptionList.append(createKinSubscriptionRow(context, subscription));
  }
}

export function renderGroupSubscriptions(context: SubscriptionListContext): void {
  const { state, elements } = context;
  elements.groupSubscriptionList.replaceChildren();
  elements.groupSubscriptionList.hidden = !state.groupsExpanded;
  elements.toggleGroupsButton.textContent = state.groupsExpanded ? "Hide" : "Manage";
  elements.toggleGroupsButton.setAttribute("aria-expanded", String(state.groupsExpanded));

  const totalCount = state.groupSubscriptions.length;
  const enabledCount = state.groupSubscriptions.filter((subscription) => subscription.enabled).length;
  const runningCount = state.groupSubscriptions.filter((subscription) => subscription.running).length;
  const disabledCount = totalCount - enabledCount;

  if (state.groupRefresh && !state.groupRefresh.ok) {
    elements.groupRefreshLine.textContent = context.refreshErrorLine(state.groupRefresh.error, "Group refresh failed");
  } else if (totalCount > 0) {
    elements.groupRefreshLine.textContent = subscriptionSummaryText(totalCount, runningCount, disabledCount, "groups");
  } else {
    elements.groupRefreshLine.textContent = state.sessionAvailable
      ? "Waiting for group list"
      : context.loginOnboardingMessage;
  }

  elements.toggleGroupsButton.disabled = state.groupSubscriptions.length === 0;

  if (!state.groupsExpanded) {
    return;
  }

  if (state.groupSubscriptions.length === 0) {
    elements.groupSubscriptionList.append(emptyLine("No groups discovered yet"));
    return;
  }

  for (const subscription of state.groupSubscriptions) {
    elements.groupSubscriptionList.append(createGroupSubscriptionRow(context, subscription));
  }
}

export function markKinSubscriptionRunning(
  context: SubscriptionListContext,
  kinId: string | undefined,
  running: boolean
): void {
  if (!kinId) {
    return;
  }

  context.state.subscriptions = context.state.subscriptions.map((subscription) =>
    subscription.kin?.aiId === kinId ? { ...subscription, running } : subscription
  );
  renderKinSubscriptions(context);
}

export function markGroupSubscriptionRunning(
  context: SubscriptionListContext,
  groupId: string | undefined,
  running: boolean
): void {
  if (!groupId) {
    return;
  }

  context.state.groupSubscriptions = context.state.groupSubscriptions.map((subscription) =>
    subscription.group?.groupId === groupId ? { ...subscription, running } : subscription
  );
  renderGroupSubscriptions(context);
}

function createKinSubscriptionRow(context: SubscriptionListContext, subscription: KinSubscriptionSummary): HTMLElement {
  const kin = subscription.kin || {};
  const kinId = kin.aiId || "";
  const row = createSelectableRow({
    selected: context.state.selectedKinId === kin.aiId && !context.state.selectedGroupId,
    label: `Manage ${kin.name || kin.aiId || "Kin"}`,
    onSelect: () => {
      if (kinId) {
        context.onSelectKin(kinId);
      }
    }
  });

  const checkbox = createSubscriptionCheckbox({
    checked: Boolean(subscription.enabled),
    label: `Monitor ${kin.name || kin.aiId || "Kin"}`,
    onChange: (enabled) => {
      if (kinId) {
        context.onSetKinEnabled(kinId, enabled);
      }
    }
  });

  row.append(checkbox, subscriptionName(kin.name || kin.aiId || "Kin"), subscriptionStatus(subscription));
  return row;
}

function createGroupSubscriptionRow(
  context: SubscriptionListContext,
  subscription: GroupSubscriptionSummary
): HTMLElement {
  const group = subscription.group || {};
  const groupId = group.groupId || "";
  const row = createSelectableRow({
    selected: context.state.selectedGroupId === group.groupId,
    label: `Manage ${group.name || group.groupId || "Group"}`,
    onSelect: () => {
      if (groupId) {
        context.onSelectGroup(groupId);
      }
    }
  });

  const checkbox = createSubscriptionCheckbox({
    checked: Boolean(subscription.enabled),
    label: `Monitor ${group.name || group.groupId || "Group"}`,
    onChange: (enabled) => {
      if (groupId) {
        context.onSetGroupEnabled(groupId, enabled);
      }
    }
  });

  row.append(checkbox, subscriptionName(group.name || group.groupId || "Group"), subscriptionStatus(subscription));
  return row;
}

function createSelectableRow(input: { selected: boolean; label: string; onSelect: () => void }): HTMLElement {
  const row = document.createElement("div");
  row.className = `kin-row selectable${input.selected ? " selected" : ""}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", input.label);
  row.addEventListener("click", input.onSelect);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.onSelect();
    }
  });
  return row;
}

function createSubscriptionCheckbox(input: {
  checked: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
}): HTMLInputElement {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = input.checked;
  checkbox.setAttribute("aria-label", input.label);
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  checkbox.addEventListener("change", (event) => {
    event.stopPropagation();
    input.onChange(checkbox.checked);
  });
  return checkbox;
}

function subscriptionName(value: string): HTMLElement {
  const text = document.createElement("span");
  text.className = "kin-name";
  text.textContent = value;
  return text;
}

function subscriptionStatus(subscription: { enabled?: boolean; running?: boolean }): HTMLElement {
  const status = document.createElement("span");
  status.className = `kin-state ${subscription.running ? "running" : subscription.enabled ? "enabled" : "disabled"}`;
  status.textContent = subscription.running ? "Live" : subscription.enabled ? "Queued" : "Off";
  return status;
}

function subscriptionSummaryText(
  totalCount: number,
  runningCount: number,
  disabledCount: number,
  label: string
): string {
  return [`${totalCount} ${label}`, `${runningCount} live`, disabledCount > 0 ? `${disabledCount} off` : null]
    .filter(Boolean)
    .join(" · ");
}

function emptyLine(message: string): HTMLElement {
  const empty = document.createElement("p");
  empty.className = "empty-line";
  empty.textContent = message;
  return empty;
}
