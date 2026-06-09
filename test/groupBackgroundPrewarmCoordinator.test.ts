import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { KindroidGroup } from "../src/kindroid/client/index.js";
import { GroupBackgroundPrewarmCoordinator } from "../src/runtime/groupBackgroundPrewarmCoordinator.js";
import { PrewarmStateStore } from "../src/runtime/prewarmStateStore.js";
import type { HermesAdapter } from "../src/hermes/types.js";
import type { Logger } from "../src/util/logger.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("GroupBackgroundPrewarmCoordinator", () => {
  it("uses current local scene context without fetching chat history", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmGroupBackground: vi.fn()
    };

    await coordinator(hermes).prewarmGroup(group("group-1", "Prairie Ghosts"), null, "manual-force", {
      trigger: { documentId: "message-2", timestamp: "2026-06-09T17:40:00.000Z" },
      force: true
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmGroupBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "group",
        groupId: "group-1",
        aiId: "kin-2",
        forceProposal: true,
        text: expect.stringContaining("GROUP_BACKGROUND_PREWARM_REQUEST"),
        groupBackgroundContext: expect.objectContaining({
          enabledForSource: true,
          groupName: "Prairie Ghosts",
          latestSpeakerKinId: "kin-2"
        })
      })
    );
    expect(hermes.prewarmGroupBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "message-2",
        text: expect.stringContaining("Current local scene snapshot:"),
        groupBackgroundContext: expect.objectContaining({
          localScene: expect.objectContaining({
            location: "open prairie near the emergency broadcast antenna"
          })
        })
      })
    );
  });

  it("ignores raw activity events because local scene is the background source of truth", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmGroupBackground: vi.fn()
    };

    await coordinator(hermes).prewarmGroup(group("group-1", "Prairie Ghosts"), null, "activity");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmGroupBackground).not.toHaveBeenCalled();
  });

  it("skips group background prewarm when suggestions are disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmGroupBackground: vi.fn()
    };

    await coordinator(hermes, { enabled: false }).prewarmGroup(group("group-1", "Prairie Ghosts"), null, "test");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmGroupBackground).not.toHaveBeenCalled();
  });

  it("marks a group background proposal source ready", () => {
    const prewarmState = testPrewarmStateStore();
    const instance = coordinator(
      {
        handleChatChanged: vi.fn(),
        prewarmGroupBackground: vi.fn()
      },
      { prewarmState }
    );

    instance.markReady({
      id: "suggestion-1",
      groupId: "group-1",
      title: "Antenna yard",
      prompt: "A quiet antenna yard.",
      reason: "Scene established.",
      evidence: [],
      significance: 0.8,
      sourceDocumentId: "message-1",
      sourceTimestamp: "2026-06-09T17:00:00.000Z",
      createdAt: "2026-06-09T17:01:00.000Z",
      updatedAt: "2026-06-09T17:01:00.000Z",
      status: "pending"
    });

    expect(prewarmState.get({ scope: "group", id: "group-1" })).toEqual(
      expect.objectContaining({
        groupBackgroundReady: true,
        groupBackgroundPrewarmMessageId: "message-1",
        groupBackgroundPrewarmTimestamp: "2026-06-09T17:00:00.000Z"
      })
    );
  });
});

function coordinator(
  hermes: HermesAdapter,
  options: { enabled?: boolean; prewarmState?: PrewarmStateStore } = {}
): GroupBackgroundPrewarmCoordinator {
  return new GroupBackgroundPrewarmCoordinator({
    config: testConfig(),
    logger: testLogger,
    hermes,
    isEnabled: () => options.enabled ?? true,
    groupBackgroundContext: (group, latestSpeakerKinId) => ({
      enabledForSource: true,
      minSignificance: 0.7,
      groupName: group.name,
      latestSpeakerKinId: latestSpeakerKinId ?? "kin-2",
      participants: group.aiIds.map((aiId) => ({ aiId, name: aiId })),
      localScene: {
        scope: "group",
        groupId: group.groupId,
        location: "open prairie near the emergency broadcast antenna",
        timeOfDay: "dusk",
        mood: "eerie",
        activity: "moving from the weather station toward the antenna",
        visualPalette: { sky: "violet dusk", signal: "red warning light" },
        evidence: ["The current scene says the group is outside by the antenna."],
        latestSpeakerKinId: latestSpeakerKinId ?? "kin-2",
        updatedAt: "2026-06-09T17:39:00.000Z",
        sourceDocumentId: "message-2",
        sourceTimestamp: "2026-06-09T17:40:00.000Z"
      },
      mutation: "reviewed-prompt-only"
    }),
    prewarmState: options.prewarmState ?? testPrewarmStateStore()
  });
}

function testPrewarmStateStore(): PrewarmStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-group-background-prewarm-test-"));
  tempDirs.push(dir);
  return new PrewarmStateStore(path.join(dir, "prewarm-state.json"));
}

function group(groupId: string, name: string): KindroidGroup {
  return {
    documentId: groupId,
    groupId,
    name,
    aiIds: ["kin-1", "kin-2"]
  };
}

function testConfig(): AppConfig {
  return {
    kindroid: {
      apiKey: "kn_test-token",
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: "kinagent.log",
      logLevel: "info",
      sessionDir: "session",
      sqlitePath: "bridge.sqlite"
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

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
