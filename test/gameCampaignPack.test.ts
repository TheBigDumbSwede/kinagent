import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { campaignPackDirectories, loadCampaignPacks, validateCampaignPack } from "../src/game/campaignPack.js";
import { importCampaignPack } from "../src/game/campaignPackImport.js";
import { CampaignStateStore } from "../src/game/campaignStateStore.js";
import { parseGameCommand } from "../src/game/gameCommands.js";
import { formatKeeperMessageForGroupChat, GameRuntime } from "../src/game/gameRuntime.js";
import { createSequenceDiceRoller, resolvePbtARoll, type DiceRoller } from "../src/game/gameMoves.js";
import { GroupGamingPreferenceStore, groupGamingPreferencesPath } from "../src/game/groupGamingPreferences.js";
import { spoilerFreeMysteryBrief } from "../src/game/spoilerFreeBrief.js";
import { shouldSkipGenericHermesGroupHandling } from "../src/runtime/bridgeRuntime.js";
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

  it("rejects campaign packs with dangling threat references", () => {
    expect(() =>
      validateCampaignPack(
        campaignPackFixture({
          mysteries: [
            {
              ...mysteryFixture(),
              threatIds: ["missing-threat"]
            }
          ],
          threats: []
        }),
        { source: "local", sourcePath: "bad-threat.json" }
      )
    ).toThrow(/threatIds references unknown id "missing-threat"/);
  });

  it("rejects campaign packs with dangling location references", () => {
    expect(() =>
      validateCampaignPack(
        campaignPackFixture({
          mysteries: [
            {
              ...mysteryFixture(),
              locationIds: ["missing-location"]
            }
          ],
          locations: []
        }),
        { source: "local", sourcePath: "bad-location.json" }
      )
    ).toThrow(/locationIds references unknown id "missing-location"/);
  });

  it("rejects duplicate mystery clue ids", () => {
    expect(() =>
      validateCampaignPack(
        campaignPackFixture({
          mysteries: [
            {
              ...mysteryFixture(),
              clues: [
                { id: "same-clue", text: "One clue." },
                { id: "same-clue", text: "Another clue." }
              ]
            }
          ]
        }),
        { source: "local", sourcePath: "duplicate-clues.json" }
      )
    ).toThrow(/duplicate clue id "same-clue"/);
  });

  it("rejects duplicate campaign entity ids", () => {
    expect(() =>
      validateCampaignPack(
        campaignPackFixture({
          threats: [
            { id: "same-threat", name: "One Threat", kind: "monster" },
            { id: "same-threat", name: "Other Threat", kind: "monster" }
          ]
        }),
        { source: "local", sourcePath: "duplicate-threats.json" }
      )
    ).toThrow(/threats contains duplicate id "same-threat"/);
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

  it("parses only explicit Group Gaming commands", () => {
    expect(parseGameCommand("/start-mystery")).toEqual({ type: "start_mystery" });
    expect(parseGameCommand("  /RESET-MYSTERY  ")).toEqual({ type: "reset_mystery" });
    expect(parseGameCommand("/end-mystery")).toEqual({ type: "end_mystery" });
    expect(parseGameCommand("/start-mystery now")).toBeNull();
    expect(parseGameCommand("please /start-mystery")).toBeNull();
    expect(parseGameCommand("/unknown-command")).toBeNull();
    expect(parseGameCommand(null)).toBeNull();
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
    expect(state.processedSourceDocumentIds).toEqual([]);
    expect(store.ensureInitialized({ groupId: "group-a", campaign, mysteryId: state.mysteryId })).toEqual(state);
  });

  it("activates existing campaign state without clearing progress", () => {
    const config = testConfig();
    const campaign = loadCampaignPacks(config)[0];
    const store = CampaignStateStore.fromConfig(config);
    store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-progress",
      automationMode: "observe",
      decision: {
        stateChanges: [
          { type: "advance_countdown", by: 1 },
          { type: "add_discovered_clue", clueId: "static-phone" },
          { type: "append_note", text: "The group found the static." }
        ]
      }
    });

    const state = store.activate({
      groupId: "group-a",
      campaign,
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-start"
    });

    expect(state).toMatchObject({
      status: "active",
      currentCountdownIndex: 1,
      discoveredClueIds: ["static-phone"],
      notes: ["The group found the static."],
      processedSourceDocumentIds: ["doc-progress", "doc-start"]
    });
  });

  it("resets progressed campaign state to a fresh active mystery", () => {
    const config = testConfig();
    const campaign = loadCampaignPacks(config)[0];
    const store = CampaignStateStore.fromConfig(config);
    store.applyDecision({
      groupId: "group-a",
      campaign,
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-progress",
      automationMode: "suggest",
      decision: {
        keeperMessage: "A pending Keeper note.",
        rollRequest: {
          moveId: "interpret_evidence",
          modifier: 1
        },
        stateChanges: [
          { type: "advance_countdown", by: 2 },
          { type: "add_discovered_clue", clueId: "static-phone" },
          { type: "reveal_threat", threatId: "river-husk" },
          { type: "reveal_npc", npcId: "night-maintenance-crew" },
          { type: "visit_location", locationId: "floodway-underpass" },
          { type: "append_note", text: "Progressed note." }
        ]
      }
    });
    store.markKeeperMessageSent({
      groupId: "group-a",
      text: "A sent Keeper note.",
      requestId: "request-1",
      idempotencyKey: "idem-1",
      sourceDocumentId: "doc-progress"
    });
    store.recordRollResult({
      groupId: "group-a",
      sourceDocumentId: "doc-progress",
      automationMode: "suggest",
      request: {
        moveId: "interpret_evidence",
        modifier: 1
      },
      result: resolvePbtARoll(
        {
          moveId: "interpret_evidence",
          modifier: 1
        },
        { roller: createSequenceDiceRoller([4, 5]) }
      ),
      message: "Roll result."
    });

    const state = store.resetInitialized({
      groupId: "group-a",
      campaign,
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-reset"
    });

    expect(state).toMatchObject({
      status: "active",
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      revealedNpcIds: [],
      visitedLocationIds: [],
      notes: [],
      processedSourceDocumentIds: ["doc-reset"]
    });
    expect(state.pendingDecision).toBeUndefined();
    expect(state.pendingRollRequest).toBeUndefined();
    expect(state.lastKeeperMessage).toBeUndefined();
    expect(state.rollHistory).toEqual([]);
  });

  it("builds spoiler-free mystery intro briefs from public campaign fields only", () => {
    const pack = validateCampaignPack(
      campaignPackFixture({
        genre: "test genre",
        recommendedGroupSize: "3 testers",
        contentWarnings: ["fog"],
        hooks: [{ id: "public-hook", text: "Public hook text." }],
        mysteries: [
          {
            ...mysteryFixture({
              id: "fixture-mystery",
              title: "Public Mystery Title",
              hook: "Public mystery hook.",
              truth: "SECRET_TRUTH",
              monster: {
                name: "SECRET_MONSTER",
                weaknesses: ["SECRET_WEAKNESS"]
              },
              countdown: ["SECRET_COUNTDOWN"],
              clues: [{ id: "secret-clue", text: "SECRET_CLUE" }],
              threatIds: ["secret-threat"]
            })
          }
        ],
        threats: [{ id: "secret-threat", name: "SECRET_THREAT", kind: "monster" }]
      }),
      { source: "local" }
    );
    const brief = spoilerFreeMysteryBrief(pack, "fixture-mystery");
    const serialized = JSON.stringify(brief);

    expect(brief).toMatchObject({
      campaign: {
        title: "Fixture Campaign",
        genre: "test genre",
        tone: ["plain"],
        contentWarnings: ["fog"],
        recommendedGroupSize: "3 testers",
        hooks: [{ id: "public-hook", text: "Public hook text." }]
      },
      mystery: {
        title: "Public Mystery Title",
        hook: "Public mystery hook."
      }
    });
    expect(serialized).not.toContain("SECRET_TRUTH");
    expect(serialized).not.toContain("SECRET_MONSTER");
    expect(serialized).not.toContain("SECRET_THREAT");
    expect(serialized).not.toContain("SECRET_COUNTDOWN");
    expect(serialized).not.toContain("SECRET_CLUE");
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

  it("does not apply the same source document state changes twice", async () => {
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
    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static again."));

    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 1,
      discoveredClueIds: ["static-phone"],
      processedSourceDocumentIds: ["doc-1"]
    });
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

  it("starts a mystery from a user command and stores a suggest-mode spoiler-free intro", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/start-mystery"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent: false,
      keeperMessageSuppressed: true
    });
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      processedSourceDocumentIds: ["doc-start"],
      pendingDecision: {
        sourceDocumentId: "doc-start",
        keeperMessage: "*Rain gathers under the underpass as the first call comes in.*",
        automationMode: "suggest"
      }
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      type: "kinagent.game.mystery_intro",
      command: "start_mystery",
      brief: {
        mystery: {
          id: "the-thing-in-the-floodway",
          title: "The Thing in the Floodway",
          hook: "People vanish near drainage tunnels after heavy rain."
        }
      }
    });
    const serialized = JSON.stringify(payloads[0]);
    expect(serialized).not.toContain("parasitic water-spirit");
    expect(serialized).not.toContain("The River Husk");
    expect(serialized).not.toContain("static-phone");
    expect(serialized).not.toContain("First Sign");
  });

  it("starts a mystery in observe mode without requesting or sending an intro", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/start-mystery"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: false,
      keeperMessageSent: false,
      keeperMessageSuppressed: true
    });
    expect(payloads).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      processedSourceDocumentIds: ["doc-start"]
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("sends a mystery intro immediately for autonomous start commands", async () => {
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
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async () => ({
        status: 200,
        ok: true
      })
    });

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/START-MYSTERY"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent: true,
      keeperMessageSuppressed: false
    });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*Rain gathers under the underpass as the first call comes in.*",
      triggerAiResponse: false
    });
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      lastKeeperMessage: {
        text: "*Rain gathers under the underpass as the first call comes in.*",
        sourceDocumentId: "doc-start"
      }
    });
  });

  it("does not execute game commands from Kin group messages", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-ai-start", "/start-mystery", "ai"));
    await runtime.handleGroupChatChanged(group(), groupNotification("doc-ai-reset", "/reset-mystery", "ai"));
    await runtime.handleGroupChatChanged(group(), groupNotification("doc-ai-end", "/end-mystery", "ai"));

    expect(payloads).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "initialized",
      currentCountdownIndex: 0,
      processedSourceDocumentIds: []
    });
  });

  it("ends a mystery from a user command and stores a suggest-mode ending", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);
    store.applyDecision({
      groupId: "group-a",
      campaign: loadCampaignPacks(config)[0],
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-progress",
      automationMode: "suggest",
      decision: {
        keeperMessage: "Pending old Keeper note.",
        rollRequest: {
          moveId: "interpret_evidence",
          modifier: 1
        },
        stateChanges: [
          { type: "advance_countdown", by: 2 },
          { type: "add_discovered_clue", clueId: "static-phone" },
          { type: "append_note", text: "The group named the thing in the water." }
        ]
      }
    });
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-end", "/end-mystery"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent: false,
      keeperMessageSuppressed: true
    });
    expect(payloads).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "completed",
      currentCountdownIndex: 2,
      discoveredClueIds: ["static-phone"],
      notes: ["The group named the thing in the water."],
      processedSourceDocumentIds: ["doc-progress", "doc-end"],
      pendingDecision: {
        sourceDocumentId: "doc-end",
        keeperMessage: "*The mystery is marked complete. 1 clue(s) and 1 note(s) remain in the case log.*",
        automationMode: "suggest",
        confidence: "high",
        reason: "User completed the selected mystery."
      }
    });
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
  });

  it("skips ordinary group turns after completion but still allows reset", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    store.complete({
      groupId: "group-a",
      campaign: loadCampaignPacks(config)[0],
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-end"
    });
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    const skipped = await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-after", "I check the tunnel.")
    );
    await runtime.handleGroupChatChanged(group(), groupNotification("doc-reset", "/reset-mystery"));

    expect(skipped).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: false,
      keeperMessageSent: false,
      keeperMessageSuppressed: true
    });
    expect(payloads).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      currentCountdownIndex: 0,
      processedSourceDocumentIds: ["doc-reset"]
    });
  });

  it("resets progressed mystery state deterministically and ignores the same reset document", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse());
    store.applyDecision({
      groupId: "group-a",
      campaign: loadCampaignPacks(config)[0],
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-progress",
      automationMode: "suggest",
      decision: {
        keeperMessage: "Pending old Keeper note.",
        stateChanges: [
          { type: "advance_countdown", by: 2 },
          { type: "add_discovered_clue", clueId: "static-phone" },
          { type: "reveal_threat", threatId: "river-husk" },
          { type: "append_note", text: "Old progress." }
        ]
      }
    });
    store.markKeeperMessageSent({
      groupId: "group-a",
      text: "Sent old Keeper note.",
      requestId: "request-1",
      idempotencyKey: "idem-1",
      sourceDocumentId: "doc-progress"
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-reset", "/reset-mystery"));

    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      notes: [],
      processedSourceDocumentIds: ["doc-reset"]
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();

    store.applyDecision({
      groupId: "group-a",
      campaign: loadCampaignPacks(config)[0],
      mysteryId: "the-thing-in-the-floodway",
      sourceDocumentId: "doc-after-reset",
      automationMode: "observe",
      decision: {
        stateChanges: [{ type: "add_discovered_clue", clueId: "static-phone" }]
      }
    });
    await runtime.handleGroupChatChanged(group(), groupNotification("doc-reset", "/reset-mystery"));

    expect(store.getForGroup("group-a")).toMatchObject({
      discoveredClueIds: ["static-phone"],
      processedSourceDocumentIds: ["doc-reset", "doc-after-reset"]
    });
  });

  it("starts or resets state without crashing when intro generation is unavailable", async () => {
    const config = testConfig({ hermesEnabled: false });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesTextResponse("not json"));

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/start-mystery"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: false,
      keeperMessageSent: false,
      keeperMessageSuppressed: true
    });
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      processedSourceDocumentIds: ["doc-start"]
    });
  });

  it("handles malformed intro responses without reclassifying commands as generic Hermes turns", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesTextResponse("not json"));

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/start-mystery"));

    expect(shouldSkipGenericHermesGroupHandling(result)).toBe(true);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      processedSourceDocumentIds: ["doc-start"]
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
  });

  it("keeps failed autonomous command sends inside Group Gaming handling", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesIntroResponse(), {
      sendGroupMessage: async (input) => ({
        status: 503,
        ok: false,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        responseText: "temporary failure"
      }),
      updateGroupCurrentScene: async () => ({
        status: 200,
        ok: true
      })
    });

    const result = await runtime.handleGroupChatChanged(group(), groupNotification("doc-start", "/start-mystery"));

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent: false
    });
    expect(shouldSkipGenericHermesGroupHandling(result)).toBe(true);
    expect(store.getForGroup("group-a")).toMatchObject({
      status: "active",
      pendingDecision: {
        sourceDocumentId: "doc-start",
        keeperMessage: "*Rain gathers under the underpass as the first call comes in.*",
        automationMode: "autonomous"
      }
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

  it("resolves PbtA 10+, 7-9, and 6- roll outcomes with deterministic dice", () => {
    expect(
      resolvePbtARoll({ moveId: "interpret_evidence", modifier: 0 }, { roller: createSequenceDiceRoller([6, 4]) })
    ).toMatchObject({
      dice: [6, 4],
      total: 10,
      outcome: "10+"
    });
    expect(
      resolvePbtARoll({ moveId: "interpret_evidence", modifier: 0 }, { roller: createSequenceDiceRoller([3, 4]) })
    ).toMatchObject({
      dice: [3, 4],
      total: 7,
      outcome: "7-9"
    });
    expect(
      resolvePbtARoll({ moveId: "interpret_evidence", modifier: 0 }, { roller: createSequenceDiceRoller([3, 3]) })
    ).toMatchObject({
      dice: [3, 3],
      total: 6,
      outcome: "6-"
    });
  });

  it("auto-resolves observe-mode rolls locally without Keeper output", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const sends: unknown[] = [];
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      hermesDecisionResponse({
        keeperMessage: undefined,
        stateChanges: [],
        rollRequest: {
          moveId: "interpret_evidence",
          actor: "Velma",
          modifier: 2,
          prompt: "Roll +Sharp to read the phone static.",
          reason: "The player is investigating a clue under uncertainty."
        }
      }),
      {
        sendGroupMessage: async (input) => {
          sends.push(input);
          return {
            status: 200,
            ok: true,
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey
          };
        },
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      { diceRoller: createSequenceDiceRoller([4, 5]) }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 0,
      rollHistory: [
        {
          sourceDocumentId: "doc-1",
          automationMode: "observe",
          result: {
            dice: [4, 5],
            modifier: 2,
            total: 11,
            outcome: "10+"
          }
        }
      ]
    });
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("auto-resolves suggest-mode rolls and stores post-roll Keeper narration for review", async () => {
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
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      [
        hermesDecisionResponse({
          keeperMessage: undefined,
          stateChanges: [],
          rollRequest: {
            moveId: "interpret_evidence",
            actor: "Velma",
            modifier: 1,
            prompt: "Roll +Sharp to read the phone static."
          }
        }),
        hermesPostRollResponse("The clue is useful, but the phone line stays open both ways.")
      ],
      {
        sendGroupMessage: async (input) => {
          sends.push(input);
          return {
            status: 200,
            ok: true,
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey
          };
        },
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      { diceRoller: createSequenceDiceRoller([3, 4]) }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(0);
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")).toMatchObject({
      rollHistory: [
        {
          automationMode: "suggest",
          result: {
            dice: [3, 4],
            modifier: 1,
            total: 8,
            outcome: "7-9"
          }
        }
      ],
      pendingDecision: {
        sourceDocumentId: "doc-1",
        automationMode: "suggest",
        keeperMessage:
          "*(Outcome: partial success with complication.) The clue is useful, but the phone line stays open both ways.*"
      }
    });
  });

  it("auto-resolves autonomous roll requests with Kinagent dice", async () => {
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
    const hermesPayloads: Record<string, unknown>[] = [];
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      [
        hermesDecisionResponse({
          keeperMessage: undefined,
          stateChanges: [],
          rollRequest: {
            moveId: "interpret_evidence",
            actor: "Velma",
            modifier: 2,
            prompt: "Roll +Sharp to read the phone static.",
            reason: "The player is investigating a clue under uncertainty."
          }
        }),
        hermesPostRollResponse("The static resolves into a clear street address.")
      ],
      {
        sendGroupMessage: async (input) => {
          sends.push(input);
          return {
            status: 200,
            ok: true,
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey
          };
        },
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      {
        diceRoller: createSequenceDiceRoller([4, 5]),
        onFetch: (_input, init) => {
          hermesPayloads.push(gamePromptPayloadFromFetchInit(init));
        }
      }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*(Outcome: success.) The static resolves into a clear street address.*",
      triggerAiResponse: false
    });
    expect(hermesPayloads[1]).toMatchObject({
      type: "kinagent.game.post_roll_narration",
      roll: {
        summary: "success",
        outcome: "10+",
        total: 11,
        dice: [4, 5],
        modifier: 2
      }
    });
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")).toMatchObject({
      rollHistory: [
        {
          sourceDocumentId: "doc-1",
          automationMode: "autonomous",
          result: {
            dice: [4, 5],
            modifier: 2,
            total: 11,
            outcome: "10+"
          },
          sent: {
            ok: true,
            status: 200
          }
        }
      ]
    });
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toMatchObject({
      text: "*(Outcome: success.) The static resolves into a clear street address.*",
      sourceDocumentId: "doc-1"
    });
  });

  it("sends approved suggest-mode post-roll Keeper narration through the existing review path", async () => {
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
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      [
        hermesDecisionResponse({
          keeperMessage: undefined,
          stateChanges: [],
          rollRequest: {
            moveId: "interpret_evidence",
            actor: "Velma",
            modifier: 1,
            prompt: "Roll +Sharp to read the phone static."
          }
        }),
        hermesPostRollResponse("The clue is useful, but the phone line stays open both ways.")
      ],
      {
        sendGroupMessage: async (input) => {
          sends.push(input);
          return {
            status: 200,
            ok: true,
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey
          };
        },
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      { diceRoller: createSequenceDiceRoller([3, 4]) }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(0);
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")).toMatchObject({
      rollHistory: [
        {
          automationMode: "suggest",
          result: {
            dice: [3, 4],
            modifier: 1,
            total: 8,
            outcome: "7-9"
          }
        }
      ]
    });

    await runtime.approvePendingKeeperMessage(group());

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      message:
        "*(Outcome: partial success with complication.) The clue is useful, but the phone line stays open both ways.*"
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.rollHistory.at(-1)?.sent).toMatchObject({
      ok: true,
      status: 200
    });
  });

  it("creates fallback suggest-mode post-roll narration when Hermes narration is malformed", async () => {
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
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      [
        hermesDecisionResponse({
          keeperMessage: undefined,
          stateChanges: [],
          rollRequest: {
            moveId: "interpret_evidence",
            actor: "Velma",
            modifier: 0
          }
        }),
        hermesTextResponse("not json")
      ],
      {
        sendGroupMessage: async (input) => {
          sends.push(input);
          return {
            status: 200,
            ok: true,
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey
          };
        },
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      { diceRoller: createSequenceDiceRoller([3, 3]) }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(0);
    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")?.pendingDecision?.keeperMessage).toBe(
      "*(Outcome: failure with complication.) The consequence lands immediately, and the situation turns worse.*"
    );
    expect(store.getForGroup("group-a")).toMatchObject({
      rollHistory: [
        {
          result: {
            dice: [3, 3],
            total: 6,
            outcome: "6-"
          }
        }
      ]
    });
  });

  it("records failed autonomous post-roll sends without marking Keeper success", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      [
        hermesDecisionResponse({
          keeperMessage: undefined,
          stateChanges: [],
          rollRequest: {
            moveId: "interpret_evidence",
            modifier: 0
          }
        }),
        hermesPostRollResponse("The consequence lands in the room at once.")
      ],
      {
        sendGroupMessage: async (input) => ({
          status: 503,
          ok: false,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          responseText: "temporary failure"
        }),
        updateGroupCurrentScene: async () => ({
          status: 200,
          ok: true
        })
      },
      { diceRoller: createSequenceDiceRoller([3, 3]) }
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(store.getForGroup("group-a")?.pendingRollRequest).toBeUndefined();
    expect(store.getForGroup("group-a")).toMatchObject({
      rollHistory: [
        {
          result: {
            dice: [3, 3],
            total: 6,
            outcome: "6-"
          },
          sent: {
            ok: false,
            status: 503,
            responseText: "temporary failure"
          }
        }
      ]
    });
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("bounds roll history to the most recent entries", () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "suggest"
    });
    const store = CampaignStateStore.fromConfig(config);

    for (let index = 0; index < 30; index += 1) {
      store.ensureInitialized({
        groupId: "group-a",
        campaign: loadCampaignPacks(config)[0],
        mysteryId: "the-thing-in-the-floodway"
      });
      store.recordRollResult({
        groupId: "group-a",
        sourceDocumentId: `doc-${index}`,
        automationMode: "suggest",
        request: {
          moveId: "interpret_evidence",
          modifier: 0
        },
        result: resolvePbtARoll(
          {
            moveId: "interpret_evidence",
            modifier: 0
          },
          { roller: createSequenceDiceRoller([4, 4]) }
        ),
        message: "Outcome: partial success with complication."
      });
    }

    const history = store.getForGroup("group-a")?.rollHistory ?? [];
    expect(history).toHaveLength(24);
    expect(history[0]?.sourceDocumentId).toBe("doc-6");
    expect(history[23]?.sourceDocumentId).toBe("doc-29");
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

  it("does not mutate campaign state or send autonomous Keeper messages after Kin turns", async () => {
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

    const result = await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-1", "Velma thinks through the clue.", "ai")
    );

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: false,
      keeperMessageSent: false
    });
    expect(sends).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      notes: []
    });
    expect(store.getForGroup("group-a")?.pendingDecision).toBeUndefined();
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("buffers Kin group turns and sends them with the next user turn", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-ai-1", "Velma studies the static.", "ai", "2026-06-06T00:00:00.000Z")
    );
    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-ai-2", "Daphne checks the puddle.", "ai", "2026-06-06T00:01:00.000Z")
    );

    expect(payloads).toHaveLength(0);
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 0,
      processedSourceDocumentIds: []
    });

    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-user-1", "I ask what the radio is saying.", "user", "2026-06-06T00:02:00.000Z")
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      event: {
        documentId: "doc-user-1",
        sender: "user",
        text: "I ask what the radio is saying."
      },
      turn: {
        closedBy: "user",
        contextMessages: [
          {
            documentId: "doc-ai-1",
            sender: "ai",
            text: "Velma studies the static."
          },
          {
            documentId: "doc-ai-2",
            sender: "ai",
            text: "Daphne checks the puddle."
          }
        ],
        userMessage: {
          documentId: "doc-user-1",
          sender: "user",
          text: "I ask what the radio is saying."
        }
      }
    });
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 1,
      processedSourceDocumentIds: ["doc-user-1"]
    });
  });

  it("sends autonomous Keeper messages without triggering a Kindroid AI response", async () => {
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
      updateGroupCurrentScene: async () => ({
        status: 200,
        ok: true
      })
    });

    await runtime.handleGroupChatChanged(
      group({ useManualTurntaking: true }),
      groupNotification("doc-ai-1", "Velma studies the static.", "ai", "2026-06-06T00:00:00.000Z")
    );
    await runtime.handleGroupChatChanged(
      group({ useManualTurntaking: true }),
      groupNotification("doc-user-1", "I ask what the radio is saying.", "user", "2026-06-06T00:01:00.000Z")
    );

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*The phone hisses louder near the puddle.*",
      triggerAiResponse: false
    });
  });

  it("ignores duplicate Kin document ids in the group turn buffer", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const payloads: Array<Record<string, unknown>> = [];
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), undefined, {
      onFetch: (_input, init) => {
        payloads.push(gamePromptPayloadFromFetchInit(init));
      }
    });

    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-ai-1", "Velma studies the static.", "ai", "2026-06-06T00:00:00.000Z")
    );
    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-ai-1", "Velma repeats the same document.", "ai", "2026-06-06T00:01:00.000Z")
    );
    await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-user-1", "I ask what changed.", "user", "2026-06-06T00:02:00.000Z")
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      turn: {
        contextMessages: [
          {
            documentId: "doc-ai-1",
            text: "Velma studies the static."
          }
        ]
      }
    });
  });

  it("reports failed autonomous Keeper sends without marking them sent", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "autonomous"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(config, preferences, store, hermesDecisionResponse(), {
      sendGroupMessage: async (input) => ({
        status: 503,
        ok: false,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        responseText: "temporary failure"
      }),
      updateGroupCurrentScene: async () => ({
        status: 200,
        ok: true
      })
    });

    const result = await runtime.handleGroupChatChanged(
      group(),
      groupNotification("doc-1", "I inspect the phone static.")
    );

    expect(result).toMatchObject({
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent: false
    });
    expect(shouldSkipGenericHermesGroupHandling(result)).toBe(true);
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 1,
      pendingDecision: {
        sourceDocumentId: "doc-1",
        keeperMessage: "*The phone hisses louder near the puddle.*",
        automationMode: "autonomous"
      }
    });
    expect(store.getForGroup("group-a")?.lastKeeperMessage).toBeUndefined();
  });

  it("surfaces empty autonomous Hermes decisions instead of silently consuming user turns", async () => {
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
    const runtime = testGameRuntime(config, preferences, store, hermesTextResponse("not json"), {
      sendGroupMessage: async (input) => {
        sends.push(input);
        return {
          status: 200,
          ok: true,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey
        };
      },
      updateGroupCurrentScene: async () => ({
        status: 200,
        ok: true
      })
    });

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      groupId: "group-a",
      message: "*The moment hangs unresolved. What do you do next?*",
      triggerAiResponse: false
    });
    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      processedSourceDocumentIds: ["doc-1"],
      lastKeeperMessage: {
        text: "*The moment hangs unresolved. What do you do next?*",
        sourceDocumentId: "doc-1"
      }
    });
  });

  it("ignores unknown Hermes state change types and ids", async () => {
    const config = testConfig({ hermesEnabled: true });
    const preferences = GroupGamingPreferenceStore.fromConfig(config);
    preferences.set("group-a", {
      enabled: true,
      campaignId: "prairie-saints-and-municipal-ghosts",
      mysteryId: "the-thing-in-the-floodway",
      automationMode: "observe"
    });
    const store = CampaignStateStore.fromConfig(config);
    const runtime = testGameRuntime(
      config,
      preferences,
      store,
      hermesDecisionResponse({
        keeperMessage: undefined,
        stateChanges: [
          { type: "teleport_group", locationId: "floodway-underpass" },
          { type: "add_discovered_clue", clueId: "missing-clue" },
          { type: "reveal_threat", threatId: "missing-threat" },
          { type: "reveal_npc", npcId: "missing-npc" },
          { type: "visit_location", locationId: "missing-location" }
        ]
      })
    );

    await runtime.handleGroupChatChanged(group(), groupNotification("doc-1", "I inspect the phone static."));

    expect(store.getForGroup("group-a")).toMatchObject({
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      revealedNpcIds: [],
      visitedLocationIds: []
    });
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
  hermesResponse: unknown | unknown[],
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
  },
  options: {
    onFetch?: (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => void;
    diceRoller?: DiceRoller;
  } = {}
): GameRuntime {
  const hermesResponses = Array.isArray(hermesResponse) ? [...hermesResponse] : [hermesResponse];
  let hermesResponseIndex = 0;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    options.onFetch?.(input, init);
    const nextResponse =
      hermesResponses[Math.min(hermesResponseIndex, hermesResponses.length - 1)] ?? hermesDecisionResponse();
    hermesResponseIndex += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(nextResponse)
    };
  });
  return new GameRuntime({
    config,
    logger: testLogger,
    preferences,
    campaignStates,
    dedupeStore: new InMemoryDedupeStore(10_000),
    kindroidClient,
    diceRoller: options.diceRoller,
    onStateUpdated: () => undefined,
    onKeeperMessageSent: () => undefined,
    onPendingDecision: () => undefined
  });
}

