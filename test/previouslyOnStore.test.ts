import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PreviouslyOnStore } from "../src/previouslyOn/previouslyOnStore.js";

describe("PreviouslyOnStore", () => {
  it("stores direct and group continuity briefs separately", () => {
    const filePath = testStorePath();
    const store = new PreviouslyOnStore(filePath);

    store.update(
      {
        type: "kindroid.chat.changed",
        kinId: "kin-1",
        documentId: "kin-message",
        timestamp: "2026-06-01T12:00:00.000Z",
        text: "Recent direct message.",
        sender: "user",
        role: "user",
        source: "firestore"
      },
      {
        facts: ["Alexis noticed Bruce was exhausted."],
        inferredTone: "quiet and affectionate",
        suggestedOpeningFrame: "A small practical gesture, then one pointed question.",
        confidence: "high"
      }
    );
    store.update(
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-2",
        documentId: "group-message",
        timestamp: "2026-06-01T12:00:01.000Z",
        text: "Recent group message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      {
        recap: "The group left the hotel lobby mid-argument.",
        unresolvedThreads: ["Who has the room key?"],
        confidence: "medium"
      }
    );

    const reloaded = new PreviouslyOnStore(filePath);
    expect(reloaded.getForKin("kin-1")).toMatchObject({
      scope: "kin",
      kinId: "kin-1",
      sourceDocumentId: "kin-message",
      inferredTone: "quiet and affectionate"
    });
    expect(reloaded.getForGroup("group-1")).toMatchObject({
      scope: "group",
      groupId: "group-1",
      latestSpeakerKinId: "kin-2",
      sourceDocumentId: "group-message",
      recap: "The group left the hotel lobby mid-argument."
    });
  });

  it("ignores empty briefs", () => {
    const store = new PreviouslyOnStore(testStorePath());

    const updated = store.update(
      {
        type: "kindroid.chat.changed",
        kinId: "kin-1",
        documentId: "message-1",
        timestamp: null,
        text: "Recent direct message.",
        sender: "user",
        role: "user",
        source: "firestore"
      },
      {
        facts: ["   "],
        confidence: "high"
      }
    );

    expect(updated).toBeNull();
    expect(store.list()).toEqual([]);
  });
});

function testStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-previously-on-store-test-"));
  return path.join(dir, "previously-on-state.json");
}
