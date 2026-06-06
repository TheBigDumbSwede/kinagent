import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { HermesAdapter } from "../src/hermes/types.js";
import type { KindroidGroup, KindroidKin } from "../src/kindroid/client/index.js";
import { PreviouslyOnPrewarmCoordinator } from "../src/runtime/previouslyOnPrewarmCoordinator.js";
import { PrewarmStateStore } from "../src/runtime/prewarmStateStore.js";
import type { Logger } from "../src/util/logger.js";

describe("PreviouslyOnPrewarmCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads direct continuity context through Kindroid get-chat-messages", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            sender_type: "user",
            timestamp: 1_780_000_000_000,
            message: "Bruce jokes about being fine even though he looks exhausted."
          },
          {
            id: "message-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "Alexis notices and quietly starts making tea."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };

    await coordinator(hermes).prewarmKin(kin("kin-1", "Alexis"), "test");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100"
    );
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        documentId: "message-2",
        text: expect.stringContaining("PREVIOUSLY_ON_PREWARM_REQUEST")
      })
    );
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Alexis notices and quietly starts making tea.")
      })
    );
  });

  it("uses group get-chat-messages and keeps group-owned brief scope", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            ai_id: "kin-2",
            sender_type: "ai",
            timestamp: 1_780_000_000_000,
            message: "The group leaves the hotel lobby."
          },
          {
            id: "message-2",
            ai_id: "kin-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "Nobody can find the room key."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };

    await coordinator(hermes).prewarmGroup(group("group-1", "Evening Group"), null, "test");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?group_id=group-1&limit=100"
    );
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "group",
        groupId: "group-1",
        aiId: "kin-2",
        documentId: "message-2",
        text: expect.stringContaining("Nobody can find the room key.")
      })
    );
  });

  it("only fetches again when a live trigger moves past the persisted watermark", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "Alexis sets the tea down."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };
    const instance = coordinator(hermes);

    instance.markReady({
      scope: "kin",
      kinId: "kin-1",
      updatedAt: "2026-06-01T12:00:00.000Z",
      sourceDocumentId: "message-1",
      sourceTimestamp: "2026-06-01T12:00:00.000Z",
      facts: ["Bruce joked to avoid admitting he was tired."]
    });

    await instance.prewarmKin(kin("kin-1", "Alexis"), "activity", {
      trigger: { documentId: "message-1", timestamp: "2026-06-01T12:00:00.000Z" }
    });
    await instance.prewarmKin(kin("kin-1", "Alexis"), "activity", {
      trigger: { documentId: "message-2", timestamp: "2026-06-01T12:00:01.000Z" }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledTimes(1);
  });

  it("defers prewarm and saves the chat history cursor when public API catch-up is incomplete", async () => {
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            {
              id: "message-1",
              sender_type: "user",
              timestamp: 1_780_000_000_000,
              message: "Very old setup."
            },
            {
              id: "message-2",
              sender_type: "ai",
              timestamp: 1_780_000_001_000,
              message: "Still not current."
            }
          ],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_001_000, limit: 100 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            {
              id: "message-3",
              sender_type: "user",
              timestamp: 1_780_000_002_000,
              message: "A later but still incomplete page."
            },
            {
              id: "message-4",
              sender_type: "ai",
              timestamp: 1_780_000_003_000,
              message: "The newest page is still beyond this one."
            }
          ],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_003_000, limit: 100 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };
    const prewarmState = testPrewarmStateStore();

    await coordinator(hermes, prewarmState).prewarmKin(kin("kin-1", "Alexis"), "manual-force", { force: true });

    expect(hermes.prewarmPreviouslyOn).not.toHaveBeenCalled();
    expect(prewarmState.get({ scope: "kin", id: "kin-1" })).toMatchObject({
      previouslyOnChatHistoryCursorTimestamp: 1_780_000_003_000
    });
  });

  it("continues deferred chat history catch-up automatically", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { id: "message-1", sender_type: "user", timestamp: 1_780_000_000_000, message: "Older setup." },
            { id: "message-2", sender_type: "ai", timestamp: 1_780_000_001_000, message: "Still older." }
          ],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_001_000, limit: 100 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { id: "message-3", sender_type: "user", timestamp: 1_780_000_002_000, message: "Middle setup." },
            { id: "message-4", sender_type: "ai", timestamp: 1_780_000_003_000, message: "Middle response." }
          ],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_003_000, limit: 100 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { id: "message-5", sender_type: "user", timestamp: 1_780_000_004_000, message: "Current setup." },
            { id: "message-6", sender_type: "ai", timestamp: 1_780_000_005_000, message: "Current response." }
          ],
          pagination: { hasMore: false, lastTimestamp: 1_780_000_005_000, limit: 100 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };
    const prewarmState = testPrewarmStateStore();

    await coordinator(hermes, prewarmState).prewarmKin(kin("kin-1", "Alexis"), "manual-force", { force: true });
    expect(hermes.prewarmPreviouslyOn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "message-6",
        text: expect.stringContaining("Current response.")
      })
    );
  });

  it("can resume persisted Kin chat history catch-up without a manual refresh", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          { id: "message-7", sender_type: "user", timestamp: 1_780_000_006_000, message: "Persisted setup." },
          { id: "message-8", sender_type: "ai", timestamp: 1_780_000_007_000, message: "Persisted response." }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_007_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmPreviouslyOn: vi.fn()
    };
    const prewarmState = testPrewarmStateStore();
    prewarmState.markChatHistoryCursor("previouslyOn", { scope: "kin", id: "kin-1" }, 1_780_000_005_000);

    coordinator(hermes, prewarmState).resumeKinCatchup(kin("kin-1", "Alexis"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100&start_after_timestamp=1780000005000"
    );
    expect(hermes.prewarmPreviouslyOn).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "message-8",
        text: expect.stringContaining("Persisted response.")
      })
    );
    expect(prewarmState.get({ scope: "kin", id: "kin-1" })?.previouslyOnChatHistoryCursorTimestamp).toBeUndefined();
  });
});

function coordinator(hermes: HermesAdapter, prewarmState = testPrewarmStateStore()): PreviouslyOnPrewarmCoordinator {
  return new PreviouslyOnPrewarmCoordinator({
    config: testConfig(),
    logger: testLogger,
    hermes,
    prewarmState
  });
}

function testPrewarmStateStore(): PrewarmStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-previously-on-prewarm-test-"));
  return new PrewarmStateStore(path.join(dir, "prewarm-state.json"));
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
      enabled: true,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "local-hermes-token",
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