function gamePromptPayloadFromFetchInit(init: Parameters<typeof fetch>[1]): Record<string, unknown> {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  return JSON.parse(body.messages[1]?.content ?? "{}") as Record<string, unknown>;
}

function hermesDecisionResponse(overrides: Record<string, unknown> = {}) {
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
            reason: "The group is investigating a known clue.",
            ...overrides
          })
        }
      }
    ]
  };
}

function hermesIntroResponse(overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            keeperMessage: "Rain gathers under the underpass as the first call comes in.",
            reason: "The selected mystery has just started.",
            ...overrides
          })
        }
      }
    ]
  };
}

function hermesPostRollResponse(keeperMessage: string, overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            keeperMessage,
            reason: "The fixed roll result determines the immediate consequence.",
            ...overrides
          })
        }
      }
    ]
  };
}

function hermesTextResponse(content: string) {
  return {
    choices: [
      {
        message: {
          content
        }
      }
    ]
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

function campaignPackFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "fixture-campaign",
    title: "Fixture Campaign",
    rulesetStyle: "pbta-mystery-hunt",
    license: "test",
    tone: ["plain"],
    contentWarnings: [],
    mysteries: [mysteryFixture()],
    threats: [{ id: "known-threat", name: "Known Threat", kind: "monster" }],
    locations: [{ id: "known-location", name: "Known Location" }],
    npcs: [{ id: "known-npc", name: "Known NPC" }],
    hooks: [{ id: "known-hook", text: "Known hook." }],
    ...overrides
  };
}

function mysteryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "fixture-mystery",
    title: "Fixture Mystery",
    hook: "A local test hook.",
    truth: "The test truth.",
    clues: [{ id: "known-clue", text: "Known clue." }],
    threatIds: ["known-threat"],
    locationIds: ["known-location"],
    npcIds: ["known-npc"],
    ...overrides
  };
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
