import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { KindroidGroup } from "../src/kindroid/client/index.js";
import type { SendKindroidGroupMessageInput, UpdateKindroidGroupCurrentSceneInput } from "../src/kindroid/types.js";
import { validateCampaignPack } from "../src/game/campaignPack.js";
import { CampaignStateStore } from "../src/game/campaignStateStore.js";
import {
  keeperMessageCurrentScene,
  KeeperMessenger,
  type GameKeeperMessageSentEvent,
  type GameKindroidClient
} from "../src/game/keeperMessenger.js";
import { InMemoryDedupeStore } from "../src/state/dedupeStore.js";

describe("KeeperMessenger", () => {
  it("sends Keeper messages, records outbound dedupe, updates state, and syncs current scene", async () => {
    const config = testConfig();
    const campaignStates = CampaignStateStore.fromConfig(config);
    campaignStates.ensureInitialized({
      groupId: "group-a",
      campaign: campaignPack(),
      mysteryId: "fixture-mystery"
    });
    const dedupeStore = new InMemoryDedupeStore(10_000);
    const sends: SendKindroidGroupMessageInput[] = [];
    const sceneUpdates: UpdateKindroidGroupCurrentSceneInput[] = [];
    const stateUpdates: unknown[] = [];
    const events: GameKeeperMessageSentEvent[] = [];
    const messenger = new KeeperMessenger({
      config,
      logger: testLogger,
      campaignStates,
      dedupeStore,
      kindroidClient: kindroidClient({ sends, sceneUpdates }),
      onStateUpdated: (state) => stateUpdates.push(state),
      onKeeperMessageSent: (event) => events.push(event)
    });

    const result = await messenger.send(group(), "doc-1", "*The phone hisses louder near the puddle.*", {
      source: "autonomous",
      triggerAiResponse: true
    });

    expect(result.ok).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*The phone hisses louder near the puddle.*",
      triggerAiResponse: true
    });
    expect(sends[0]?.requestId).toEqual(expect.any(String));
    expect(sends[0]?.idempotencyKey).toEqual(expect.any(String));
    await expect(
      dedupeStore.matchRecentOutbound({
        kinId: "group-a",
        text: "*The phone hisses louder near the puddle.*"
      })
    ).resolves.toMatchObject({ matched: true });
    expect(campaignStates.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*The phone hisses louder near the puddle.*",
      requestId: sends[0]?.requestId,
      idempotencyKey: sends[0]?.idempotencyKey,
      sourceDocumentId: "doc-1"
    });
    expect(stateUpdates).toHaveLength(1);
    expect(sceneUpdates).toEqual([
      {
        groupId: "group-a",
        currentScene: "The phone hisses louder near the puddle."
      }
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      groupId: "group-a",
      groupName: "Test Group",
      text: "*The phone hisses louder near the puddle.*",
      sourceDocumentId: "doc-1",
      result: {
        ok: true,
        status: 200
      }
    });
  });

  it("turns send exceptions into failed results without recording state or scene side effects", async () => {
    const config = testConfig();
    const campaignStates = CampaignStateStore.fromConfig(config);
    campaignStates.ensureInitialized({
      groupId: "group-a",
      campaign: campaignPack(),
      mysteryId: "fixture-mystery"
    });
    const dedupeStore = new InMemoryDedupeStore(10_000);
    const sceneUpdates: UpdateKindroidGroupCurrentSceneInput[] = [];
    const events: GameKeeperMessageSentEvent[] = [];
    const messenger = new KeeperMessenger({
      config,
      logger: testLogger,
      campaignStates,
      dedupeStore,
      kindroidClient: {
        sendGroupMessage: async () => {
          throw new Error("send exploded");
        },
        updateGroupCurrentScene: async (input) => {
          sceneUpdates.push(input);
          return { status: 200, ok: true };
        }
      },
      onKeeperMessageSent: (event) => events.push(event)
    });

    const result = await messenger.send(group(), "doc-1", "*No one hears this.*", {
      source: "roll-result"
    });

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      responseText: "send exploded"
    });
    await expect(
      dedupeStore.matchRecentOutbound({
        kinId: "group-a",
        text: "*No one hears this.*"
      })
    ).resolves.toMatchObject({ matched: false });
    expect(campaignStates.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
    expect(sceneUpdates).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toMatchObject({
      ok: false,
      status: 0,
      responseText: "send exploded"
    });
  });

  it("skips current-scene sync when disabled while still recording the sent Keeper message", async () => {
    const config = testConfig({ currentSceneUpdatesEnabled: false });
    const campaignStates = CampaignStateStore.fromConfig(config);
    campaignStates.ensureInitialized({
      groupId: "group-a",
      campaign: campaignPack(),
      mysteryId: "fixture-mystery"
    });
    const sends: SendKindroidGroupMessageInput[] = [];
    const sceneUpdates: UpdateKindroidGroupCurrentSceneInput[] = [];
    const messenger = new KeeperMessenger({
      config,
      logger: testLogger,
      campaignStates,
      dedupeStore: new InMemoryDedupeStore(10_000),
      kindroidClient: kindroidClient({ sends, sceneUpdates })
    });

    const result = await messenger.send(group(), "doc-1", "*The lights go out.*", {
      source: "approved-suggestion"
    });

    expect(result.ok).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      triggerAiResponse: false
    });
    expect(campaignStates.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*The lights go out.*",
      sourceDocumentId: "doc-1"
    });
    expect(sceneUpdates).toEqual([]);
  });

  it("skips current-scene sync for roll-result messages by default", async () => {
    const config = testConfig();
    const campaignStates = CampaignStateStore.fromConfig(config);
    campaignStates.ensureInitialized({
      groupId: "group-a",
      campaign: campaignPack(),
      mysteryId: "fixture-mystery"
    });
    const sends: SendKindroidGroupMessageInput[] = [];
    const sceneUpdates: UpdateKindroidGroupCurrentSceneInput[] = [];
    const messenger = new KeeperMessenger({
      config,
      logger: testLogger,
      campaignStates,
      dedupeStore: new InMemoryDedupeStore(10_000),
      kindroidClient: kindroidClient({ sends, sceneUpdates })
    });

    const result = await messenger.send(group(), "doc-roll", "*(Outcome: success.) The clue opens up.*", {
      source: "roll-result"
    });

    expect(result.ok).toBe(true);
    expect(sends).toHaveLength(1);
    expect(campaignStates.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*(Outcome: success.) The clue opens up.*",
      sourceDocumentId: "doc-roll"
    });
    expect(sceneUpdates).toEqual([]);
  });
});

