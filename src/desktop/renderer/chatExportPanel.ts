import type {
  ChatExportPanelElements,
  ChatExportProgress,
  PanelContext,
  StorybookExportProgress,
  StorybookExportRequest,
  StorybookLength,
  StorybookOrganizationMode,
  StorybookQuoteMode
} from "./rendererTypes.js";

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

export async function generateSelectedStorybook(
  context: PanelContext<ChatExportPanelElements>,
  exportAll: boolean
): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if ((!state.selectedKinId && !state.selectedGroupId) || state.storybookSaving || state.chatExportSaving) {
    return;
  }

  if (!elements.storybookPrivacyInput.checked) {
    elements.storybookStatusLine.textContent = "Acknowledge the privacy warning before generating.";
    renderActivity();
    return;
  }

  state.storybookSaving = true;
  state.storybookJobId = null;
  state.storybookPreviewPath = null;
  elements.storybookProgress.hidden = false;
  elements.storybookProgress.removeAttribute("value");
  elements.storybookStatusLine.textContent = "Preparing Storybook preview.";
  renderActivity();

  try {
    const request = storybookRequest(context, exportAll);
    const result = await api.generateStorybook(request);
    state.storybookJobId = result.jobId || null;
    state.storybookPreviewPath = result.previewPath || null;
    if (result.ok) {
      elements.storybookStatusLine.textContent = storybookPreviewStatus(result);
    } else {
      elements.storybookStatusLine.textContent = "Storybook preview did not complete.";
    }
  } catch (error) {
    elements.storybookStatusLine.textContent = errorMessage(error);
  } finally {
    state.storybookSaving = false;
    elements.storybookProgress.hidden = true;
    elements.storybookProgress.value = 0;
    renderActivity();
  }
}

export async function saveStorybookPdf(context: PanelContext<ChatExportPanelElements>): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!state.storybookJobId || state.storybookSaving) {
    return;
  }

  state.storybookSaving = true;
  elements.storybookProgress.hidden = false;
  elements.storybookProgress.removeAttribute("value");
  elements.storybookStatusLine.textContent = "Saving Storybook PDF.";
  renderActivity();

  try {
    const result = await api.saveStorybookPdf({ jobId: state.storybookJobId });
    if (result.ok) {
      elements.storybookStatusLine.textContent = `Saved Storybook PDF to ${result.filePath ?? ""}.`;
    } else if (result.canceled) {
      elements.storybookStatusLine.textContent = "PDF save was canceled.";
    } else {
      elements.storybookStatusLine.textContent = "Storybook PDF did not save.";
    }
  } catch (error) {
    elements.storybookStatusLine.textContent = errorMessage(error);
  } finally {
    state.storybookSaving = false;
    elements.storybookProgress.hidden = true;
    elements.storybookProgress.value = 0;
    renderActivity();
  }
}

export function renderStorybookExportProgress(
  context: Pick<PanelContext<ChatExportPanelElements>, "state" | "elements">,
  progress?: StorybookExportProgress
): void {
  const { state, elements } = context;
  if (!progress || !state.storybookSaving) {
    return;
  }

  if (progress.jobId) {
    state.storybookJobId = progress.jobId;
  }

  elements.storybookProgress.hidden = false;
  if (typeof progress.total === "number" && progress.total > 0) {
    elements.storybookProgress.max = progress.total;
    elements.storybookProgress.value = progress.processed || 0;
  } else {
    elements.storybookProgress.removeAttribute("value");
  }
  elements.storybookStatusLine.textContent = progress.message || "Generating Storybook.";
}

function storybookRequest(context: PanelContext<ChatExportPanelElements>, exportAll: boolean): StorybookExportRequest {
  const { state, elements } = context;
  const request: StorybookExportRequest = {
    fromDate: exportAll ? "" : elements.chatExportFromInput.value,
    toDate: exportAll ? "" : elements.chatExportToInput.value,
    organizationMode: storybookOrganizationMode(elements.storybookOrganizationInput.value),
    length: storybookLength(elements.storybookLengthInput.value),
    style: elements.storybookStyleInput.value,
    quoteMode: storybookQuoteMode(elements.storybookQuoteModeInput.value)
  };

  if (state.selectedGroupId) {
    request.groupId = state.selectedGroupId;
  } else {
    request.kinId = state.selectedKinId ?? "";
  }

  return request;
}

function storybookPreviewStatus(result: {
  title?: string;
  chapterCount?: number;
  warningCount?: number;
  opened?: boolean;
  openError?: string;
}): string {
  const title = result.title ? `"${result.title}"` : "Storybook";
  const chapters = `${result.chapterCount ?? 0} chapter${result.chapterCount === 1 ? "" : "s"}`;
  const warnings =
    result.warningCount && result.warningCount > 0
      ? ` ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}.`
      : "";
  const preview = result.opened
    ? " Preview opened."
    : result.openError
      ? ` Preview saved but could not open: ${result.openError}.`
      : "";
  return `Prepared ${title} with ${chapters}.${warnings}${preview}`;
}

function storybookOrganizationMode(value: string): StorybookOrganizationMode {
  return value === "scene" || value === "day" || value === "event" ? value : "relationship_arc";
}

function storybookLength(value: string): StorybookLength {
  return value === "medium" ? "medium" : "compact";
}

function storybookQuoteMode(value: string): StorybookQuoteMode {
  return value === "direct_quotes" ? "direct_quotes" : "paraphrase_only";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
