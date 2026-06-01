import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryDedupeStore } from "../src/state/dedupeStore.js";
import { SQLiteDedupeStore } from "../src/state/sqliteStore.js";

describe("InMemoryDedupeStore", () => {
  it("matches recent outbound messages by Kin and normalized text hash", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    const store = new InMemoryDedupeStore(10_000);

    const record = await store.recordOutbound({
      kinId: "kin-1",
      text: " Hello ",
      requestId: "request-1",
      idempotencyKey: "idem-1"
    });

    await expect(store.matchRecentOutbound({ kinId: "kin-1", text: "hello" })).resolves.toEqual({
      matched: true,
      record
    });
    await expect(store.matchRecentOutbound({ kinId: "kin-2", text: "hello" })).resolves.toEqual({ matched: false });
  });

  it("prunes messages outside the dedupe window", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    const store = new InMemoryDedupeStore(1_000);

    await store.recordOutbound({
      kinId: "kin-1",
      text: "hello",
      requestId: "request-1",
      idempotencyKey: "idem-1"
    });

    await expect(
      store.matchRecentOutbound({
        kinId: "kin-1",
        text: "hello",
        now: new Date("2026-06-01T12:00:02.000Z").getTime()
      })
    ).resolves.toEqual({ matched: false });
  });

  it("marks matched records as confirmed", async () => {
    const store = new InMemoryDedupeStore(10_000);
    const record = await store.recordOutbound({
      kinId: "kin-1",
      text: "hello",
      requestId: "request-1",
      idempotencyKey: "idem-1"
    });

    await store.confirm(record, 1780315200000);

    expect(record.confirmedAt).toBe(1780315200000);
  });
});

describe("SQLiteDedupeStore", () => {
  it("persists outbound dedupe records across store instances", async () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-dedupe-"));
    const dbPath = path.join(tempDir, "bridge.sqlite");

    const firstStore = await SQLiteDedupeStore.open(dbPath, 60);
    await firstStore.recordOutbound({
      kinId: "kin-1",
      text: "hello",
      requestId: "request-1",
      idempotencyKey: "idem-1"
    });

    const secondStore = await SQLiteDedupeStore.open(dbPath, 60);

    await expect(secondStore.matchRecentOutbound({ kinId: "kin-1", text: "hello" })).resolves.toMatchObject({
      matched: true,
      record: {
        kinId: "kin-1",
        requestId: "request-1",
        idempotencyKey: "idem-1"
      }
    });
  });
});
