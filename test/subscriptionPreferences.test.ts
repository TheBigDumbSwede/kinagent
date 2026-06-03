import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import {
  kinSubscriptionPreferencesPath,
  loadKinSubscriptionPreferences,
  saveKinSubscriptionPreferences
} from "../src/runtime/kinSubscriptionPreferences.js";
import {
  groupSubscriptionPreferencesPath,
  loadGroupSubscriptionPreferences,
  saveGroupSubscriptionPreferences
} from "../src/runtime/groupSubscriptionPreferences.js";

describe("subscription preferences", () => {
  it("defaults Kin monitoring to enabled when no preferences file exists", () => {
    const config = testConfig();

    const preferences = loadKinSubscriptionPreferences(config);

    expect(preferences.disabledKinIds).toEqual(new Set());
    expect(preferences.ambientDisabledKinIds).toEqual(new Set());
    expect(fs.existsSync(kinSubscriptionPreferencesPath(config))).toBe(false);
  });

  it("persists disabled Kin ids beside the bridge state", () => {
    const config = testConfig();

    saveKinSubscriptionPreferences(config, {
      disabledKinIds: new Set(["kin-b", "kin-a"]),
      ambientDisabledKinIds: new Set(["kin-c"])
    });
    const preferences = loadKinSubscriptionPreferences(config);

    expect(preferences.disabledKinIds).toEqual(new Set(["kin-a", "kin-b"]));
    expect(preferences.ambientDisabledKinIds).toEqual(new Set(["kin-c"]));
    expect(JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8"))).toEqual({
      disabledKinIds: ["kin-a", "kin-b"],
      ambientDisabledKinIds: ["kin-c"]
    });
  });

  it("defaults group monitoring to enabled and persists disabled group ids", () => {
    const config = testConfig();

    expect(loadGroupSubscriptionPreferences(config).disabledGroupIds).toEqual(new Set());

    saveGroupSubscriptionPreferences(config, { disabledGroupIds: new Set(["group-b", "group-a"]) });

    expect(loadGroupSubscriptionPreferences(config).disabledGroupIds).toEqual(new Set(["group-a", "group-b"]));
    expect(JSON.parse(fs.readFileSync(groupSubscriptionPreferencesPath(config), "utf8"))).toEqual({
      disabledGroupIds: ["group-a", "group-b"]
    });
  });
});

function testConfig(): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-subscriptions-"));
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
      enabled: false,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "",
      agentId: "kindroid-bridge",
      currentSceneUpdates: {
        enabled: true,
        maxLength: 160
      },
      journalSuggestions: {
        enabled: true,
        throttleMessages: 20,
        strongEventBypass: true
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
