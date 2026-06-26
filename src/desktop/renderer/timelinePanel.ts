import type {
  KinagentApi,
  TimelineEventSummary,
  TimelineExportResult,
  TimelineListResult,
  TimelineQueryRequest
} from "./rendererTypes.js";

export interface TimelinePanelState {
  timelineEvents: TimelineEventSummary[];
  timelineLoading: boolean;
  timelineLoaded: boolean;
  timelineError: string | null;
  timelineCopyStatus: string | null;
  timelineExportStatus: string | null;
}

export interface TimelinePanelElements {
  timelineTypeInput: HTMLSelectElement;
  timelineSourceInput: HTMLInputElement;
  timelineFromInput: HTMLInputElement;
  timelineToInput: HTMLInputElement;
  timelineLimitInput: HTMLInputElement;
  timelineRefreshButton: HTMLButtonElement;
  timelineCopyButton: HTMLButtonElement;
  timelineExportButton: HTMLButtonElement;
  timelineStatusLine: HTMLElement;
  timelineEventList: HTMLElement;
}

export interface TimelinePanelContext {
  state: TimelinePanelState;
  elements: TimelinePanelElements;
  api: Pick<KinagentApi, "listTimelineEvents" | "exportTimelineEvents">;
  renderActivity: () => void;
  writeClipboard?: (text: string) => Promise<void>;
}

export function timelineQueryFromElements(elements: TimelinePanelElements): TimelineQueryRequest {
  const type = elements.timelineTypeInput.value.trim();
  const sourceId = elements.timelineSourceInput.value.trim();
  const from = elements.timelineFromInput.value.trim();
  const to = elements.timelineToInput.value.trim();
  const limit = Number(elements.timelineLimitInput.value);
  return {
    ...(type ? { type } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(Number.isInteger(limit) && limit > 0 ? { limit } : {})
  };
}

export async function loadTimelineEvents(context: TimelinePanelContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (state.timelineLoading) {
    return;
  }

  state.timelineLoading = true;
  state.timelineError = null;
  state.timelineCopyStatus = null;
  state.timelineExportStatus = null;
  elements.timelineStatusLine.textContent = "Loading timeline.";
  renderActivity();

  try {
    const result: TimelineListResult = await api.listTimelineEvents(timelineQueryFromElements(elements));
    state.timelineEvents = result.events ?? [];
    state.timelineLoaded = true;
  } catch (error) {
    state.timelineError = errorMessage(error);
  } finally {
    state.timelineLoading = false;
    renderActivity();
  }
}

export async function copyTimelineEvents(context: TimelinePanelContext): Promise<void> {
  const { state, renderActivity } = context;
  if (state.timelineLoading) {
    return;
  }

  try {
    await writeClipboardText(
      context,
      JSON.stringify(
        {
          copiedAt: new Date().toISOString(),
          filters: timelineQueryFromElements(context.elements),
          events: state.timelineEvents
        },
        null,
        2
      )
    );
    state.timelineCopyStatus = `Copied ${state.timelineEvents.length} event${state.timelineEvents.length === 1 ? "" : "s"}.`;
    state.timelineError = null;
  } catch (error) {
    state.timelineCopyStatus = null;
    state.timelineError = errorMessage(error);
  }
  renderActivity();
}

export async function exportTimelineEvents(context: TimelinePanelContext): Promise<void> {
  const { state, api, renderActivity } = context;
  if (state.timelineLoading) {
    return;
  }

  state.timelineExportStatus = "Choosing timeline export path.";
  renderActivity();

  try {
    const result: TimelineExportResult = await api.exportTimelineEvents(timelineQueryFromElements(context.elements));
    if (result.ok) {
      state.timelineExportStatus = `Exported ${result.exportedCount ?? 0} event${
        result.exportedCount === 1 ? "" : "s"
      } to ${result.filePath ?? ""}.`;
      state.timelineError = null;
    } else if (result.canceled) {
      state.timelineExportStatus = `Export prepared ${result.exportedCount ?? 0} event${
        result.exportedCount === 1 ? "" : "s"
      }; save was canceled.`;
    } else {
      state.timelineExportStatus = "Timeline export did not complete.";
    }
  } catch (error) {
    state.timelineError = errorMessage(error);
  }
  renderActivity();
}

export function renderTimelinePanel(context: Pick<TimelinePanelContext, "state" | "elements">): void {
  const { state, elements } = context;
  elements.timelineRefreshButton.disabled = state.timelineLoading;
  elements.timelineCopyButton.disabled = state.timelineLoading || state.timelineEvents.length === 0;
  elements.timelineExportButton.disabled = state.timelineLoading || state.timelineEvents.length === 0;

  if (state.timelineLoading) {
    elements.timelineStatusLine.textContent = "Loading timeline.";
  } else if (state.timelineError) {
    elements.timelineStatusLine.textContent = state.timelineError;
  } else if (state.timelineCopyStatus) {
    elements.timelineStatusLine.textContent = state.timelineCopyStatus;
  } else if (state.timelineExportStatus) {
    elements.timelineStatusLine.textContent = state.timelineExportStatus;
  } else if (!state.timelineLoaded) {
    elements.timelineStatusLine.textContent = "Timeline has not been loaded yet.";
  } else {
    elements.timelineStatusLine.textContent = `${state.timelineEvents.length} event${
      state.timelineEvents.length === 1 ? "" : "s"
    } shown.`;
  }

  if (!state.timelineLoaded && state.timelineEvents.length === 0) {
    elements.timelineEventList.replaceChildren(emptyState("Load the local timeline to inspect recent events."));
    return;
  }

  if (state.timelineEvents.length === 0) {
    elements.timelineEventList.replaceChildren(emptyState("No timeline events match these filters."));
    return;
  }

  elements.timelineEventList.replaceChildren(...state.timelineEvents.map(renderTimelineEvent));
}

function renderTimelineEvent(event: TimelineEventSummary): HTMLElement {
  const article = document.createElement("article");
  article.className = "timeline-event";

  const header = document.createElement("header");
  const title = document.createElement("div");
  title.className = "timeline-event-title";
  const type = document.createElement("strong");
  type.textContent = event.type;
  const time = document.createElement("span");
  time.textContent = formatEventTime(event.occurredAt);
  title.append(type, time);

  const source = document.createElement("span");
  source.className = "timeline-source";
  source.textContent = sourceLabel(event);
  header.append(title, source);

  const payload = document.createElement("pre");
  payload.className = "timeline-payload";
  payload.textContent = compactPayload(event.payload);

  article.append(header, payload);
  return article;
}

function emptyState(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "timeline-empty";
  element.textContent = message;
  return element;
}

function sourceLabel(event: TimelineEventSummary): string {
  const source = event.source;
  if (!source) {
    return "source: unknown";
  }
  const id = source.id || source.documentId;
  return id ? `${source.kind ?? "source"}: ${id}` : `${source.kind ?? "source"}`;
}

function compactPayload(payload: TimelineEventSummary["payload"]): string {
  if (!payload || Object.keys(payload).length === 0) {
    return "{}";
  }
  const text = JSON.stringify(payload, null, 2);
  return text.length > 1600 ? `${text.slice(0, 1600)}\n...` : text;
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function writeClipboardText(context: TimelinePanelContext, text: string): Promise<void> {
  if (context.writeClipboard) {
    await context.writeClipboard(text);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard access is not available.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
