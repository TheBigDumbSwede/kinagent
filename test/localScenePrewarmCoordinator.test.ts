import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { HermesAdapter } from "../src/hermes/types.js";
import type { KindroidGroup, KindroidKin } from "../src/kindroid/client/index.js";
import { LocalScenePrewarmCoordinator } from "../src/runtime/localScenePrewarmCoordinator.js";
import type { Logger } from "../src/util/logger.js";

describe("LocalScenePrewarmCoordinator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads direct local scene context through Kindroid get-chat-messages", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            sender_type: "user",
            timestamp: 1_780_000_000_000,
            message: "Rain starts against the library windows."
          },
          {
            id: "message-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "The reading room lights are dim except for one desk lamp."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 18 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmLocalScene: vi.fn(),
      prewarmSoundscape: vi.fn()
    };

    await coordinator(hermes).prewarmKin(kin("kin-1", "Alexis"), "test");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=18"
    );
    expect(hermes.prewarmLocalScene).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        text: expect.stringContaining("Rain starts against the library windows.")
      })
    );
    expect(hermes.prewarmLocalScene).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("The reading room lights are dim except for one desk lamp.")
      })
    );
    expect(hermes.prewarmSoundscape).not.toHaveBeenCalled();
  });

  it("uses group get-chat-messages and keeps group-owned scene scope", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            ai_id: "kin-2",
            sender_type: "ai",
            timestamp: 1_780_000_000_000,
            message: "Someone mentions the quiet hotel lobby."
          },
          {
            id: "message-2",
            ai_id: "kin-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "The elevator dings and the lobby speakers crackle."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 18 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmLocalScene: vi.fn(),
      prewarmSoundscape: vi.fn()
    };

    await coordinator(hermes).prewarmGroup(group("group-1", "Evening Group"), null, "test");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?group_id=group-1&limit=18"
    );
    expect(hermes.prewarmLocalScene).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "group",
        groupId: "group-1",
        aiId: "kin-2",
        text: expect.stringContaining("The elevator dings and the lobby speakers crackle.")
      })
    );
    expect(hermes.prewarmSoundscape).not.toHaveBeenCalled();
  });

  it("stops prewarming a source after local scene state is ready", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmLocalScene: vi.fn()
    };
    const instance = coordinator(hermes);

    instance.markReady({
      scope: "group",
      groupId: "group-1",
      updatedAt: "2026-06-01T12:00:00.000Z",
      sourceDocumentId: "doc-1",
      sourceTimestamp: "2026-06-01T12:00:00.000Z",
      location: "lobby"
    });
    await instance.prewarmGroup(group("group-1", "Evening Group"), null, "test");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmLocalScene).not.toHaveBeenCalled();
  });

  it("does not load recent messages when Hermes is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmLocalScene: vi.fn()
    };

    await coordinator(hermes, { hermesEnabled: false }).prewarmKin(kin("kin-1", "Alexis"), "test");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmLocalScene).not.toHaveBeenCalled();
  });
});

function coordinator(hermes: HermesAdapter, options: { hermesEnabled?: boolean } = {}): LocalScenePrewarmCoordinator {
  return new LocalScenePrewarmCoordinator({
    config: testConfig(options),
    logger: testLogger,
    hermes
  });
}

function kin(aiId: string, name: string): KindroidKin {
  return {
    documentId: aiId,
    aiId,
    name,
    current: false,
    chatDynamism: {
      raw: undefined,
      numeric: null,
      display: "(not set)"
    }
  };
}

function group(groupId: string, name: string): KindroidGroup {
  return {
    documentId: groupId,
    groupId,
    name,
    aiIds: ["kin-1", "kin-2"]
  };
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function testConfig(options: { hermesEnabled?: boolean } = {}): AppConfig {
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
      enabled: options.hermesEnabled ?? true,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: options.hermesEnabled === false ? "" : "local-hermes-token",
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
