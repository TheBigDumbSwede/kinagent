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
import { KinSubscriptionSupervisor } from "../src/runtime/kinSubscriptionSupervisor.js";
import {
  groupSubscriptionPreferencesPath,
  loadGroupSubscriptionPreferences,
  saveGroupSubscriptionPreferences
} from "../src/runtime/groupSubscriptionPreferences.js";
import { GroupSubscriptionSupervisor } from "../src/runtime/groupSubscriptionSupervisor.js";
import type { Logger } from "../src/util/logger.js";

describe("subscription preferences", () => {
  it("defaults Kin monitoring to enabled when no preferences file exists", () => {
    const config = testConfig();

    const preferences = loadKinSubscriptionPreferences(config);

    expect(preferences.disabledKinIds).toEqual(new Set());
    expect(preferences.ambientDisabledKinIds).toEqual(new Set());
    expect(preferences.chatDynamism).toEqual(new Map());
    expect(preferences.soundscape).toEqual(new Map());
    expect(fs.existsSync(kinSubscriptionPreferencesPath(config))).toBe(false);
  });

  it("persists disabled Kin ids beside the bridge state", () => {
    const config = testConfig();

    saveKinSubscriptionPreferences(config, {
      disabledKinIds: new Set(["kin-b", "kin-a"]),
      ambientDisabledKinIds: new Set(["kin-c"]),
      chatDynamism: new Map([["kin-a", { enabled: true, min: 0.5, max: 1.1 }]]),
      soundscape: new Map([["kin-b", { enabled: true }]])
    });
    const preferences = loadKinSubscriptionPreferences(config);

    expect(preferences.disabledKinIds).toEqual(new Set(["kin-a", "kin-b"]));
    expect(preferences.ambientDisabledKinIds).toEqual(new Set(["kin-c"]));
    expect(preferences.chatDynamism).toEqual(new Map([["kin-a", { enabled: true, min: 0.6, max: 1.1 }]]));
    expect(preferences.soundscape).toEqual(new Map([["kin-b", { enabled: true }]]));
    expect(JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8"))).toEqual({
      disabledKinIds: ["kin-a", "kin-b"],
      ambientDisabledKinIds: ["kin-c"],
      chatDynamism: {
        "kin-a": {
          enabled: true,
          min: 0.6,
          max: 1.1
        }
      },
      soundscape: {
        "kin-b": {
          enabled: true
        }
      }
    });
  });

  it("reloads per-Kin Chat Dynamism range from the settings file", () => {
    const config = testConfig();
    const supervisor = testKinSupervisor(config);

    supervisor.setKinChatDynamismPreference("kin-a", { enabled: true, min: 0.85, max: 1.35 });
    const reloaded = testKinSupervisor(config);

    expect(reloaded.kinChatDynamismPreference("kin-a")).toEqual({
      enabled: true,
      min: 0.85,
      max: 1.35
    });
    expect(JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8")).chatDynamism).toEqual({
      "kin-a": {
        enabled: true,
        min: 0.85,
        max: 1.35
      }
    });
  });

  it("reloads per-Kin soundscape enablement from the settings file", () => {
    const config = testConfig();
    const supervisor = testKinSupervisor(config);

    expect(supervisor.kinSoundscapePreference("kin-a")).toEqual({ enabled: false });

    supervisor.setKinSoundscapePreference("kin-a", { enabled: true });
    const reloaded = testKinSupervisor(config);

    expect(reloaded.kinSoundscapePreference("kin-a")).toEqual({ enabled: true });
    expect(JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8")).soundscape).toEqual({
      "kin-a": {
        enabled: true
      }
    });
  });

  it("defaults group monitoring to enabled and persists disabled group ids", () => {
    const config = testConfig();

    const defaults = loadGroupSubscriptionPreferences(config);
    expect(defaults.disabledGroupIds).toEqual(new Set());
    expect(defaults.soundscape).toEqual(new Map());

    saveGroupSubscriptionPreferences(config, {
      disabledGroupIds: new Set(["group-b", "group-a"]),
      soundscape: new Map([["group-a", { enabled: true }]])
    });

    const reloaded = loadGroupSubscriptionPreferences(config);
    expect(reloaded.disabledGroupIds).toEqual(new Set(["group-a", "group-b"]));
    expect(reloaded.soundscape).toEqual(new Map([["group-a", { enabled: true }]]));
    expect(JSON.parse(fs.readFileSync(groupSubscriptionPreferencesPath(config), "utf8"))).toEqual({
      disabledGroupIds: ["group-a", "group-b"],
      soundscape: {
        "group-a": {
          enabled: true
        }
      }
    });
  });

  it("reloads per-Group soundscape enablement from the settings file", () => {
    const config = testConfig();
    const supervisor = testGroupSupervisor(config);

    expect(supervisor.groupSoundscapePreference("group-a")).toEqual({ enabled: false });

    supervisor.setGroupSoundscapePreference("group-a", { enabled: true });
    const reloaded = testGroupSupervisor(config);

    expect(reloaded.groupSoundscapePreference("group-a")).toEqual({ enabled: true });
    expect(JSON.parse(fs.readFileSync(groupSubscriptionPreferencesPath(config), "utf8")).soundscape).toEqual({
      "group-a": {
        enabled: true
      }
    });
  });
});

function testKinSupervisor(config: AppConfig): KinSubscriptionSupervisor {
  return new KinSubscriptionSupervisor({
    config,
    logger: testLogger,
    startKin: async () => undefined
  });
}

function testGroupSupervisor(config: AppConfig): GroupSubscriptionSupervisor {
  return new GroupSubscriptionSupervisor({
    config,
    logger: testLogger,
    startGroup: async () => undefined
  });
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

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
