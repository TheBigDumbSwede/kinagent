import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatDynamismSuggestionStore } from "../src/chatDynamism/chatDynamismSuggestionStore.js";
import { GroupBackgroundSuggestionStore } from "../src/groupBackground/groupBackgroundSuggestionStore.js";
import { JournalSuggestionStore } from "../src/journal/journalSuggestionStore.js";

const tempDirs: string[] = [];

describe("suggestion history pruning", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes completed journal suggestions while preserving unresolved review items", () => {
    const filePath = tempFile("journal-suggestions.json");
    writeSuggestions(filePath, [
      suggestion("pending-new", "pending", "2026-06-10T00:00:00.000Z"),
      suggestion("invalidated-review", "source_invalidated", "2026-05-01T00:00:00.000Z"),
      suggestion("accepted-old", "accepted", "2026-04-01T00:00:00.000Z"),
      suggestion("dismissed-recent", "dismissed", "2026-06-09T00:00:00.000Z")
    ]);
    const store = new JournalSuggestionStore(filePath);

    expect(store.pruneCompleted({ maxAgeDays: 30, now: new Date("2026-06-11T00:00:00.000Z") })).toEqual({
      removed: 1,
      retained: 3
    });
    expect(
      store
        .list()
        .map((item) => item.id)
        .sort()
    ).toEqual(["dismissed-recent", "invalidated-review", "pending-new"]);
  });

  it("prunes completed group background suggestions while preserving pending proposals", () => {
    const filePath = tempFile("group-background-suggestions.json");
    writeSuggestions(filePath, [
      suggestion("pending-background", "pending", "2026-04-01T00:00:00.000Z"),
      suggestion("stale-old", "stale", "2026-04-01T00:00:00.000Z"),
      suggestion("dismissed-recent", "dismissed", "2026-06-09T00:00:00.000Z")
    ]);
    const store = new GroupBackgroundSuggestionStore(filePath, {
      minMessagesBetweenProposals: 1,
      minSignificance: 0.7
    });

    expect(store.pruneCompleted({ maxAgeDays: 30, now: new Date("2026-06-11T00:00:00.000Z") })).toEqual({
      removed: 1,
      retained: 2
    });
    expect(
      store
        .list()
        .map((item) => item.id)
        .sort()
    ).toEqual(["dismissed-recent", "pending-background"]);
  });

  it("caps completed chat dynamism suggestions by recency", () => {
    const filePath = tempFile("chat-dynamism-suggestions.json");
    writeSuggestions(filePath, [
      suggestion("pending-dynamism", "pending", "2026-04-01T00:00:00.000Z"),
      suggestion("accepted-new", "accepted", "2026-06-10T00:00:00.000Z"),
      suggestion("rejected-middle", "rejected", "2026-06-09T00:00:00.000Z"),
      suggestion("expired-old", "expired", "2026-06-08T00:00:00.000Z")
    ]);
    const store = new ChatDynamismSuggestionStore(filePath);

    expect(
      store.pruneCompleted({ maxAgeDays: 30, maxCompleted: 2, now: new Date("2026-06-11T00:00:00.000Z") })
    ).toEqual({
      removed: 1,
      retained: 3
    });
    expect(
      store
        .list()
        .map((item) => item.id)
        .sort()
    ).toEqual(["accepted-new", "pending-dynamism", "rejected-middle"]);
  });
});

function tempFile(fileName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-suggestion-prune-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

function writeSuggestions(filePath: string, suggestions: Array<Record<string, unknown>>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ suggestions }, null, 2)}\n`, "utf8");
}

function suggestion(id: string, status: string, updatedAt: string): Record<string, unknown> {
  return {
    id,
    status,
    createdAt: updatedAt,
    updatedAt
  };
}
