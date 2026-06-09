import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { SoundscapePrewarmCoordinator } from "../src/runtime/soundscapePrewarmCoordinator.js";
import type { HermesAdapter } from "../src/hermes/types.js";
import type { KindroidGroup, KindroidKin } from "../src/kindroid/client/index.js";
import { PrewarmStateStore } from "../src/runtime/prewarmStateStore.js";
import { silentSoundscapeState } from "../src/soundscape/SoundscapeState.js";
import type { Logger } from "../src/util/logger.js";

describe("SoundscapePrewarmCoordinator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads direct prewarm context through Kindroid get-chat-messages", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            sender_type: "user",
            timestamp: 1_780_000_000_000,
            message: "Rain starts against the motel window."
          },
          {
            id: "message-2",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "The neon sign buzzes over the empty parking lot."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmSoundscape: vi.fn()
    };

    await coordinator(hermes).prewarmKin(kin("kin-1", "Alexis"), "test");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100"
    );
    expect(hermes.prewarmSoundscape).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        text: expect.stringContaining("Rain starts against the motel window.")
      })
    );
    expect(hermes.prewarmSoundscape).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("The neon sign buzzes over the empty parking lot.")
      })
    );
  });

  it("uses group get-chat-messages with group-owned prewarm gating", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            ai_id: "kin-disabled",
            sender_type: "ai",
            timestamp: 1_780_000_000_000,
            message: "Someone mentions the quiet lobby."
          },
          {
            id: "message-2",
            ai_id: "kin-disabled",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "The elevator dings and the lobby speakers crackle."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmSoundscape: vi.fn()
    };

    await coordinator(hermes).prewarmGroup(
      group("group-1", "Evening Group"),
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-disabled",
        documentId: "live-message-1",
        timestamp: "2026-06-01T12:00:00.000Z",
        text: "New live message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      "test"
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?group_id=group-1&limit=100"
    );
    expect(hermes.prewarmSoundscape).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "group",
        groupId: "group-1",
        aiId: "kin-disabled",
        text: expect.stringContaining("The elevator dings and the lobby speakers crackle.")
      })
    );
  });

  it("skips group get-chat-messages when the group soundscape setting is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmSoundscape: vi.fn()
    };

    await coordinator(hermes, { groupSoundscapeEnabled: false }).prewarmGroup(
      group("group-1", "Evening Group"),
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-1",
        documentId: "live-message-1",
        timestamp: "2026-06-01T12:00:00.000Z",
        text: "New live message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      "test"
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hermes.prewarmSoundscape).not.toHaveBeenCalled();
  });

  it("skips persisted ready soundscapes until live chat advances the source watermark and refresh interval", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-2",
            ai_id: "kin-1",
            sender_type: "ai",
            timestamp: 1_780_000_001_000,
            message: "The lobby speakers crackle."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_001_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmSoundscape: vi.fn()
    };
    const instance = coordinator(hermes);

    instance.markReady({
      scope: "group",
      groupId: "group-1",
      documentId: "message-1",
      sourceTimestamp: "2026-06-01T12:00:00.000Z",
      reason: "ready",
      state: silentSoundscapeState
    });

    await instance.prewarmGroup(group("group-1", "Evening Group"), null, "startup");
    await instance.prewarmGroup(
      group("group-1", "Evening Group"),
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-1",
        documentId: "message-2",
        timestamp: "2026-06-01T12:00:01.000Z",
        text: "New live message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      "activity",
      { trigger: { documentId: "message-2", timestamp: "2026-06-01T12:00:01.000Z" } }
    );
    await instance.prewarmGroup(
      group("group-1", "Evening Group"),
      {
        type: "kindroid.group_chat.changed",
        groupId: "group-1",
        aiId: "kin-1",
        documentId: "message-3",
        timestamp: "2026-06-01T12:15:00.000Z",
        text: "Later live message.",
        sender: "ai",
        role: "ai",
        source: "firestore"
      },
      "activity",
      { trigger: { documentId: "message-3", timestamp: "2026-06-01T12:15:00.000Z" } }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hermes.prewarmSoundscape).toHaveBeenCalledTimes(1);
  });

  it("lets manual force bypass a persisted ready soundscape", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        messages: [
          {
            id: "message-1",
            sender_type: "ai",
            timestamp: 1_780_000_000_000,
            message: "Rain taps the glass."
          }
        ],
        pagination: { hasMore: false, lastTimestamp: 1_780_000_000_000, limit: 100 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hermes: HermesAdapter = {
      handleChatChanged: vi.fn(),
      prewarmSoundscape: vi.fn()
    };
    const instance = coordinator(hermes);

    instance.markReady({
      scope: "kin",
      kinId: "kin-1",
      documentId: "message-1",
      sourceTimestamp: "2026-06-01T12:00:00.000Z",
      reason: "ready",
      state: silentSoundscapeState
    });

    await instance.prewarmKin(kin("kin-1", "Alexis"), "manual-force", { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hermes.prewarmSoundscape).toHaveBeenCalledTimes(1);
  });
});

function coordinator(
  hermes: HermesAdapter,
  options: { groupSoundscapeEnabled?: boolean } = {}
): SoundscapePrewarmCoordinator {
  return new SoundscapePrewarmCoordinator({
    config: testConfig(),
    logger: testLogger,
    hermes,
    isKinSoundscapeEnabled: (kinId) => kinId === "kin-1",
    isGroupSoundscapeEnabled: () => options.groupSoundscapeEnabled ?? true,
    isKnownKin: (kinId) => kinId === "kin-1" || kinId === "kin-disabled",
    prewarmState: testPrewarmStateStore()
  });
}

function testPrewarmStateStore(): PrewarmStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-prewarm-test-"));
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
    aiIds: ["kin-1", "kin-disabled"]
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
