import { formatTime, formatTimelineChange } from "./formatters.js";
import { createDiffLine, renderSelectedHistoryDiff } from "./timelineDiff.js";
import type {
  CapturedFieldSummary,
  CapturedHistoryEntry,
  CapturedKinSummary,
  DetailStat,
  KinSummary
} from "./rendererTypes.js";

export interface CapturedDetailState {
  selectedHistoryHash: string | null;
}

export interface CapturedDetailElements {
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  fieldContent: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  appSettingsForm: HTMLElement;
  voiceForm: HTMLElement;
  groupAudioPanel: HTMLElement;
  kinHermesForm: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  chatExportPanel: HTMLElement;
  timeline: HTMLElement;
  detailStats: HTMLElement;
  timelineList: HTMLElement;
}

export interface CapturedDetailContext {
  state: CapturedDetailState;
  elements: CapturedDetailElements;
  onSelectHistoryEntry: (hash: string | null) => void;
}

export interface CapturedDetailContent {
  content: string;
  history: CapturedHistoryEntry[];
  stats: DetailStat[];
}

export function renderDetailEmpty(context: Pick<CapturedDetailContext, "elements">, message: string): void {
  const { elements } = context;
  elements.kinDetailEmpty.hidden = false;
  elements.kinDetailEmpty.textContent = message;
  elements.kinDetailContent.hidden = true;
  elements.kinDetailContent.classList.remove("app-settings-content", "form-detail-content");
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
}

export function renderDetailContent(context: CapturedDetailContext, detail: CapturedDetailContent): void {
  const { state, elements } = context;
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "form-detail-content");
  elements.fieldContent.hidden = false;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = false;

  const selectedEntryIndex = detail.history.findIndex((entry) => entry.hash === state.selectedHistoryHash);
  const selectedEntry = selectedEntryIndex >= 0 ? detail.history[selectedEntryIndex] : null;
  const previousEntry = selectedEntryIndex >= 0 ? detail.history[selectedEntryIndex + 1] : null;

  renderFieldContent(elements.fieldContent, detail.content, selectedEntry, previousEntry);
  renderDetailStats(elements.detailStats, detail.stats, selectedEntry);
  renderTimeline(context, detail.history);
}

export function capturedDetailStats(input: {
  selectedKin?: KinSummary | null;
  selectedGroup?: { name?: string | null } | null;
  groupId?: string | null;
  field: CapturedFieldSummary | null;
  capture: CapturedKinSummary;
  fallbackSettingLabel: string;
}): DetailStat[] {
  const entityLabel = input.selectedGroup ? "Group" : "Kin";
  const entityValue =
    input.selectedGroup?.name || input.groupId || input.selectedKin?.name || input.capture.kinId || "Unknown";
  return [
    { label: entityLabel, value: entityValue },
    { label: "Capture", value: input.capture.folderName || "Unavailable" },
    { label: "Setting", value: input.field?.label || input.fallbackSettingLabel },
    { label: "Changes", value: String(input.field?.history?.length || 0) }
  ];
}

function renderFieldContent(
  container: HTMLElement,
  content: string,
  selectedEntry: CapturedHistoryEntry | null,
  previousEntry: CapturedHistoryEntry | null
): void {
  container.replaceChildren();

  if (!selectedEntry) {
    container.textContent = content;
    return;
  }

  for (const line of renderSelectedHistoryDiff(selectedEntry, previousEntry)) {
    container.append(createDiffLine(line));
  }
}

function renderDetailStats(
  container: HTMLElement,
  stats: DetailStat[],
  selectedEntry: CapturedHistoryEntry | null
): void {
  container.replaceChildren();
  const visibleStats = selectedEntry
    ? [...stats, { label: "Viewing", value: `${formatTime(selectedEntry.committedAt)} (${selectedEntry.shortHash})` }]
    : stats;

  for (const stat of visibleStats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    container.append(item);
  }
}

function renderTimeline(context: CapturedDetailContext, history: CapturedHistoryEntry[]): void {
  const { state, elements } = context;
  elements.timelineList.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No recorded changes for this setting.";
    elements.timelineList.append(empty);
    return;
  }

  for (const entry of history) {
    const hash = entry.hash || "";
    const item = document.createElement("button");
    item.type = "button";
    item.className = `timeline-entry${entry.hash === state.selectedHistoryHash ? " active" : ""}`;
    item.title = entry.subject || "";
    item.addEventListener("click", () => {
      context.onSelectHistoryEntry(state.selectedHistoryHash === hash ? null : hash);
    });

    const date = document.createElement("div");
    date.className = "timeline-date";
    date.textContent = formatTime(entry.committedAt);

    const summary = document.createElement("p");
    summary.textContent = entry.summary || "Captured value";

    const change = document.createElement("span");
    change.className = "timeline-change";
    change.textContent = formatTimelineChange(entry);

    const shortHash = document.createElement("span");
    shortHash.textContent = entry.shortHash || "";

    item.append(date, summary, change, shortHash);
    elements.timelineList.append(item);
  }
}
