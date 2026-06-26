import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyTimelineEvents,
  exportTimelineEvents,
  loadTimelineEvents,
  renderTimelinePanel,
  timelineQueryFromElements,
  type TimelinePanelElements,
  type TimelinePanelState
} from "../src/desktop/renderer/timelinePanel.js";
import type { KinagentApi } from "../src/desktop/renderer/rendererTypes.js";

describe("timeline panel", () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
  });

  it("builds a compact query from non-empty filter controls", () => {
    const elements = timelineElements({
      type: "game.roll.resolved",
      sourceId: " group-1 ",
      from: "2026-06-20T10:00",
      to: "2026-06-21T10:00",
      limit: "25"
    });

    expect(timelineQueryFromElements(elements)).toEqual({
      type: "game.roll.resolved",
      sourceId: "group-1",
      from: "2026-06-20T10:00",
      to: "2026-06-21T10:00",
      limit: 25
    });
  });

  it("loads timeline events through the desktop bridge", async () => {
    const context = timelineContext({
      elements: timelineElements({ type: "browser_bridge.command.queued", limit: "10" })
    });

    await loadTimelineEvents(context);

    expect(context.api.listTimelineEvents).toHaveBeenCalledWith({
      type: "browser_bridge.command.queued",
      limit: 10
    });
    expect(context.state.timelineLoaded).toBe(true);
    expect(context.state.timelineEvents).toHaveLength(1);
    expect(context.state.timelineLoading).toBe(false);
  });

  it("copies the visible events as filtered JSON", async () => {
    const copied: string[] = [];
    const context = timelineContext({
      writeClipboard: async (text) => {
        copied.push(text);
      }
    });
    context.state.timelineEvents = [
      {
        id: "event-1",
        type: "game.roll.resolved",
        occurredAt: "2026-06-25T15:00:00.000Z",
        source: { kind: "group", id: "group-1" },
        payload: { total: 8 }
      }
    ];

    await copyTimelineEvents(context);

    expect(copied).toHaveLength(1);
    expect(JSON.parse(copied[0] ?? "{}")).toMatchObject({
      filters: { limit: 100 },
      events: [{ id: "event-1", type: "game.roll.resolved" }]
    });
    expect(context.state.timelineCopyStatus).toBe("Copied 1 event.");
  });

  it("exports with the current filters", async () => {
    const context = timelineContext({
      elements: timelineElements({ sourceId: "kin-1", limit: "50" })
    });

    await exportTimelineEvents(context);

    expect(context.api.exportTimelineEvents).toHaveBeenCalledWith({
      sourceId: "kin-1",
      limit: 50
    });
    expect(context.state.timelineExportStatus).toContain("Exported 1 event");
  });

  it("renders returned events with source and compact payload", () => {
    installFakeDocument();
    const context = timelineContext();
    context.state.timelineLoaded = true;
    context.state.timelineEvents = [
      {
        id: "event-1",
        type: "game.roll.resolved",
        occurredAt: "2026-06-25T15:00:00.000Z",
        source: { kind: "group", id: "group-1" },
        payload: { moveName: "Keep Your Nerve", total: 8 }
      }
    ];

    renderTimelinePanel(context);

    const renderedText = collectText(context.elements.timelineEventList as unknown as FakeElement);
    expect(context.elements.timelineStatusLine.textContent).toBe("1 event shown.");
    expect(renderedText).toContain("game.roll.resolved");
    expect(renderedText).toContain("group: group-1");
    expect(renderedText).toContain('"total": 8');
  });
});

function timelineContext(input: TimelineContextInput = {}) {
  const state: TimelinePanelState = {
    timelineEvents: [],
    timelineLoading: false,
    timelineLoaded: false,
    timelineError: null,
    timelineCopyStatus: null,
    timelineExportStatus: null
  };
  const elements = input.elements ?? timelineElements();
  const api = {
    listTimelineEvents: vi.fn(async () => ({
      ok: true,
      total: 1,
      events: [
        {
          id: "event-1",
          type: "browser_bridge.command.queued",
          occurredAt: "2026-06-25T15:00:00.000Z",
          source: { kind: "browser_bridge", id: "local-native-host" },
          payload: { commandType: "reload-kindroid" }
        }
      ]
    })),
    exportTimelineEvents: vi.fn(async () => ({
      ok: true,
      filePath: "C:\\temp\\timeline.json",
      exportedCount: 1
    }))
  } as unknown as Pick<KinagentApi, "listTimelineEvents" | "exportTimelineEvents">;

  return {
    state,
    elements,
    api,
    renderActivity: vi.fn(),
    writeClipboard: input.writeClipboard
  };
}

interface TimelineContextInput {
  elements?: TimelinePanelElements;
  writeClipboard?: (text: string) => Promise<void>;
}

function timelineElements(input: TimelineElementsInput = {}): TimelinePanelElements {
  return {
    timelineTypeInput: inputElement(input.type ?? ""),
    timelineSourceInput: inputElement(input.sourceId ?? ""),
    timelineFromInput: inputElement(input.from ?? ""),
    timelineToInput: inputElement(input.to ?? ""),
    timelineLimitInput: inputElement(input.limit ?? "100"),
    timelineRefreshButton: buttonElement(),
    timelineCopyButton: buttonElement(),
    timelineExportButton: buttonElement(),
    timelineStatusLine: textElement(),
    timelineEventList: new FakeElement("div") as unknown as HTMLElement
  } as unknown as TimelinePanelElements;
}

interface TimelineElementsInput {
  type?: string;
  sourceId?: string;
  from?: string;
  to?: string;
  limit?: string;
}

function inputElement(value: string) {
  return { value };
}

function buttonElement() {
  return { disabled: false };
}

function textElement() {
  return { textContent: "" };
}

function installFakeDocument(): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tagName: string) {
        return new FakeElement(tagName);
      }
    }
  });
}

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  disabled = false;

  constructor(readonly tagName: string) {}

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

function collectText(element: FakeElement): string {
  return [element.textContent, ...element.children.map(collectText)].filter(Boolean).join(" ");
}
