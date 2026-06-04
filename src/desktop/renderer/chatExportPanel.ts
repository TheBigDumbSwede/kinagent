import type { ChatExportPanelElements, ChatExportProgress, PanelContext } from "./rendererTypes.js";

export async function exportSelectedChat(
  context: PanelContext<ChatExportPanelElements>,
  exportAll: boolean
): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if ((!state.selectedKinId && !state.selectedGroupId) || state.chatExportSaving) {
    return;
  }

  state.chatExportSaving = true;
  state.chatExportJobId = null;
  elements.chatExportProgress.hidden = false;
  elements.chatExportProgress.removeAttribute("value");
  elements.chatExportStatusLine.textContent = exportAll ? "Preparing full chat export." : "Preparing chat export.";
  renderActivity();

  try {
    const request = {
      fromDate: exportAll ? "" : elements.chatExportFromInput.value,
      toDate: exportAll ? "" : elements.chatExportToInput.value
    };
    const result = state.selectedGroupId
      ? await api.exportGroupChat({ ...request, groupId: state.selectedGroupId })
      : await api.exportKinChat({ ...request, kinId: state.selectedKinId ?? "" });
    state.chatExportJobId = result.jobId || state.chatExportJobId;
    if (result.ok) {
      elements.chatExportStatusLine.textContent = `Exported ${result.exportedCount ?? 0} chat entries to ${
        result.filePath ?? ""
      }.`;
    } else if (result.canceled) {
      elements.chatExportStatusLine.textContent = `Export prepared ${
        result.exportedCount ?? 0
      } chat entries; save was canceled.`;
    } else {
      elements.chatExportStatusLine.textContent = "Export did not complete.";
    }
  } catch (error) {
    elements.chatExportStatusLine.textContent = errorMessage(error);
  } finally {
    state.chatExportSaving = false;
    state.chatExportJobId = null;
    elements.chatExportProgress.hidden = true;
    elements.chatExportProgress.value = 0;
    renderActivity();
  }
}

export function renderChatExportProgress(
  context: Pick<PanelContext<ChatExportPanelElements>, "state" | "elements">,
  progress?: ChatExportProgress
): void {
  const { state, elements } = context;
  if (!progress || !state.chatExportSaving) {
    return;
  }

  if (progress.jobId) {
    state.chatExportJobId = progress.jobId;
  }
  if (progress.phase === "complete") {
    elements.chatExportProgress.hidden = true;
    elements.chatExportProgress.value = 0;
    elements.chatExportStatusLine.textContent = progress.message || "Transcript ready.";
    return;
  }

  elements.chatExportProgress.hidden = false;
  if (typeof progress.total === "number" && progress.total > 0) {
    elements.chatExportProgress.max = progress.total;
    elements.chatExportProgress.value = progress.processed || 0;
  } else {
    elements.chatExportProgress.removeAttribute("value");
  }
  elements.chatExportStatusLine.textContent = progress.message || "Exporting chat.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
