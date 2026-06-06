import { renderMarkdownReport } from "./analysisPanel.js";
import type { DetailStat, GroupSummary, KinSummary } from "./rendererTypes.js";

export interface ActionPanelState {
  selectedKinId: string | null;
  selectedGroupId: string | null;
  kinAnalysisRunning: boolean;
  kinAnalysisReport: string;
  chatExportSaving: boolean;
}

export interface ActionPanelElements {
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  fieldContent: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  appSettingsForm: HTMLElement;
  voiceForm: HTMLElement;
  groupAudioPanel: HTMLElement;
  kinHermesForm: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  kinAnalyzeButton: HTMLButtonElement;
  kinAnalyzeReport: HTMLElement;
  chatExportPanel: HTMLElement;
  chatExportTitle: HTMLElement;
  chatExportDescription: HTMLElement;
  chatExportRangeButton: HTMLButtonElement;
  chatExportAllButton: HTMLButtonElement;
  timeline: HTMLElement;
  detailStats: HTMLElement;
}

export interface ActionPanelContext {
  state: ActionPanelState;
  elements: ActionPanelElements;
}

export function renderKinAnalyzeTab(context: ActionPanelContext, selectedKin: KinSummary | null): void {
  showActionPanel(context.elements, "analyze");
  context.elements.kinAnalyzeButton.disabled = context.state.kinAnalysisRunning;
  context.elements.kinAnalyzeReport.hidden = !context.state.kinAnalysisReport;
  renderMarkdownReport(context.elements.kinAnalyzeReport, context.state.kinAnalysisReport);
  renderActionStats(
    context.elements.detailStats,
    kinActionStats(context.state, selectedKin, "Analysis", context.state.kinAnalysisRunning ? "Running" : "Manual")
  );
}

export function renderKinExportTab(context: ActionPanelContext, selectedKin: KinSummary | null): void {
  showActionPanel(context.elements, "export");
  context.elements.chatExportTitle.textContent = "Export";
  context.elements.chatExportDescription.textContent = "Export decrypted direct chat history for this Kin.";
  context.elements.chatExportRangeButton.disabled = context.state.chatExportSaving;
  context.elements.chatExportAllButton.disabled = context.state.chatExportSaving;
  renderActionStats(context.elements.detailStats, kinActionStats(context.state, selectedKin, "Export", "Pending"));
}

export function renderGroupExportTab(context: ActionPanelContext, selectedGroup: GroupSummary | null): void {
  showActionPanel(context.elements, "export");
  context.elements.chatExportTitle.textContent = "Export Group";
  context.elements.chatExportDescription.textContent =
    "Export decrypted group chat history with Kin names resolved from message AI IDs.";
  context.elements.chatExportRangeButton.disabled = context.state.chatExportSaving;
  context.elements.chatExportAllButton.disabled = context.state.chatExportSaving;
  renderActionStats(context.elements.detailStats, groupActionStats(context.state, selectedGroup, "Export", "Pending"));
}

function showActionPanel(elements: ActionPanelElements, panel: "analyze" | "export"): void {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = panel !== "analyze";
  elements.chatExportPanel.hidden = panel !== "export";
  elements.timeline.hidden = true;
}

function kinActionStats(
  state: ActionPanelState,
  selectedKin: KinSummary | null,
  action: string,
  status: string
): DetailStat[] {
  return [
    { label: "Kin", value: selectedKin?.name || state.selectedKinId || "Unknown" },
    { label: "Action", value: action },
    { label: "Status", value: status },
    { label: "Mode", value: "Manual" }
  ];
}

function groupActionStats(
  state: ActionPanelState,
  selectedGroup: GroupSummary | null,
  action: string,
  status: string
): DetailStat[] {
  return [
    { label: "Group", value: selectedGroup?.name || state.selectedGroupId || "Unknown" },
    { label: "Action", value: action },
    { label: "Status", value: status },
    { label: "Mode", value: "Manual" }
  ];
}

function renderActionStats(container: HTMLElement, stats: DetailStat[]): void {
  container.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    container.append(item);
  }
}
