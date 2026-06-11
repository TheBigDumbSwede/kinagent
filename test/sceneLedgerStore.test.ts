import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import {
  maxSceneLedgerFactsPerSource,
  normalizeSceneLedgerFactInput,
  normalizeSceneLedgerFactKind,
  SceneLedgerStore,
  sceneLedgerPath
} from "../src/localScene/sceneLedgerStore.js";

describe("SceneLedgerStore", () => {
  it("persists normalized scene facts per Kin source", () => {
    const config = testConfig();
    const store = SceneLedgerStore.fromConfig(config);

    const fact = store.upsertFact(
      { scope: "kin", kinId: " kin-1 " },
      {
        kind: "Setting",
        value: "  rainy apartment kitchen  ",
        confidence: "high",
        reviewStatus: "reviewed",
        provenance: {
          sourceType: "Hermes",
          sourceDocumentId: " message-1 ",
          sourceTimestamp: "2026-06-01T12:00:00-05:00",
          evidence: [" coffee on the counter ", "coffee on the counter"]
        }
      },
      { now: "2026-06-01T17:00:10.000Z" }
    );

    expect(fact).toMatchObject({
      id: "kin:kin-1:location:rainy-apartment-kitchen",
      layer: "scene_state",
      kind: "location",
      value: "rainy apartment kitchen",
      confidence: "high",
      reviewStatus: "reviewed",
      status: "active",
      firstObservedAt: "2026-06-01T17:00:00.000Z",
      lastObservedAt: "2026-06-01T17:00:00.000Z",
      provenance: {
        sourceType: "hermes_action",
        sourceDocumentId: "message-1",
        sourceTimestamp: "2026-06-01T17:00:00.000Z",
        evidence: ["coffee on the counter"]
      }
    });

    const reloaded = new SceneLedgerStore(sceneLedgerPath(config));
    expect(reloaded.getForKin("kin-1")).toMatchObject({
      sourceKey: "kin:kin-1",
      scope: "kin",
      kinId: "kin-1",
      sceneStartedAt: "2026-06-01T17:00:10.000Z",
      updatedAt: "2026-06-01T17:00:10.000Z",
      facts: [expect.objectContaining({ kind: "location", value: "rainy apartment kitchen" })]
    });
  });

  it("keeps group and Kin ledgers separate", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());

    store.upsertFact({ scope: "kin", kinId: "kin-1" }, { kind: "location", value: "library" });
    store.upsertFact({ scope: "group", groupId: "group-1" }, { kind: "location", value: "engine bay" });

    expect(store.getForKin("kin-1")).toMatchObject({
      sourceKey: "kin:kin-1",
      facts: [expect.objectContaining({ value: "library" })]
    });
    expect(store.getForGroup("group-1")).toMatchObject({
      sourceKey: "group:group-1",
      facts: [expect.objectContaining({ value: "engine bay" })]
    });
  });

  it("updates an existing fact with the same stable id", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());

    const first = store.upsertFact(
      { scope: "group", groupId: "group-1" },
      { kind: "tone", value: "uneasy", confidence: "low" },
      { now: "2026-06-01T17:00:00.000Z" }
    );
    const second = store.upsertFact(
      { scope: "group", groupId: "group-1" },
      { kind: "tone", value: "uneasy", confidence: "high", reason: "Repeated by two participants." },
      { now: "2026-06-01T17:05:00.000Z" }
    );

    expect(second?.id).toBe(first?.id);
    expect(store.getForGroup("group-1")?.facts).toEqual([
      expect.objectContaining({
        id: first?.id,
        confidence: "high",
        createdAt: "2026-06-01T17:00:00.000Z",
        updatedAt: "2026-06-01T17:05:00.000Z",
        reason: "Repeated by two participants."
      })
    ]);
  });

  it("replaces facts for a source while keeping the scene start timestamp", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());

    store.upsertFact(
      { scope: "kin", kinId: "kin-1" },
      { kind: "location", value: "library" },
      { now: "2026-06-01T17:00:00.000Z" }
    );
    const replaced = store.replaceFacts(
      { scope: "kin", kinId: "kin-1" },
      [
        { kind: "location", value: "archive basement" },
        { kind: "object", value: "brass key" },
        { kind: "object", value: "" }
      ],
      { now: "2026-06-01T17:10:00.000Z" }
    );

    expect(replaced.sceneStartedAt).toBe("2026-06-01T17:00:00.000Z");
    expect(replaced.updatedAt).toBe("2026-06-01T17:10:00.000Z");
    expect(replaced.facts.map((fact) => [fact.kind, fact.value])).toEqual([
      ["location", "archive basement"],
      ["object", "brass key"]
    ]);
  });

  it("caps facts per source on upsert with most recent facts retained", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());

    for (let index = 0; index < maxSceneLedgerFactsPerSource + 5; index += 1) {
      store.upsertFact(
        { scope: "kin", kinId: "kin-1" },
        { kind: "object", value: `prop ${index}` },
        { now: `2026-06-01T17:${String(index).padStart(2, "0")}:00.000Z` }
      );
    }

    const facts = store.getForKin("kin-1")?.facts ?? [];
    expect(facts).toHaveLength(maxSceneLedgerFactsPerSource);
    expect(facts[0]).toMatchObject({ value: `prop ${maxSceneLedgerFactsPerSource + 4}` });
    expect(facts.at(-1)).toMatchObject({ value: "prop 5" });
  });

  it("caps facts per source when replacing a ledger", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());
    const replaced = store.replaceFacts(
      { scope: "group", groupId: "group-1" },
      Array.from({ length: maxSceneLedgerFactsPerSource + 3 }, (_value, index) => ({
        kind: "participant",
        value: `participant ${index}`
      }))
    );

    expect(replaced.facts).toHaveLength(maxSceneLedgerFactsPerSource);
    expect(replaced.facts.at(-1)).toMatchObject({ value: `participant ${maxSceneLedgerFactsPerSource - 1}` });
  });

  it("marks an existing fact stale and leaves missing facts untouched", () => {
    const store = SceneLedgerStore.fromConfig(testConfig());
    const fact = store.upsertFact(
      { scope: "group", groupId: "group-1" },
      { kind: "unresolved_thread", value: "who moved the server logs" },
      { now: "2026-06-01T17:00:00.000Z" }
    );

    expect(
      store.markFactStale({ scope: "group", groupId: "group-1" }, fact!.id, {
        reason: "Solved in chat.",
        now: "2026-06-01T17:20:00.000Z"
      })
    ).toMatchObject({
      id: fact!.id,
      status: "stale",
      reason: "Solved in chat.",
      updatedAt: "2026-06-01T17:20:00.000Z"
    });
    expect(store.markFactStale({ scope: "group", groupId: "group-1" }, "missing")).toBeNull();
  });

  it("returns empty state for missing or corrupt files", () => {
    const config = testConfig();
    const filePath = sceneLedgerPath(config);
    const store = new SceneLedgerStore(filePath);

    expect(store.list()).toEqual([]);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not json", "utf8");

    expect(store.list()).toEqual([]);
    expect(store.getForKin("kin-1")).toBeNull();
  });

  it("normalizes fact kinds and rejects empty facts", () => {
    expect(normalizeSceneLedgerFactKind("open beat")).toBe("unresolved_thread");
    expect(normalizeSceneLedgerFactKind("mood")).toBe("tone");
    expect(normalizeSceneLedgerFactInput({ kind: "location", value: "" }, { sourceKey: "kin:kin-1" })).toBeNull();
  });
});

