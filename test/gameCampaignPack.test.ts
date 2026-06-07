import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { campaignPackDirectories, loadCampaignPacks } from "../src/game/campaignPack.js";
import { importCampaignPack } from "../src/game/campaignPackImport.js";
import { CampaignStateStore } from "../src/game/campaignStateStore.js";
import { formatKeeperMessageForGroupChat, GameRuntime } from "../src/game/gameRuntime.js";
import { GroupGamingPreferenceStore, groupGamingPreferencesPath } from "../src/game/groupGamingPreferences.js";
import { InMemoryDedupeStore } from "../src/state/dedupeStore.js";
import type { KindroidGroup } from "../src/kindroid/client/index.js";

describe("game campaign foundations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the built-in sample campaign pack", () => {
    const packs = loadCampaignPacks(testConfig());

    expect(packs[0]).toMatchObject({
      id: "prairie-saints-and-municipal-ghosts",
      source: "builtin",
      license: "original-app-authored-content"
    });
    expect(packs[0]?.mysteries[0]).toMatchObject({
      id: "the-thing-in-the-floodway",
      title: "The Thing in the Floodway"
    });
    expect(packs[0]?.threats[0]).toMatchObject({
      id: "river-husk",
      kind: "monster"
    });
  });

  it("creates the local campaign pack drop-in directory", () => {
    const config = testConfig();
    const [campaignDirectory] = campaignPackDirectories(config);

    expect(fs.existsSync(campaignDirectory)).toBe(false);

    loadCampaignPacks(config);

    expect(fs.existsSync(campaignDirectory)).toBe(true);
  });

  it("loads local campaign pack directories and validates split content", () => {
    const config = testConfig();
    const campaignRoot = path.join(path.dirname(config.bridge.sqlitePath), "campaigns", "test-pack");
    fs.mkdirSync(path.join(campaignRoot, "mysteries"), { recursive: true });
    fs.mkdirSync(path.join(campaignRoot, "npcs"), { recursive: true });
    fs.writeFileSync(
      path.join(campaignRoot, "campaign.json"),
      JSON.stringify({
        id: "local-mystery",
        title: "Local Mystery",
        rulesetStyle: "pbta-mystery-hunt",
        license: "user-authored-local-content",
        tone: ["plain"],
        contentWarnings: [],
        mysteries: [],
        npcs: [],
        locations: [],
        hooks: []
      })
    );
    fs.writeFileSync(
      path.join(campaignRoot, "mysteries", "001.json"),
      JSON.stringify({
        id: "case-one",
        title: "Case One",
        hook: "A local test hook.",
        truth: "The test truth.",
        countdown: ["first pressure"],
        clues: ["one clue"]
      })
    );
    fs.writeFileSync(
      path.join(campaignRoot, "npcs", "people.json"),
      JSON.stringify([{ id: "witness", name: "Witness" }])
    );

    const packs = loadCampaignPacks(config);
    const local = packs.find((pack) => pack.id === "local-mystery");

    expect(local).toMatchObject({
      source: "local",
      mysteries: [{ id: "case-one" }],
      npcs: [{ id: "witness" }]
    });
  });

  it("imports a zipped local campaign pack after validating it", () => {
    const config = testConfig();
    const sourceRoot = path.join(path.dirname(config.bridge.sqlitePath), "zip-source", "zip-pack");
    fs.mkdirSync(path.join(sourceRoot, "mysteries"), { recursive: true });
    writeMinimalCampaignManifest(sourceRoot, {
      id: "zipped-mystery",
      title: "Zipped Mystery"
    });
    writeMinimalMystery(path.join(sourceRoot, "mysteries", "001.json"), {
      id: "zip-case",
      title: "Zip Case"
    });
    const zipPath = path.join(path.dirname(config.bridge.sqlitePath), "zipped-mystery.zip");
    const zip = new AdmZip();
    zip.addLocalFolder(sourceRoot, "zip-pack");
    zip.writeZip(zipPath);

    const result = importCampaignPack(config, zipPath);
    const imported = loadCampaignPacks(config).find((pack) => pack.id === "zipped-mystery");

    expect(result).toMatchObject({
      ok: true,
      campaign: {
        id: "zipped-mystery",
        title: "Zipped Mystery",
        source: "local"
      }
    });
    expect(imported).toMatchObject({
      id: "zipped-mystery",
      source: "local",
      mysteries: [{ id: "zip-case" }]
    });
  });

  it("imports a single-file JSON campaign pack without converting it to a directory manifest", () => {
    const config = testConfig();
    const sourcePath = path.join(path.dirname(config.bridge.sqlitePath), "single-file-mystery.json");
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({
        id: "single-file-mystery",
        title: "Single File Mystery",
        rulesetStyle: "pbta-mystery-hunt",
        license: "user-authored-local-content",
        mysteries: [
          {
            id: "single-case",
            title: "Single Case",
            hook: "A local test hook.",
            truth: "The test truth."
          }
        ]
      })
    );

    importCampaignPack(config, sourcePath);
    const imported = loadCampaignPacks(config).find((pack) => pack.id === "single-file-mystery");

    expect(imported).toMatchObject({
      id: "single-file-mystery",
      source: "local",
      mysteries: [{ id: "single-case" }]
    });
  });

  it("rejects duplicate campaign pack ids during import", () => {
    const config = testConfig();
    const sourceRoot = path.join(path.dirname(config.bridge.sqlitePath), "duplicate-source", "duplicate-pack");
    fs.mkdirSync(path.join(sourceRoot, "mysteries"), { recursive: true });
    writeMinimalCampaignManifest(sourceRoot, {
      id: "duplicate-mystery",
      title: "Duplicate Mystery"
    });
    writeMinimalMystery(path.join(sourceRoot, "mysteries", "001.json"), {
      id: "duplicate-case",
      title: "Duplicate Case"
    });
    const zipPath = path.join(path.dirname(config.bridge.sqlitePath), "duplicate-mystery.zip");
    const zip = new AdmZip();
    zip.addLocalFolder(sourceRoot, "duplicate-pack");
    zip.writeZip(zipPath);

    importCampaignPack(config, zipPath);

    expect(() => importCampaignPack(config, zipPath)).toThrow(/already exists/);
  });

  it("persists group Gaming preferences separately from campaign state", () => {
    const config = testConfig();
    const preferences = GroupGamingPreferenceStore.fromConfig(config);

    const saved = preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });

    expect(saved).toEqual({
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    expect(GroupGamingPreferenceStore.fromConfig(config).get("group-a")).toEqual(saved);
    expect(JSON.parse(fs.readFileSync(groupGamingPreferencesPath(config), "utf8"))).toEqual({
      groups: {
        "group-a": saved
      }
    });
  });

  it("normalizes legacy supervised Gaming preferences to suggest", () => {
    const config = testConfig();
    const preferencePath = groupGamingPreferencesPath(config);
    fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
    fs.writeFileSync(
      preferencePath,
      JSON.stringify({
        groups: {
          "group-a": {
            enabled: true,
            campaignId: "prairie-saints-and-municipal-ghosts",
            mysteryId: "the-thing-in-the-floodway",
            automationMode: "supervised"
          }
        }
      })
    );

    expect(GroupGamingPreferenceStore.fromConfig(config).get("group-a")).toMatchObject({
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
  });

  it("initializes active group campaign state from selected pack and mystery", () => {
    const config = testConfig();
    const campaign = loadCampaignPacks(config)[0];
    const store = CampaignStateStore.fromConfig(config);

    const state = store.ensureInitialized({
      groupId: "group-a",
      campaign,
      mysteryId: "the-thing-in-the-floodway"
    });

    expect(state).toMatchObject({
      groupId: "group-a",
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      status: "initialized",
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: []
    });
    expect(store.ensureInitialized({ groupId: "group-a", campaign, mysteryId: state.mysteryId })).toEqual(state);
  });

  it("applies observe-mode game decisions without storing Keeper prompts", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse());

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 1,
      discoveredClueIds: ["static-phone"],
      revealedThreatIds: ["river-husk"],
      notes: ["The group investigated phone static."]
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
  });

  it("stores suggest-mode Keeper decisions for review", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse());

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(store.getForGroup("group-a")?.pendingDecision).toMatchObject({
      sourceDocumentId: "doc-1",
      keeperMessage: "*The phone hisses louder near the puddle.*",
      pressureCategory: "investigation_prompt",
      automationMode: "suggest"
    });
  });

  it("sends approved suggest-mode Keeper decisions through the group send port", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);
    const sends: unknown[] = [];
    const sceneUpdates: unknown[] = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async (input) => {
        sceneUpdates.push(input);
        return {
          status: 200,
          ok: true
        };
      }
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));
    const updated = await runtime.approvePendingKeeperMessage(group());

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*The phone hisses louder near the puddle.*",
      triggerAiResponse: false
    });
    expect(sceneUpdates).toEqual([
      {
        groupId: "group-a",
        currentScene: "The phone hisses louder near the puddle."
      }
    ]);
    expect(updated.pendingDecision).toBeUndefined();
    expect(updated.lastKeeperMessage).toMatchObject({
      text: "*The phone hisses louder near the puddle.*",
      sourceDocumentId: "doc-1"
    });
  });

  it("formats Keeper group messages as narration with quoted speech preserved", () => {
    expect(formatKeeperMessageForGroupChat('The radio crackles: "Do not touch the water."')).toBe(
      '*The radio crackles: "Do not touch the water."*'
    );
    expect(formatKeeperMessageForGroupChat("*Already narrated.*")).toBe("*Already narrated.*");
  });

  it("sends autonomous Keeper messages through the group send port", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const sends: unknown[] = [];
    const sceneUpdates: unknown[] = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async (input) => {
        sceneUpdates.push(input);
        return {
          status: 200,
          ok: true
        };
      }
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*The phone hisses louder near the puddle.*",
      triggerAiResponse: false
    });
    expect(sceneUpdates).toEqual([
      {
        groupId: "group-a",
        currentScene: "The phone hisses louder near the puddle."
      }
    ]);
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*The phone hisses louder near the puddle.*",
      sourceDocumentId: "doc-1"
    });
  });

  it("does not send autonomous Keeper messages after Kin turns but still applies state changes", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const sends: unknown[] = [];
    const sceneUpdates: unknown[] = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async (input) => {
        sceneUpdates.push(input);
        return {
          status: 200,
          ok: true
        };
      }
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "Velma thinks through the clue.", "ai"));

    expect(sends).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 1,
      discoveredClueIds: ["static-phone"],
      revealedThreatIds: ["river-husk"],
      notes: ["The group investigated phone static."]
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("does not send autonomous Keeper messages during the short Keeper cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:05.000Z"));
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const sends: unknown[] = [];
    const sceneUpdates: unknown[] = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async (input) => {
        sceneUpdates.push(input);
        return {
          status: 200,
          ok: true
        };
      }
    });

    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-1", "I inspect the phone static.", "user", "2026-06-06T00:00:00.000Z")
    );
    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-2", "I immediately check the puddle.", "user", "2026-06-06T00:00:20.000Z")
    );

    expect(sends).toHaveLength(1);
    expect(sceneUpdates).toHaveLength(1);
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*The phone hisses louder near the puddle.*",
      sourceDocumentId: "doc-1"
    });
  });
});

