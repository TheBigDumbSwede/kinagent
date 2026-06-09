import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import {
  GroupBackgroundPreferenceStore,
  groupBackgroundPreferencesPath
} from "../src/groupBackground/groupBackgroundPreferences.js";

describe("GroupBackgroundPreferenceStore", () => {
  it("persists enable and autonomous settings per group", () => {
    const config = testConfig();
    const store = GroupBackgroundPreferenceStore.fromConfig(config);

    expect(store.get("group-a")).toEqual({ enabled: true, autonomous: false });
    expect(store.set("group-a", { enabled: true, autonomous: true })).toEqual({
      enabled: true,
      autonomous: true
    });
    expect(store.set("group-b", { enabled: false, autonomous: true })).toEqual({
      enabled: false,
      autonomous: false
    });

    const reloaded = GroupBackgroundPreferenceStore.fromConfig(config);
    expect(reloaded.get("group-a")).toEqual({ enabled: true, autonomous: true });
    expect(reloaded.get("group-b")).toEqual({ enabled: false, autonomous: false });
    expect(reloaded.get("group-c")).toEqual({ enabled: true, autonomous: false });
    expect(fs.existsSync(groupBackgroundPreferencesPath(config))).toBe(true);
  });
});

function testConfig(): AppConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-group-background-preferences-"));
  return {
    kindroid: {
      apiKey: "",
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: path.join(dir, "kinagent.log"),
      logLevel: "info",
      sessionDir: path.join(dir, "browser-session"),
      sqlitePath: path.join(dir, "bridge.sqlite")
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
          enabled: false
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
