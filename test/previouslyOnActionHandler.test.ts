import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PreviouslyOnActionHandler } from "../src/hermes/previouslyOnActionHandler.js";
import { PreviouslyOnStore } from "../src/previouslyOn/previouslyOnStore.js";
import type { Logger } from "../src/util/logger.js";

describe("PreviouslyOnActionHandler", () => {
  it("normalizes and stores direct and group brief actions", async () => {
    const store = testStore();
    const onUpdated = vi.fn();
    const handler = new PreviouslyOnActionHandler(testLogger, store, onUpdated);

    const directActions = handler.normalizeActions({
      actions: [
        {
          type: "update_previously_on_brief",
          ai_id: "kin-1",
          facts: ["Bruce was avoiding a difficult admission."],
          inferred_tone: "tender but evasive",
          unresolved_threads: ["Whether Bruce will say why he is tired."],
          suggested_opening_frame: "Alexis notices the deflection and makes tea.",
          confidence: "high"
        }
      ]
    });
    await handler.handle(
      {
        type: "kindroid.chat.changed",
        kinId: "kin-1",
        documentId: "message-1",
        timestamp: "2026-06-01T12:00:00.000Z",
        text: "Recent direct message.",
        sender: "user",
        role: "user",
        source: "firestore"
      },
      directActions[0]
    );

    const groupActions = handler.normalizeActions({
      actions: [
        {
          type: "update_group_previously_on_brief",
          group_id: "group-1",
          recap: "The group left the lobby with the room key still missing.",
          confidence: "medium"
        }
      ]
    });
    await handler.handle(
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-2",
        documentId: "message-2",
        timestamp: "2026-06-01T12:00:01.000Z",
        text: "Recent group message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      groupActions[0]
    );

    expect(store.getForKin("kin-1")?.inferredTone).toBe("tender but evasive");
    expect(store.getForGroup("group-1")?.recap).toBe("The group left the lobby with the room key still missing.");
    expect(onUpdated).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched direct ids", async () => {
    const store = testStore();
    const handler = new PreviouslyOnActionHandler(testLogger, store);
    const [action] = handler.normalizeActions({
      actions: [
        {
          type: "update_previously_on_brief",
          ai_id: "kin-other",
          facts: ["Something happened."]
        }
      ]
    });

    await handler.handle(
      {
        type: "kindroid.chat.changed",
        kinId: "kin-1",
        documentId: "message-1",
        timestamp: "2026-06-01T12:00:00.000Z",
        text: "Recent direct message.",
        sender: "user",
        role: "user",
        source: "firestore"
      },
      action
    );

    expect(store.getForKin("kin-1")).toBeNull();
  });
});

function testStore(): PreviouslyOnStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-previously-on-handler-test-"));
  return new PreviouslyOnStore(path.join(dir, "previously-on-state.json"));
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
