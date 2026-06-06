import type { PreviouslyOnBriefSummary } from "./rendererTypes.js";

interface PrewarmCatchupSummary {
  chatHistoryCursorTimestamp?: number | null;
  updatedAt?: string | null;
}

export interface PreviouslyOnPanelInput {
  container: HTMLElement;
  title: string;
  brief: PreviouslyOnBriefSummary | null;
  catchup?: PrewarmCatchupSummary | null;
  refreshSaving: boolean;
  formatTimestamp: (value: string) => string;
  onRefresh: () => void;
}

export function renderPreviouslyOnPanel(input: PreviouslyOnPanelInput): void {
  const { container, title, brief, catchup, refreshSaving, formatTimestamp, onRefresh } = input;
  const catchupActive = Boolean(catchup?.chatHistoryCursorTimestamp);
  const catchupUpdatedAt = catchup?.updatedAt;
  container.hidden = false;
  container.replaceChildren();

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "secondary compact";
  refreshButton.textContent = refreshSaving ? "Refreshing" : catchupActive ? "Catching Up" : "Refresh Recap";
  refreshButton.disabled = refreshSaving || catchupActive;
  refreshButton.addEventListener("click", onRefresh);
  header.append(heading, refreshButton);
  container.append(header);

  if (catchupActive) {
    const notice = document.createElement("p");
    notice.className = "previously-on-catchup";
    notice.textContent = catchupUpdatedAt
      ? `Chat history catch-up is in progress. This can take a while for long histories. Last advanced ${formatTimestamp(catchupUpdatedAt)}.`
      : "Chat history catch-up is in progress. This can take a while for long histories.";
    container.append(notice);
  }

  if (!brief) {
    const empty = document.createElement("p");
    empty.className = "panel-note";
    empty.textContent = "No continuity recap has been generated for this source yet.";
    container.append(empty);
    return;
  }

  if (brief.recap) {
    const recap = document.createElement("p");
    recap.className = "previously-on-recap";
    recap.textContent = brief.recap;
    container.append(recap);
  }

  appendBriefList(container, "Known facts", stringItems(brief.facts));
  appendBriefLine(container, "Inferred tone", brief.inferredTone);
  appendBriefList(container, "Open threads", stringItems(brief.unresolvedThreads));
  appendBriefLine(container, "Suggested opening frame", brief.suggestedOpeningFrame);

  const meta = document.createElement("p");
  meta.className = "previously-on-meta";
  meta.textContent = [
    brief.updatedAt ? `Updated ${formatTimestamp(brief.updatedAt)}` : null,
    brief.confidence ? `Confidence ${brief.confidence}` : null
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta.textContent) {
    container.append(meta);
  }
}

function appendBriefLine(container: HTMLElement, label: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  const row = document.createElement("p");
  row.className = "previously-on-line";
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, value);
  container.append(row);
}

function appendBriefList(container: HTMLElement, label: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }
  const group = document.createElement("div");
  group.className = "previously-on-list";
  const heading = document.createElement("strong");
  heading.textContent = label;
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  group.append(heading, list);
  container.append(group);
}

function stringItems(values: unknown[] | null | undefined): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}
