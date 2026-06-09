import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import {
  loadAllKindroidChatHistoryMessages,
  loadRecentKindroidChatHistoryWindow,
  loadRecentKindroidChatHistoryMessages,
  normalizeKindroidChatHistoryMessage
} from "../src/kindroid/chatHistory.js";
import type { Logger } from "../src/util/logger.js";

describe("Kindroid chat history API normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes direct chat messages from get-chat-messages", () => {
    expect(
      normalizeKindroidChatHistoryMessage(
        {
          id: "message-1",
          sender: "Alexis",
          sender_type: "ai",
          display_name: "Alexis",
          timestamp: 1_780_000_000_000,
          message: "The rain starts against the window."
        },
        { scope: "kin", id: "kin-1" }
      )
    ).toMatchObject({
      id: "message-1",
      kinId: "kin-1",
      timestamp: "2026-05-28T20:26:40.000Z",
      text: "The rain starts against the window.",
      textEncrypted: false,
      textDecrypted: true,
      sender: "ai",
      role: "ai"
    });
  });

  it("uses public API source ids for group chat source Kin context", () => {
    expect(
      normalizeKindroidChatHistoryMessage(
        {
          id: "message-2",
          ai_id: "kin-2",
          sender: "Alexis",
          sender_type: "ai",
          timestamp: 1_780_000_001,
          message: "The elevator doors open."
        },
        { scope: "group", id: "group-1" }
      )
    ).toMatchObject({
      id: "message-2",
      kinId: "kin-2",
      groupId: "group-1",
      timestamp: "2026-05-28T20:26:41.000Z",
      sender: "ai",
      role: "ai"
    });
  });

  it("loads recent public API messages without Firestore document reads", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [{ id: "message-1", sender_type: "user", timestamp: 1_780_000_000_000, message: "Hello." }],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_000_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadRecentKindroidChatHistoryMessages(testConfig(), testLogger, { scope: "kin", id: "kin-1", limit: 18 })
    ).resolves.toHaveLength(1);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100"
    );
  });

  it("paginates recent public API reads and returns the newest requested window", async () => {
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { id: "message-1", sender_type: "user", timestamp: 1_780_000_000_000, message: "First." },
            { id: "message-2", sender_type: "ai", timestamp: 1_780_000_001_000, message: "Second." }
          ],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_001_000, limit: 100 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { id: "message-3", sender_type: "user", timestamp: 1_780_000_002_000, message: "Third." },
            { id: "message-4", sender_type: "ai", timestamp: 1_780_000_003_000, message: "Fourth." }
          ],
          pagination: { hasMore: false, lastTimestamp: 1_780_000_003_000, limit: 100 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadRecentKindroidChatHistoryMessages(testConfig(), testLogger, { scope: "kin", id: "kin-1", limit: 2 })
    ).resolves.toEqual([
      expect.objectContaining({ id: "message-3", text: "Third." }),
      expect.objectContaining({ id: "message-4", text: "Fourth." })
    ]);

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100&start_after_timestamp=1780000001000"
    );
  });

  it("reports incomplete recent public API reads when the page budget is exhausted", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          { id: "message-1", sender_type: "user", timestamp: 1_780_000_000_000, message: "First." },
          { id: "message-2", sender_type: "ai", timestamp: 1_780_000_001_000, message: "Second." }
        ],
        pagination: { hasMore: true, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadRecentKindroidChatHistoryWindow(testConfig(), testLogger, {
        scope: "kin",
        id: "kin-1",
        limit: 2,
        maxPages: 1
      })
    ).resolves.toMatchObject({
      complete: false,
      nextStartAfterTimestamp: 1_780_000_001_000,
      pageCount: 1,
      messages: [expect.objectContaining({ id: "message-1" }), expect.objectContaining({ id: "message-2" })]
    });
  });

  it("paginates full public API chat history exports", async () => {
    const fetchMock = vi
      .fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          messages: [{ id: "message-1", sender_type: "user", timestamp: 1_780_000_000_000, message: "First." }],
          pagination: { hasMore: true, lastTimestamp: 1_780_000_000_000, limit: 100 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [{ id: "message-2", sender_type: "ai", timestamp: 1_780_000_001_000, message: "Second." }],
          pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadAllKindroidChatHistoryMessages(testConfig(), testLogger, { scope: "group", id: "group-1" })
    ).resolves.toEqual([
      expect.objectContaining({ id: "message-1", groupId: "group-1", text: "First." }),
      expect.objectContaining({ id: "message-2", groupId: "group-1", text: "Second." })
    ]);

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?group_id=group-1&limit=100&start_after_timestamp=1780000000000"
    );
  });
});

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
