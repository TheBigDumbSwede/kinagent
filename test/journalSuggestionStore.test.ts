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
      expect.objectContaining({
        title: "Durable Event",
        category: "relationship_milestone",
        entry: "Eligible again."
      })
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

  it("rejects suggestions that only have generic keyphrases", () => {
    const store = testStore();

    expect(
      store.createPending(notification("doc-1"), {
        ...suggestionInput("A durable entry with weak trigger words."),
        keyphrases: ["memory", "important", "relationship"]
      })
    ).toBeNull();
  });

  it("preserves custom category labels as details under the catch-all bucket", () => {
    const store = testStore();

    expect(
      store.createPending(notification("doc-1"), {
        ...suggestionInput("Sam and the user established a shared Sunday ritual."),
        category: "shared_ritual",
        categoryDetail: "shared Sunday ritual",
        keyphrases: ["Sunday ritual", "shared breakfast"]
      })
    ).toEqual(
      expect.objectContaining({
        category: "other_durable_event",
        categoryDetail: "shared Sunday ritual"
      })
    );
  });

  it("stores reviewed deletion suggestions for existing journal entries", () => {
    const store = testStore();

    expect(
      store.createPendingDelete(notification("doc-1"), {
        title: "Remove outdated trust entry",
        targetJournalEntryId: "journal-1",
        targetJournalTitle: "Old Trust Concern",
        targetJournalEntry: "Sam still treats the old trust concern as unresolved.",
        evidence: ["Sam said the concern has been resolved."],
        durabilityReason: "Keeping the old entry would cause stale recall.",
        confidence: "high",
        strongEvent: false
      })
    ).toEqual(
      expect.objectContaining({
        action: "delete",
        aiId: "kin-1",
        targetJournalEntryId: "journal-1",
        targetJournalTitle: "Old Trust Concern",
        targetJournalEntry: "Sam still treats the old trust concern as unresolved."
      })
    );
  });

  it("marks pending suggestions stale when their source message is deleted", () => {
    const store = testStore();
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));
    const second = store.createPending(notification("doc-2"), {
      ...suggestionInput("Second durable event."),
      title: "Second Durable Event",
      keyphrases: ["second durable event"],
      strongEvent: true
    });

    expect(first).toEqual(expect.objectContaining({ status: "pending" }));
    expect(second).toEqual(expect.objectContaining({ status: "pending" }));
    const stale = store.markSourceDeleted({ documentId: "doc-1", aiId: "kin-1" });

    expect(stale).toEqual([
      expect.objectContaining({
        id: first?.id,
        status: "stale",
        staleReason: "Source chat message was deleted or rewound before review."
      })
    ]);
    expect(store.list("pending").map((suggestion) => suggestion.id)).toEqual([second?.id]);
    expect(store.list("stale").map((suggestion) => suggestion.id)).toEqual([first?.id]);
  });

  it("marks accepted suggestions source-invalidated when their source message is deleted", () => {
    const store = testStore();
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));
    if (!first) {
      throw new Error("Expected first suggestion.");
    }
    store.markAccepted(
      first.id,
      { ok: true },
      {
        id: "journal-1",
        created: "2026-06-01T12:01:00.000Z",
        resolvedAt: "2026-06-01T12:01:05.000Z"
      }
    );

    const changed = store.markSourceDeleted({ documentId: "doc-1", aiId: "kin-1" });

    expect(changed).toEqual([
      expect.objectContaining({
        id: first.id,
        status: "source_invalidated",
        sourceInvalidationReason: "Source chat message was deleted or rewound after this journal change was accepted."
      })
    ]);
    expect(store.list("accepted")).toEqual([]);
    expect(store.list("source_invalidated").map((suggestion) => suggestion.id)).toEqual([first.id]);
    expect(store.listReviewable().map((suggestion) => suggestion.id)).toEqual([first.id]);
  });

  it("removes remediated invalidated suggestions from the reviewable list", () => {
    const store = testStore();
    const first = store.createPending(notification("doc-1"), suggestionInput("First durable event."));
    if (!first) {
      throw new Error("Expected first suggestion.");
    }
    store.markAccepted(
      first.id,
      { ok: true },
      {
        id: "journal-1",
        created: "2026-06-01T12:01:00.000Z",
        resolvedAt: "2026-06-01T12:01:05.000Z"
      }
    );
    store.markSourceDeleted({ documentId: "doc-1", aiId: "kin-1" });

    expect(
      store.markRemediated(first.id, "delete_created_journal_entry", {
        ok: true,
        status: 200
      })
    ).toEqual(
      expect.objectContaining({
        id: first.id,
        status: "remediated",
        remediatedAt: expect.any(String),
        remediationAction: "delete_created_journal_entry",
        remediationResult: expect.objectContaining({ ok: true, status: 200 })
      })
    );
    expect(store.listReviewable()).toEqual([]);
  });

  it("rejects near-duplicates of accepted or captured journal entries", () => {
    const store = testStore();
    const first = store.createPending(
      notification("doc-1"),
      suggestionInput("Sam and the user resolved the old trust concern and agreed to treat it as history.")
    );
    if (!first) {
      throw new Error("Expected first suggestion.");
    }
    store.markAccepted(first.id, { ok: true });

    store.recordReadableMessage(notification("message-1", "ai"));
    expect(
      store.createPending(notification("doc-2"), {
        ...suggestionInput(
          "Sam and the user resolved the old trust concern, agreeing it now belongs to their history."
        ),
        strongEvent: true
      })
    ).toBeNull();

    for (let index = 0; index < journalSuggestionThrottleMessages; index += 1) {
      store.recordReadableMessage(notification(`message-${index + 2}`, "ai"));
    }
    expect(
      store.createPending(notification("doc-3"), {
        ...suggestionInput("Sam promised to keep the lighthouse key hidden from outsiders."),
        keyphrases: ["lighthouse key", "outsiders"],
        existingEntries: [
          {
            id: "journal-existing",
            title: "Hidden Lighthouse Key",
            entry: "Sam promised to keep the lighthouse key hidden from outsiders.",
            keyphrases: ["lighthouse key"]
          }
        ]
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
    category: "relationship_milestone" as const,
    keyphrases: ["old trust concern"],
    evidence: ["specific evidence"],
    durabilityReason: "This changes future interpretation.",
    confidence: "high" as const,
    strongEvent: false
  };
}
