import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JournalSuggestionStore, journalSuggestionThrottleMessages } from "../src/journal/journalSuggestionStore.js";

const tempDirs: string[] = [];

describe("JournalSuggestionStore", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows the first durable suggestion and throttles routine follow-up suggestions until 20 messages pass", () => {
    const store = testStore();
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));

    expect(first).toEqual(expect.objectContaining({ aiId: "kin-1", status: "pending" }));
    if (!first) {
      throw new Error("Expected first suggestion to be created.");
    }
    expect(store.createPending(notification("doc-2"), suggestionInput("Too soon."))).toBeNull();

    store.markDismissed(first.id);
    for (let index = 0; index < journalSuggestionThrottleMessages - 1; index += 1) {
      store.recordReadableMessage(notification(`message-${index}`, "ai"));
    }
    expect(store.createPending(notification("doc-3"), suggestionInput("Still too soon."))).toBeNull();

    store.recordReadableMessage(notification("user-message", "user"));
    expect(store.createPending(notification("doc-user"), suggestionInput("User messages do not count."))).toBeNull();

    store.recordReadableMessage(notification("message-20", "ai"));
    expect(store.createPending(notification("doc-4"), suggestionInput("Eligible again."))).toEqual(
      expect.objectContaining({ title: "Durable Event", entry: "Eligible again." })
    );
  });

  it("allows strong events before the normal message throttle has elapsed", () => {
    const store = testStore();
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));
    store.markDismissed(first?.id ?? "");

    expect(
      store.createPending(notification("doc-2"), {
        ...suggestionInput("Strong event."),
        strongEvent: true
      })
    ).toEqual(expect.objectContaining({ entry: "Strong event.", strongEvent: true }));
  });

  it("can disable strong event bypass", () => {
    const store = testStore({ strongEventBypass: false });
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));
    store.markDismissed(first?.id ?? "");

    expect(
      store.createPending(notification("doc-2"), {
        ...suggestionInput("Strong event."),
        strongEvent: true
      })
    ).toBeNull();
  });
});

function testStore(options: { strongEventBypass?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-journal-store-"));
  tempDirs.push(dir);
  return new JournalSuggestionStore(path.join(dir, "journal-suggestions.json"), {
    throttleMessages: journalSuggestionThrottleMessages,
    strongEventBypass: options.strongEventBypass ?? true
  });
}

function notification(documentId: string, sender: "user" | "ai" = "ai") {
  return {
    type: "kindroid.chat.changed" as const,
    kinId: "kin-1",
    documentId,
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Readable message.",
    sender,
    role: null,
    source: "firestore" as const
  };
}

function suggestionInput(entry: string) {
  return {
    title: "Durable Event",
    entry,
    keyphrases: ["milestone"],
    evidence: ["specific evidence"],
    durabilityReason: "This changes future interpretation.",
    confidence: "high" as const,
    strongEvent: false
  };
}
