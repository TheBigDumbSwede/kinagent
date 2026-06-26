import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TimelineStore, normalizeTimelineEvent } from "../src/timeline/timelineStore.js";

describe("TimelineStore", () => {
  it("stores events chronologically and filters by type, source, and time range", () => {
    const store = new TimelineStore(testStorePath());

    const first = store.append({
      type: "browser_bridge.command.queued",
      occurredAt: "2026-06-01T12:00:00.000Z",
      source: { kind: "browser_bridge", id: "local-native-host" },
      payload: { commandId: "command-1", commandType: "reload-kindroid" }
    });
    const second = store.append({
      type: "game.roll.resolved",
      occurredAt: "2026-06-01T12:01:00.000Z",
      source: { kind: "group", id: "group-1", documentId: "doc-1" },
      payload: { moveId: "investigate", total: 8, outcome: "7-9" }
    });
    const third = store.append({
      type: "game.roll.resolved",
      occurredAt: "2026-06-01T12:02:00.000Z",
      source: { kind: "group", id: "group-2", documentId: "doc-2" },
      payload: { moveId: "act-under-pressure", total: 11, outcome: "10+" }
    });

    expect(store.list().map((event) => event.id)).toEqual([first.id, second.id, third.id]);
    expect(store.list({ type: "game.roll.resolved" }).map((event) => event.id)).toEqual([second.id, third.id]);
    expect(store.list({ sourceId: "group-1" }).map((event) => event.id)).toEqual([second.id]);
    expect(store.list({ sourceId: "doc-2" }).map((event) => event.id)).toEqual([third.id]);
    expect(
      store.list({
        from: "2026-06-01T12:00:30.000Z",
        to: "2026-06-01T12:01:30.000Z"
      })
    ).toEqual([second]);
  });

  it("retains the newest events while preserving chronological query order", () => {
    const store = new TimelineStore(testStorePath(), { maxEvents: 2 });

    store.append({ type: "app.status", occurredAt: "2026-06-01T12:00:00.000Z" });
    const second = store.append({ type: "app.status", occurredAt: "2026-06-01T12:01:00.000Z" });
    const third = store.append({ type: "app.status", occurredAt: "2026-06-01T12:02:00.000Z" });

    expect(store.list().map((event) => event.id)).toEqual([second.id, third.id]);
    expect(store.list({ limit: 1 })).toEqual([third]);
  });

  it("normalizes malformed persisted event data", () => {
    const filePath = testStorePath();
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        events: [
          null,
          { id: "bad-type", type: "missing", occurredAt: "2026-06-01T12:00:00.000Z" },
          { id: "bad-date", type: "app.status", occurredAt: "not-a-date" },
          {
            id: " valid-event ",
            type: "game.roll.resolved",
            occurredAt: "2026-06-01T12:00:00.000Z",
            source: { kind: "group", id: " group-1 ", documentId: " doc-1 " },
            payload: {
              message: "x".repeat(300),
              nested: { values: [1, " two ", Number.NaN, { ok: true }] }
            }
          }
        ]
      }),
      "utf8"
    );

    const events = new TimelineStore(filePath).list();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "valid-event",
      type: "game.roll.resolved",
      occurredAt: "2026-06-01T12:00:00.000Z",
      source: { kind: "group", id: "group-1", documentId: "doc-1" }
    });
    expect(events[0]?.payload?.message).toHaveLength(240);
    expect(events[0]?.payload?.nested).toEqual({ values: [1, "two", null, { ok: true }] });
  });

  it("rejects invalid standalone events during normalization", () => {
    expect(normalizeTimelineEvent({ id: "event-1", type: "unknown", occurredAt: new Date() })).toBeNull();
  });
});

function testStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-timeline-store-test-"));
  return path.join(dir, "timeline-events.json");
}
