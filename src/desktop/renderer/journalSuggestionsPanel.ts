import { formatTime } from "./formatters.js";
import type { JournalSuggestionSummary, KinSummary } from "./rendererTypes.js";

export interface JournalSuggestionsState {
  activeTab: string;
  selectedKinId: string | null;
  kins: KinSummary[];
  journalSuggestions: JournalSuggestionSummary[];
  journalSavingId: string | null;
  journalError: string | null;
}

export interface JournalSuggestionsElements {
  journalSuggestionPanel: HTMLElement;
  kinDetailTabs: HTMLElement;
}

export interface JournalSuggestionsContext {
  state: JournalSuggestionsState;
  elements: JournalSuggestionsElements;
  onAcceptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}

export function renderJournalSuggestions(context: JournalSuggestionsContext): void {
  const { state, elements } = context;
  const panel = elements.journalSuggestionPanel;
  panel.replaceChildren();
  const suggestions = selectedKinJournalSuggestions(state);
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
    panel.append(createJournalSuggestionElement(context, suggestion));
  }
}

export function renderJournalTabBadge(context: Pick<JournalSuggestionsContext, "state" | "elements">): void {
  const button = context.elements.kinDetailTabs.querySelector('[data-mode="journal"]');
  if (!button) {
    return;
  }

  const count = pendingJournalSuggestionCount(context.state);
  button.replaceChildren(document.createTextNode("Journal"));
  if (count > 0) {
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = String(count);
    button.append(badge);
  }
}

export function selectedKinJournalSuggestions(state: JournalSuggestionsState): JournalSuggestionSummary[] {
  if (!state.selectedKinId) {
    return [];
  }

  return state.journalSuggestions.filter((suggestion) => suggestion.aiId === state.selectedKinId);
}

export function pendingJournalSuggestionCount(state: JournalSuggestionsState): number {
  return state.selectedKinId ? selectedKinJournalSuggestions(state).length : state.journalSuggestions.length;
}

export function upsertJournalSuggestion(
  state: JournalSuggestionsState,
  suggestion: JournalSuggestionSummary | null | undefined
): void {
  if (!suggestion?.id) {
    return;
  }

  state.journalSuggestions = [
    suggestion,
    ...state.journalSuggestions.filter((current) => current.id !== suggestion.id)
  ];
}

export function journalSuggestionNotice(
  state: Pick<JournalSuggestionsState, "kins">,
  suggestion: JournalSuggestionSummary | null | undefined
): string {
  const selectedKin = state.kins.find((kin) => kin.aiId === suggestion?.aiId);
  return `Journal suggestion ready for ${selectedKin?.name || suggestion?.aiId || "Kin"}.`;
}

function createJournalSuggestionElement(
  context: JournalSuggestionsContext,
  suggestion: JournalSuggestionSummary
): HTMLElement {
  const item = document.createElement("article");
  const action = suggestionAction(suggestion);
  item.className = `journal-suggestion ${action}`;

  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.className = "journal-suggestion-heading";
  const title = document.createElement("strong");
  title.textContent = suggestion.title || (suggestion.strongEvent ? "Strong journal suggestion" : "Journal suggestion");
  const meta = document.createElement("div");
  meta.className = "journal-suggestion-meta";
  appendSuggestionBadge(meta, action === "delete" ? "Delete review" : "Create review");
  if (action === "create") {
    const bucketLabel = categoryLabel(suggestion.category);
    const detailLabel = categoryDetailLabel(suggestion.categoryDetail);
    appendSuggestionBadge(meta, bucketLabel);
    if (detailLabel && detailLabel !== bucketLabel) {
      appendSuggestionBadge(meta, detailLabel);
    }
  }
  if (suggestion.strongEvent) {
    appendSuggestionBadge(meta, "Strong event");
  }
  heading.append(title, meta);
  const date = document.createElement("span");
  date.textContent = formatTime(suggestion.createdAt);
  header.append(heading, date);

  const entry = document.createElement("p");
  entry.textContent =
    action === "delete"
      ? suggestion.targetJournalEntry || suggestion.targetJournalTitle || "Selected journal entry will be deleted."
      : suggestion.entry || "";

  const details = document.createElement("dl");
  if (action === "delete") {
    appendSuggestionDetail(details, "Target", suggestion.targetJournalTitle || suggestion.targetJournalEntryId);
  }
  appendSuggestionDetail(details, "Reason", suggestion.durabilityReason);
  appendSuggestionListDetail(details, "Evidence", suggestion.evidence || []);
  if (action === "create") {
    appendSuggestionListDetail(details, "Keyphrases", suggestion.keyphrases || []);
  }

  const actions = document.createElement("div");
  actions.className = "journal-suggestion-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent =
    context.state.journalSavingId === suggestion.id
      ? action === "delete"
        ? "Deleting"
        : "Accepting"
      : action === "delete"
        ? "Delete"
        : "Accept";
  accept.disabled = Boolean(context.state.journalSavingId);
  accept.addEventListener("click", () => {
    if (suggestion.id) {
      context.onAcceptSuggestion(suggestion.id);
    }
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = "Dismiss";
  dismiss.disabled = Boolean(context.state.journalSavingId);
  dismiss.addEventListener("click", () => {
    if (suggestion.id) {
      context.onDismissSuggestion(suggestion.id);
    }
  });

  actions.append(accept, dismiss);
  item.append(header, entry, details, actions);
  return item;
}

function appendSuggestionBadge(container: HTMLElement, label: string): void {
  if (!label) {
    return;
  }

  const badge = document.createElement("span");
  badge.className = "journal-suggestion-badge";
  badge.textContent = label;
  container.append(badge);
}

function appendSuggestionDetail(list: HTMLElement, label: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  list.append(term, detail);
}

function appendSuggestionListDetail(list: HTMLElement, label: string, values: unknown[]): void {
  const visibleValues = values.map((value) => String(value).trim()).filter(Boolean);
  if (visibleValues.length === 0) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  const valueList = document.createElement("ul");
  for (const value of visibleValues) {
    const item = document.createElement("li");
    item.textContent = value;
    valueList.append(item);
  }
  detail.append(valueList);
  list.append(term, detail);
}

function categoryLabel(category: string | null | undefined): string {
  const labels: Record<string, string> = {
    relationship_milestone: "Relationship milestone",
    world_capsule: "World capsule",
    behavior_callback: "Behavior callback",
    personal_fact: "Personal fact",
    resolved_conflict: "Resolved conflict",
    backstory_hook: "Backstory hook",
    important_decision: "Important decision",
    recurring_pattern: "Recurring pattern",
    other_durable_event: "Durable event"
  };
  return category ? labels[category] || "" : "";
}

function categoryDetailLabel(detail: string | null | undefined): string {
  return typeof detail === "string" ? detail.trim() : "";
}

function suggestionAction(suggestion: JournalSuggestionSummary): "create" | "delete" {
  return suggestion?.action === "delete" ? "delete" : "create";
}
