import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { validateCampaignPack, type CampaignPack } from "../src/game/campaignPack.js";
import { CampaignStateStore } from "../src/game/campaignStateStore.js";
import { createSequenceDiceRoller, resolvePbtARoll } from "../src/game/gameMoves.js";

describe("CampaignStateStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes, persists, and reuses group campaign state", () => {
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const config = testConfig();
    const store = CampaignStateStore.fromConfig(config);
    const campaign = campaignPack();

    const state = store.ensureInitialized({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery"
    });

    expect(state).toMatchObject({
      groupId: "group-a",
      campaignId: "fixture-campaign",
      mysteryId: "fixture-mystery",
      status: "initialized",
      initializedAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      revealedNpcIds: [],
      visitedLocationIds: [],
      notes: [],
      processedSourceDocumentIds: [],
      rollHistory: []
    });
    expect(CampaignStateStore.fromConfig(config).getForGroup("group-a")).toEqual(state);
    expect(store.ensureInitialized({ groupId: "group-a", campaign, mysteryId: "fixture-mystery" })).toEqual(state);
  });

  it("applies state changes once per source document and stores suggest-mode pending work", () => {
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const store = CampaignStateStore.fromConfig(testConfig());
    const campaign = campaignPack();

    const state = store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery",
      sourceDocumentId: "doc-1",
      automationMode: "suggest",
      decision: {
        keeperMessage: "A pending Keeper note.",
        rollRequest: {
          moveId: "interpret_evidence",
          modifier: 1,
          actor: "Ellen",
          prompt: "Read the static."
        },
        pressureCategory: "investigation_prompt",
        confidence: "high",
        reason: "The user is investigating.",
        stateChanges: [
          { type: "advance_countdown", by: 5 },
          { type: "set_status", status: "active" },
          { type: "add_discovered_clue", clueId: "known-clue" },
          { type: "reveal_threat", threatId: "known-threat" },
          { type: "reveal_npc", npcId: "known-npc" },
          { type: "visit_location", locationId: "known-location" },
          { type: "append_note", text: "The group heard the static." }
        ]
      }
    });

    expect(state).toMatchObject({
      status: "active",
      currentCountdownIndex: 3,
      discoveredClueIds: ["known-clue"],
      revealedThreatIds: ["known-threat"],
      revealedNpcIds: ["known-npc"],
      visitedLocationIds: ["known-location"],
      notes: ["The group heard the static."],
      processedSourceDocumentIds: ["doc-1"],
      pendingDecision: {
        sourceDocumentId: "doc-1",
        automationMode: "suggest",
        keeperMessage: "A pending Keeper note.",
        pressureCategory: "investigation_prompt",
        confidence: "high",
        reason: "The user is investigating."
      },
      pendingRollRequest: {
        sourceDocumentId: "doc-1",
        automationMode: "suggest",
        request: {
          moveId: "interpret_evidence",
          modifier: 1,
          actor: "Ellen",
          prompt: "Read the static."
        },
        confidence: "high",
        reason: "The user is investigating."
      }
    });

    const duplicate = store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery",
      sourceDocumentId: "doc-1",
      automationMode: "suggest",
      decision: {
        keeperMessage: "A duplicate note.",
        stateChanges: [
          { type: "advance_countdown", by: 3 },
          { type: "append_note", text: "Duplicate." }
        ]
      }
    });

    expect(duplicate).toEqual(state);
  });

  it("does not create pending Keeper decisions in observe mode but still stores roll requests", () => {
    const store = CampaignStateStore.fromConfig(testConfig());

    const state = store.applyDecision({
      groupId: "group-a",
      campaign: campaignPack(),
      mysteryId: "fixture-mystery",
      sourceDocumentId: "doc-1",
      automationMode: "observe",
      decision: {
        keeperMessage: "Not stored for review.",
        rollRequest: {
          moveId: "interpret_evidence",
          modifier: 0
        },
        stateChanges: []
      }
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.pendingRollRequest).toMatchObject({
      sourceDocumentId: "doc-1",
      automationMode: "observe",
      request: {
        moveId: "interpret_evidence",
        modifier: 0
      }
    });
  });

  it("marks Keeper messages sent and clears pending Keeper decisions", () => {
    const store = CampaignStateStore.fromConfig(testConfig());
    const campaign = campaignPack();
    store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery",
      sourceDocumentId: "doc-1",
      automationMode: "suggest",
      decision: {
        keeperMessage: "A pending Keeper note.",
        stateChanges: []
      }
    });

    const state = store.markKeeperMessageSent({
      groupId: "group-a",
      text: "*A sent Keeper note.*",
      requestId: "request-1",
      idempotencyKey: "idem-1",
      sourceDocumentId: "doc-1"
    });

    expect(state).toMatchObject({
      pendingDecision: undefined,
      lastKeeperMessage: {
        text: "*A sent Keeper note.*",
        requestId: "request-1",
        idempotencyKey: "idem-1",
        sourceDocumentId: "doc-1"
      }
    });
  });

  it("records roll results, clears pending roll requests, bounds history, and annotates sent metadata", () => {
    const store = CampaignStateStore.fromConfig(testConfig());
    const campaign = campaignPack();
    store.ensureInitialized({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery"
    });
    store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "fixture-mystery",
      sourceDocumentId: "doc-pending",
      automationMode: "suggest",
      decision: {
        rollRequest: {
          moveId: "interpret_evidence",
          modifier: 1
        },
        stateChanges: []
      }
    });

    for (let index = 0; index < 26; index += 1) {
      const request = {
        moveId: "interpret_evidence",
        modifier: index % 3
      };
      store.recordRollResult({
        groupId: "group-a",
        sourceDocumentId: `doc-roll-${index}`,
        automationMode: "autonomous",
        request,
        result: resolvePbtARoll(request, { roller: createSequenceDiceRoller([4, 5]) }),
        message: `Outcome ${index}.`
      });
    }
    const state = store.markRollResultSent({
      groupId: "group-a",
      sourceDocumentId: "doc-roll-25",
      message: "*(Outcome: success.) The clue becomes clear.*",
      sent: {
        ok: true,
        status: 200,
        requestId: "request-25",
        idempotencyKey: "idem-25"
      }
    });

    expect(state?.pendingRollRequest).toBeUndefined();
    expect(state?.rollHistory).toHaveLength(24);
    expect(state?.rollHistory[0]).toMatchObject({
      sourceDocumentId: "doc-roll-2"
    });
    expect(state?.rollHistory.at(-1)).toMatchObject({
      sourceDocumentId: "doc-roll-25",
      message: "*(Outcome: success.) The clue becomes clear.*",
      sent: {
        ok: true,
        status: 200,
        requestId: "request-25",
        idempotencyKey: "idem-25"
      },
      request: {
        moveId: "interpret_evidence"
      },
      result: {
        dice: [4, 5],
        total: 10,
        outcome: "10+"
      }
    });
  });

  it("normalizes legacy state defaults and removes obsolete turn guard state", () => {
    const config = testConfig();
    const filePath = path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "game-campaign-state.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        groups: {
          "group-a": {
            groupId: "group-a",
            campaignId: "fixture-campaign",
            mysteryId: "fixture-mystery",
            status: "active",
            initializedAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
            currentCountdownIndex: 1,
            turnGuard: {
              mode: "manual"
            }
          }
        }
      })
    );

    const state = CampaignStateStore.fromConfig(config).getForGroup("group-a");

    expect(state).toMatchObject({
      discoveredClueIds: [],
      revealedThreatIds: [],
      revealedNpcIds: [],
      visitedLocationIds: [],
      notes: [],
      processedSourceDocumentIds: [],
      rollHistory: []
    });
    expect(state).not.toHaveProperty("turnGuard");
  });
});

function campaignPack(): CampaignPack {
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
          clues: [{ id: "known-clue", text: "Known clue." }],
          countdown: ["one", "two", "three", "four"]
        }
      ],
      threats: [{ id: "known-threat", name: "Known Threat", kind: "monster" }],
      locations: [{ id: "known-location", name: "Known Location" }],
      npcs: [{ id: "known-npc", name: "Known NPC" }]
    },
    { source: "local", sourcePath: "fixture" }
  );
}

function testConfig(): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-campaign-state-"));
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
