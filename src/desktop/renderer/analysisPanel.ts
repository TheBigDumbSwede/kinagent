import type { AnalysisPanelElements, KinAnalysisProgress, PanelContext } from "./rendererTypes.js";

export async function analyzeSelectedKin(context: PanelContext<AnalysisPanelElements>): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!state.selectedKinId || state.kinAnalysisRunning) {
    return;
  }

  state.kinAnalysisRunning = true;
  state.kinAnalysisJobId = null;
  state.kinAnalysisReport = "";
  elements.kinAnalyzeProgress.hidden = false;
  elements.kinAnalyzeProgress.removeAttribute("value");
  elements.kinAnalyzeStatusLine.textContent = "Preparing Kin analysis.";
  elements.kinAnalyzeReport.hidden = true;
  elements.kinAnalyzeReport.replaceChildren();
  renderActivity();

  try {
    const result = await api.analyzeKin({ kinId: state.selectedKinId });
    state.kinAnalysisJobId = result.jobId || state.kinAnalysisJobId;
    state.kinAnalysisReport = result.reportMarkdown || "";
    renderMarkdownReport(elements.kinAnalyzeReport, state.kinAnalysisReport);
    elements.kinAnalyzeReport.hidden = !state.kinAnalysisReport;
    const findingCount = result.findingCount ?? 0;
    elements.kinAnalyzeStatusLine.textContent = `Analysis complete with ${findingCount} finding${
      findingCount === 1 ? "" : "s"
    }.`;
  } catch (error) {
    elements.kinAnalyzeStatusLine.textContent = errorMessage(error);
  } finally {
    state.kinAnalysisRunning = false;
    state.kinAnalysisJobId = null;
    elements.kinAnalyzeProgress.hidden = true;
    elements.kinAnalyzeProgress.value = 0;
    renderActivity();
  }
}

export function renderKinAnalysisProgress(
  context: Pick<PanelContext<AnalysisPanelElements>, "state" | "elements">,
  progress?: KinAnalysisProgress
): void {
  const { state, elements } = context;
  if (!progress || !state.kinAnalysisRunning) {
    return;
  }

  if (progress.jobId) {
    state.kinAnalysisJobId = progress.jobId;
  }
  if (progress.phase === "complete") {
    elements.kinAnalyzeProgress.hidden = true;
    elements.kinAnalyzeProgress.value = 0;
    elements.kinAnalyzeStatusLine.textContent = progress.message || "Analysis report ready.";
    return;
  }

  elements.kinAnalyzeProgress.hidden = false;
  elements.kinAnalyzeProgress.removeAttribute("value");
  elements.kinAnalyzeStatusLine.textContent = progress.message || "Running Kin analysis.";
}

export function renderMarkdownReport(container: HTMLElement, markdown: string): void {
  container.replaceChildren();
  const lines = String(markdown || "").split(/\r?\n/);
  let list: HTMLUListElement | null = null;

  const closeList = () => {
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const element = document.createElement(level === 1 ? "h2" : level === 2 ? "h3" : "h4");
      element.textContent = heading[2];
      container.append(element);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!list) {
        list = document.createElement("ul");
        container.append(list);
      }
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.append(item);
      continue;
    }

    closeList();
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.append(paragraph);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