function testConfig(): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-scene-ledger-"));
  return {
    kindroid: {
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: path.join(tempDir, "kinagent.log"),
      logLevel: "info",
      sessionDir: path.join(tempDir, "browser-session"),
      sqlitePath: path.join(tempDir, "bridge.sqlite")
    },
    hermes: {
      enabled: true,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "test-key",
      agentId: "kindroid-bridge",
      currentSceneUpdates: {
        enabled: true,
        maxLength: 160
      },
      journalSuggestions: {
        enabled: true,
        throttleMessages: 20,
        strongEventBypass: true
      },
      groupBackgrounds: {
        suggestions: {
          enabled: true,
          autonomous: false,
          minMessagesBetweenProposals: 12,
          minSignificance: 0.7
        },
        images: {
          enabled: true,
          provider: "openai",
          openai: {
            apiKey: "",
            model: "gpt-image-1",
            size: "1536x1024",
            quality: "medium"
          }
        }
      },
      chatDynamism: {
        suggestions: {
          enabled: true
        },
        autoAdjust: {
          enabled: false,
          minTurnsBetweenAdjustments: 12,
          min: 0.8,
          max: 1.4,
          maxDelta: 0.2
        }
      }
    },
    voice: {
      enabled: false,
      provider: "none",
      openai: {
        apiKey: "",
        model: "gpt-4o-mini-tts",
        voice: "marin",
        instructions: ""
      },
      elevenlabs: {
        apiKey: "",
        model: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128"
      }
    }
  };
}