describe("keeperMessageCurrentScene", () => {
  it("converts Keeper narration into compact current-scene text", () => {
    expect(
      keeperMessageCurrentScene('*The radio crackles: "Do not touch the water."*\n\n*The puddle climbs the wall.*', 200)
    ).toBe('The radio crackles: "Do not touch the water." The puddle climbs the wall.');
  });

  it("trims the scene to the configured maximum length", () => {
    expect(keeperMessageCurrentScene("*The phone rings under the sink.*", 16)).toBe("The phone rings");
  });
});

function kindroidClient(input: {
  sends: SendKindroidGroupMessageInput[];
  sceneUpdates: UpdateKindroidGroupCurrentSceneInput[];
}): GameKindroidClient {
  return {
    sendGroupMessage: async (messageInput) => {
      input.sends.push(messageInput);
      return {
        status: 200,
        ok: true,
        requestId: messageInput.requestId,
        idempotencyKey: messageInput.idempotencyKey
      };
    },
    updateGroupCurrentScene: async (sceneInput) => {
      input.sceneUpdates.push(sceneInput);
      return {
        status: 200,
        ok: true
      };
    }
  };
}

function group(overrides: Partial<KindroidGroup> = {}): KindroidGroup {
  return {
    groupId: "group-a",
    documentId: "group-a",
    name: "Test Group",
    aiIds: ["kin-a"],
    ...overrides
  };
}

function campaignPack() {
  return validateCampaignPack(
    {
      id: "fixture-campaign",
      title: "Fixture Campaign",
      rulesetStyle: "pbta-mystery-hunt",
      license: "test",
      mysteries: [
        {
          id: "fixture-mystery",
          title: "Fixture Mystery",
          hook: "A local test hook.",
          truth: "The test truth.",
          clues: []
        }
      ]
    },
    { source: "local", sourcePath: "fixture" }
  );
}

function testConfig(options: { currentSceneUpdatesEnabled?: boolean } = {}): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-keeper-messenger-"));
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
        enabled: options.currentSceneUpdatesEnabled ?? true,
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

const testLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