function testGameRuntime(
  config: AppConfig,
  preferences: GroupGamingPreferenceStore,
  campaignStates: CampaignStateStore,
  hermesResponse: unknown,
  kindroidClient: ConstructorParameters<typeof GameRuntime>[0]["kindroidClient"] = {
    sendGroupMessage: async (input) => ({
      status: 200,
      ok: true,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey
    }),
    updateGroupCurrentScene: async () => ({
      status: 200,
      ok: true
    })
  }
): GameRuntime {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(hermesResponse)
  }));
  return new GameRuntime({
    config,
    logger: testLogger,
    preferences,
    campaignStates,
    dedupeStore: new InMemoryDedupeStore(10_000),
    kindroidClient,
    onStateUpdated: () => undefined,
    onKeeperMessageSent: () => undefined,
    onPendingDecision: () => undefined
  });
}

function hermesDecisionResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            keeperMessage: "The phone hisses louder near the puddle.",
            stateChanges: [
              { type: "advance_countdown", by: 1 },
              { type: "add_discovered_clue", clueId: "static-phone" },
              { type: "reveal_threat", threatId: "river-husk" },
              { type: "append_note", text: "The group investigated phone static." }
            ],
            pressureCategory: "investigation_prompt",
            confidence: "high",
            reason: "The group is investigating a known clue."
          })
        }
      }
    ]
  };
}

