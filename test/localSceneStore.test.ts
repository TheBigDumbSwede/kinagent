import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { LocalSceneStateStore, localSceneStatePath } from "../src/localScene/localSceneStore.js";

describe("LocalSceneStateStore", () => {
  it("stores and merges local scene metadata per Kin", () => {
    const config = testConfig();
    const store = LocalSceneStateStore.fromConfig(config);

    const first = store.update(directNotification("doc-1"), {
      location: " rainy apartment kitchen ",
      mood: "quiet",
      tension: 1.4,
      evidence: [" Coffee is still on the counter. "]
    });
    const second = store.update(directNotification("doc-2"), {
      activity: "talking over coffee",
      tension: 0.25
    });

    expect(first).toMatchObject({
      scope: "kin",
      kinId: "kin-1",
      location: "rainy apartment kitchen",
      mood: "quiet",
      tension: 1
    });
    expect(second).toMatchObject({
      scope: "kin",
      kinId: "kin-1",
      location: "rainy apartment kitchen",
      mood: "quiet",
      activity: "talking over coffee",
      tension: 0.25,
      evidence: ["Coffee is still on the counter."],
      sourceDocumentId: "doc-2"
    });
    expect(JSON.parse(fs.readFileSync(localSceneStatePath(config), "utf8")).states["kin:kin-1"]).toMatchObject({
      location: "rainy apartment kitchen",
      activity: "talking over coffee"
    });
  });

  it("stores group scene metadata separately from direct Kin metadata", () => {
    const store = LocalSceneStateStore.fromConfig(testConfig());

    store.update(directNotification("doc-1"), { location: "library" });
    const groupState = store.update(groupNotification("doc-2"), {
      location: "engine bay"
    });

    expect(groupState).toMatchObject({
      scope: "group",
      groupId: "group-1",
      latestSpeakerKinId: "kin-2",
      location: "engine bay"
    });
    expect(store.getForKin("kin-1")).toMatchObject({ location: "library" });
    expect(store.getForGroup("group-1")).toMatchObject({ location: "engine bay" });
  });
});

function directNotification(documentId: string) {
  return {
    type: "kindroid.chat.changed" as const,
    kinId: "kin-1",
    documentId,
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "The room changed.",
    sender: "user",
    role: null,
    source: "firestore" as const
  };
}

function groupNotification(documentId: string) {
  return {
    type: "kindroid.group_chat.changed" as const,
    groupId: "group-1",
    aiId: "kin-2",
    documentId,
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "The room changed.",
    sender: "ai",
    role: "ai",
    source: "firestore" as const
  };
}

function testConfig(): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-local-scene-"));
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
