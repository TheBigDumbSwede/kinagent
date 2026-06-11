import { describe, expect, it, vi } from "vitest";
import {
  generateImportedStorybook,
  generateSelectedStorybook,
  renderStorybookExportProgress
} from "../src/desktop/renderer/chatExportPanel.js";
import type { ChatExportPanelElements, KinagentApi, PanelState } from "../src/desktop/renderer/rendererTypes.js";

describe("chat export panel Storybook controls", () => {
  it("requires privacy acknowledgement before generating a Storybook", async () => {
    const context = storybookContext({ privacyAccepted: false });

    await generateSelectedStorybook(context, false);

    expect(context.api.generateStorybook).not.toHaveBeenCalled();
    expect(context.elements.storybookStatusLine.textContent).toBe("Acknowledge the privacy warning before generating.");
  });

  it("sends selected source, range, and Storybook options to the desktop bridge", async () => {
    const context = storybookContext({
      selectedGroupId: "group-1",
      fromDate: "2026-06-01",
      toDate: "2026-06-10",
      organizationMode: "event",
      length: "medium",
      style: "episode guide",
      quoteMode: "direct_quotes"
    });

    await generateSelectedStorybook(context, false);

    expect(context.api.generateStorybook).toHaveBeenCalledWith({
      groupId: "group-1",
      fromDate: "2026-06-01",
      toDate: "2026-06-10",
      organizationMode: "event",
      length: "medium",
      style: "episode guide",
      quoteMode: "direct_quotes"
    });
    expect(context.state.storybookJobId).toBe("job-1");
    expect(context.state.storybookPreviewPath).toBe("C:\\temp\\storybook.html");
    expect(context.elements.storybookStatusLine.textContent).toContain('Prepared "Quiet Turns" with 2 chapters.');
  });

  it("renders Storybook progress without a determinate value until total work is known", () => {
    const context = storybookContext();
    context.state.storybookSaving = true;

    renderStorybookExportProgress(context, {
      jobId: "job-2",
      stage: "outline",
      processed: 0,
      message: "Creating storybook outline."
    });

    expect(context.state.storybookJobId).toBe("job-2");
    expect(context.elements.storybookProgress.hidden).toBe(false);
    expect(context.elements.storybookProgress.removedValue).toBe(true);
    expect(context.elements.storybookStatusLine.textContent).toBe("Creating storybook outline.");
  });

  it("imports an external transcript with Storybook options but no selected source", async () => {
    const context = storybookContext({
      selectedKinId: null,
      organizationMode: "day",
      style: "warm memoir"
    });

    await generateImportedStorybook(context);

    expect(context.api.importStorybookTranscript).toHaveBeenCalledWith({
      organizationMode: "day",
      length: "compact",
      style: "warm memoir",
      quoteMode: "paraphrase_only"
    });
    expect(context.state.storybookJobId).toBe("import-job-1");
    expect(context.elements.storybookStatusLine.textContent).toContain(
      "Imported 4 messages as kinagent-markdown (high confidence)."
    );
  });
});

function storybookContext(input: StorybookContextInput = {}) {
  const state: PanelState = {
    selectedKinId: input.selectedKinId === null ? null : input.selectedGroupId ? null : "kin-1",
    selectedGroupId: input.selectedGroupId ?? null,
    kinAnalysisRunning: false,
    kinAnalysisJobId: null,
    kinAnalysisReport: "",
    chatExportSaving: false,
    chatExportJobId: null,
    storybookSaving: false,
    storybookJobId: null,
    storybookPreviewPath: null
  };
  const elements = {
    chatExportFromInput: inputElement(input.fromDate ?? ""),
    chatExportToInput: inputElement(input.toDate ?? ""),
    chatExportProgress: progressElement(),
    chatExportStatusLine: textElement(),
    storybookOrganizationInput: inputElement(input.organizationMode ?? "relationship_arc"),
    storybookLengthInput: inputElement(input.length ?? "compact"),
    storybookStyleInput: inputElement(input.style ?? "literary chronicle"),
    storybookQuoteModeInput: inputElement(input.quoteMode ?? "paraphrase_only"),
    storybookPrivacyInput: checkboxElement(input.privacyAccepted ?? true),
    storybookGenerateButton: buttonElement(),
    storybookImportButton: buttonElement(),
    storybookSavePdfButton: buttonElement(),
    storybookProgress: progressElement(),
    storybookStatusLine: textElement()
  } as unknown as ChatExportPanelElements & { storybookProgress: FakeProgressElement };
  const api = {
    generateStorybook: vi.fn(async () => ({
      ok: true,
      jobId: "job-1",
      previewPath: "C:\\temp\\storybook.html",
      title: "Quiet Turns",
      chapterCount: 2,
      warningCount: 0,
      opened: true
    })),
    importStorybookTranscript: vi.fn(async () => ({
      ok: true,
      jobId: "import-job-1",
      previewPath: "C:\\temp\\imported-storybook.html",
      title: "Imported Story",
      chapterCount: 1,
      warningCount: 0,
      opened: true,
      parserFormat: "kinagent-markdown",
      parserConfidence: "high",
      importedMessageCount: 4
    })),
    saveStorybookPdf: vi.fn()
  } as unknown as KinagentApi;

  return {
    state,
    elements,
    api,
    renderActivity: vi.fn()
  };
}

interface StorybookContextInput {
  selectedKinId?: string | null;
  selectedGroupId?: string;
  fromDate?: string;
  toDate?: string;
  organizationMode?: string;
  length?: string;
  style?: string;
  quoteMode?: string;
  privacyAccepted?: boolean;
}

interface FakeProgressElement {
  hidden: boolean;
  value: number;
  max: number;
  removedValue: boolean;
  removeAttribute(name: string): void;
}

function textElement() {
  return { textContent: "", hidden: false };
}

function inputElement(value: string) {
  return { value };
}

function checkboxElement(checked: boolean) {
  return { checked };
}

function buttonElement() {
  return { disabled: false };
}

function progressElement(): FakeProgressElement {
  return {
    hidden: true,
    value: 0,
    max: 100,
    removedValue: false,
    removeAttribute(name: string) {
      if (name === "value") {
        this.removedValue = true;
      }
    }
  };
}