function group(): KindroidGroup {
  return {
    groupId: "group-a",
    documentId: "group-a",
    name: "Test Group",
    aiIds: ["kin-a"]
  };
}

function groupNotification(
  documentId: string,
  text: string,
  sender: "user" | "ai" = "user",
  timestamp = "2026-06-06T00:00:00.000Z"
) {
  return {
    type: "kindroid.group_chat.changed" as const,
    groupId: "group-a",
    aiId: "kin-a",
    documentId,
    timestamp,
    text,
    textEncrypted: false,
    textDecrypted: true,
    sender,
    role: sender,
    source: "firestore" as const
  };
}

function writeMinimalCampaignManifest(directory: string, input: { id: string; title: string }): void {
  fs.writeFileSync(
    path.join(directory, "campaign.json"),
    JSON.stringify({
      id: input.id,
      title: input.title,
      rulesetStyle: "pbta-mystery-hunt",
      license: "user-authored-local-content"
    })
  );
}

function writeMinimalMystery(filePath: string, input: { id: string; title: string }): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      id: input.id,
      title: input.title,
      hook: "A local test hook.",
      truth: "The test truth."
    })
  );
}

const testLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function testConfig(options: { hermesEnabled?: boolean } = {}): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-game-"));
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
      enabled: options.hermesEnabled === true,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: options.hermesEnabled ? "test-key" : "",
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
