import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrewarmStateStore } from "../src/runtime/prewarmStateStore.js";

describe("PrewarmStateStore", () => {
  it("skips ready sources until the trigger watermark advances", () => {
    const store = testStore();
    const source = { scope: "kin" as const, id: "kin-1" };

    store.markReady("localScene", source, {
      documentId: "message-1",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(
      store.shouldPrewarm("localScene", source, {
        trigger: { documentId: "message-1", timestamp: "2026-06-01T12:00:00.000Z" }
      })
    ).toBe(false);
    expect(
      store.shouldPrewarm("localScene", source, {
        trigger: { documentId: "message-2", timestamp: "2026-06-01T12:00:01.000Z" }
      })
    ).toBe(true);
  });

  it("lets manual force bypass persisted ready state", () => {
    const store = testStore();
    const source = { scope: "group" as const, id: "group-1" };

    store.markReady("soundscape", source, {
      documentId: "message-1",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(store.shouldPrewarm("soundscape", source, { force: true })).toBe(true);
  });

  it("does not let one prewarm kind suppress another kind that is not ready", () => {
    const store = testStore();
    const source = { scope: "kin" as const, id: "kin-1" };

    store.markReady("soundscape", source, {
      documentId: "message-1",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(
      store.shouldPrewarm("localScene", source, {
        trigger: { documentId: "message-1", timestamp: "2026-06-01T12:00:00.000Z" }
      })
    ).toBe(true);
  });

  it("does not use another kind's watermark as the chat history cursor for an unready kind", () => {
    const store = testStore();
    const source = { scope: "kin" as const, id: "kin-1" };

    store.markReady("soundscape", source, {
      documentId: "message-10",
      timestamp: "2026-06-01T12:00:10.000Z"
    });

    expect(store.chatHistoryStartAfter("soundscape", source)).toBe(Date.parse("2026-06-01T12:00:10.000Z"));
    expect(store.chatHistoryStartAfter("localScene", source)).toBeUndefined();
  });

  it("tracks Previously On readiness independently", () => {
    const store = testStore();
    const source = { scope: "group" as const, id: "group-1" };

    store.markReady("previouslyOn", source, {
      documentId: "message-1",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(store.shouldPrewarm("previouslyOn", source, {})).toBe(false);
    expect(store.shouldPrewarm("soundscape", source, {})).toBe(true);
  });

  it("persists chat history catch-up cursors per prewarm kind", () => {
    const store = testStore();
    const source = { scope: "group" as const, id: "group-1" };

    store.markChatHistoryCursor("previouslyOn", source, 1_780_000_001_000);
    store.markChatHistoryCursor("localScene", source, 1_780_000_002_000);

    expect(store.get(source)).toMatchObject({
      previouslyOnChatHistoryCursorTimestamp: 1_780_000_001_000,
      localSceneChatHistoryCursorTimestamp: 1_780_000_002_000
    });
    expect(store.chatHistoryStartAfter("previouslyOn", source)).toBe(1_780_000_001_000);
    expect(store.chatHistoryStartAfter("localScene", source)).toBe(1_780_000_002_000);
  });

  it("persists readiness across store instances", () => {
    const filePath = testStorePath();
    const source = { scope: "kin" as const, id: "kin-1" };

    new PrewarmStateStore(filePath).markReady("soundscape", source, {
      documentId: "message-1",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(new PrewarmStateStore(filePath).shouldPrewarm("soundscape", source, {})).toBe(false);
  });
});

function testStore(): PrewarmStateStore {
  return new PrewarmStateStore(testStorePath());
}

function testStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-prewarm-store-test-"));
  return path.join(dir, "prewarm-state.json");
}
