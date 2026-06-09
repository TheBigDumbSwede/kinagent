import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KindroidChatNotification } from "../src/firestore/types.js";
import { GroupBackgroundSuggestionStore } from "../src/groupBackground/groupBackgroundSuggestionStore.js";
import { GroupBackgroundActionHandler } from "../src/hermes/groupBackgroundActionHandler.js";
import type { Logger } from "../src/util/logger.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("GroupBackgroundActionHandler", () => {
  it("creates a pending group background prompt proposal", async () => {
    const store = testStore();
    const created: unknown[] = [];
    const handler = new GroupBackgroundActionHandler(testLogger, store, (suggestion) => created.push(suggestion), {
      contextProvider: async () => ({ enabledForSource: true, minSignificance: 0.7 })
    });

    await handler.handle(groupNotification("group-1"), {
      type: "propose_group_background_image",
      group_id: "group-1",
      title: "Foggy highway",
      target_current_scene: "Outside the diner, late night",
      scene_summary: "A lonely prairie highway under mist",
      visual_style: "cinematic noir",
      prompt: "Wide chat wallpaper of a foggy rural highway at night, no text, no characters.",
      negative_prompt: "text, logos, UI",
      reason: "The scene moved from a diner interior to the highway.",
      evidence: ["They leave the diner and step into the fog."],
      significance: 0.82,
      confidence: "high"
    });

    expect(created).toHaveLength(1);
    expect(store.list("pending")).toEqual([
      expect.objectContaining({
        groupId: "group-1",
        title: "Foggy highway",
        targetCurrentScene: "Outside the diner, late night",
        visualStyle: "cinematic noir",
        significance: 0.82,
        status: "pending"
      })
    ]);
  });

  it("ignores direct chat and mismatched group proposals", async () => {
    const store = testStore();
    const handler = new GroupBackgroundActionHandler(testLogger, store);

    await handler.handle(directNotification("kin-1"), validAction("group-1"));
    await handler.handle(groupNotification("group-1"), validAction("group-2"));

    expect(store.list()).toHaveLength(0);
  });

  it("enforces significance and pacing", async () => {
    const store = testStore({ minMessagesBetweenProposals: 2, minSignificance: 0.75 });
    const handler = new GroupBackgroundActionHandler(testLogger, store, undefined, {
      contextProvider: async () => ({ enabledForSource: true, minSignificance: 0.75 })
    });

    await handler.handle(groupNotification("group-1", "doc-low"), {
      ...validAction("group-1"),
      significance: 0.7
    });
    expect(store.list()).toHaveLength(0);

    store.recordReadableMessage(groupNotification("group-1", "doc-a"));
    store.recordReadableMessage(groupNotification("group-1", "doc-b"));
    await handler.handle(groupNotification("group-1", "doc-good"), validAction("group-1"));
    await handler.handle(groupNotification("group-1", "doc-duplicate"), {
      ...validAction("group-1"),
      title: "Another background"
    });

    expect(store.list("pending")).toHaveLength(1);
  });

  it("lets manual group background prewarm bypass pacing", async () => {
    const store = testStore({ minMessagesBetweenProposals: 12, minSignificance: 0.7 });
    const handler = new GroupBackgroundActionHandler(testLogger, store, undefined, {
      contextProvider: async () => ({ enabledForSource: true, minSignificance: 0.7 })
    });

    store.recordReadableMessage(groupNotification("group-1", "doc-a"));
    await handler.handle(forcedBackgroundPrewarmNotification("group-1", "doc-force"), validAction("group-1"));

    expect(store.list("pending")).toEqual([
      expect.objectContaining({
        groupId: "group-1",
        sourceDocumentId: "doc-force"
      })
    ]);
  });

  it("normalizes only high-confidence group background actions", () => {
    const store = testStore();
    const handler = new GroupBackgroundActionHandler(testLogger, store);

    expect(
      handler.normalizeActions({
        actions: [
          validAction("group-1"),
          { ...validAction("group-1"), confidence: "medium" },
          { ...validAction("group-1"), significance: "high" }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        type: "propose_group_background_image",
        group_id: "group-1",
        significance: 0.82,
        confidence: "high"
      })
    ]);
  });
});

function testStore(options = { minMessagesBetweenProposals: 0, minSignificance: 0.7 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-group-background-suggestions-"));
  tempDirs.push(dir);
  return new GroupBackgroundSuggestionStore(path.join(dir, "group-background-suggestions.json"), options);
}

function validAction(groupId: string) {
  return {
    type: "propose_group_background_image" as const,
    group_id: groupId,
    title: "Storm platform",
    target_current_scene: "At the train platform during a storm",
    scene_summary: "A rain-lashed empty platform",
    visual_style: "moody realistic",
    prompt: "Wide moody realistic chat wallpaper of an empty train platform during rain, no text.",
    negative_prompt: "text, logo",
    reason: "The group moved to a visually distinct exterior setting.",
    evidence: ["The platform lights flicker in the rain."],
    significance: 0.82,
    confidence: "high" as const
  };
}

function groupNotification(groupId: string, documentId = "doc-1"): KindroidChatNotification {
  return {
    type: "kindroid.group_chat.changed",
    groupId,
    aiId: "kin-1",
    documentId,
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Readable group message.",
    sender: "ai",
    role: null,
    source: "firestore"
  };
}

function directNotification(kinId: string): KindroidChatNotification {
  return {
    type: "kindroid.chat.changed",
    kinId,
    documentId: "doc-1",
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Readable Kin message.",
    sender: "ai",
    role: null,
    source: "firestore"
  };
}

function forcedBackgroundPrewarmNotification(groupId: string, documentId = "doc-1"): KindroidChatNotification {
  return {
    type: "kindroid.group_chat.changed",
    groupId,
    aiId: "kin-1",
    documentId,
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Current scene snapshot.",
    sender: "system",
    role: "group-background-prewarm",
    source: "group-background-prewarm",
    forceBackgroundProposal: true
  };
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
