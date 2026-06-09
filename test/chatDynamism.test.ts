import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { runChatDynamismExperiment } from "../src/experiments/chatDynamismExperiment.js";
import {
  clampChatDynamism,
  noticeableChatDynamismDelta,
  parseChatDynamismValue,
  recommendedChatDynamismStartingValue,
  roundChatDynamismStep
} from "../src/kindroid/chatDynamism.js";
import type { Logger } from "../src/util/logger.js";

const tempDirs: string[] = [];

describe("Chat Dynamism helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses numeric values while preserving the raw value", () => {
    expect(parseChatDynamismValue("0.85")).toEqual({
      raw: "0.85",
      numeric: 0.85,
      display: "0.85"
    });
    expect(parseChatDynamismValue(1)).toEqual({
      raw: 1,
      numeric: 1,
      display: "1"
    });
  });

  it("preserves unknown raw values when they are not numeric", () => {
    expect(parseChatDynamismValue({ nested: true })).toEqual({
      raw: { nested: true },
      numeric: null,
      display: '{"nested":true}'
    });
  });

  it("clamps and rounds provisional step values", () => {
    expect(noticeableChatDynamismDelta).toBe(0.05);
    expect(recommendedChatDynamismStartingValue).toBe(0.95);
    expect(clampChatDynamism(-1)).toBe(0.6);
    expect(clampChatDynamism(2)).toBe(1.8);
    expect(roundChatDynamismStep(0.823)).toBe(0.8);
    expect(roundChatDynamismStep(0.826)).toBe(0.85);
  });

  it("builds a dry-run experiment report without writing", async () => {
    const sessionDir = createTestSessionDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        documents: [
          {
            name: "projects/kindroid-ai/databases/(default)/documents/Users/firebase-uid/AIs/kin-1",
            fields: {
              ai_id: { stringValue: "kin-1" },
              ai_name: { stringValue: "Sam" },
              user_set_temperature: { doubleValue: 0.75 },
              reasoning_effort: { stringValue: "medium" },
              llm_flair: { stringValue: "balanced" }
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const report = await runChatDynamismExperiment(testConfig({ sessionDir }), testLogger, {
      kinId: "kin-1",
      target: "0.82",
      dryRun: true,
      requestId: "request-1",
      observeSeconds: 0
    });

    expect(report).toEqual(
      expect.objectContaining({
        experiment: "kindroid.chat_dynamism",
        dryRun: true,
        method: "update-info",
        aiId: "kin-1",
        aiName: "Sam",
        fieldName: "user_set_temperature",
        beforeRaw: 0.75,
        beforeNumeric: 0.75,
        target: 0.8,
        restoreAttempted: false,
        conclusion: "unknown",
        payloadPreview: {
          ai_id: "kin-1",
          user_set_temperature: 0.8
        }
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function createTestSessionDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-chat-dynamism-"));
  tempDirs.push(dir);
  const authStorageKey = ["firebase", "authUser", "test-api-key", "[DEFAULT]"].join(":");
  const accessTokenKey = `access${"Token"}`;
  const refreshTokenKey = `refresh${"Token"}`;
  fs.writeFileSync(
    path.join(dir, "storage-state.json"),
    `${JSON.stringify({
      origins: [
        {
          origin: "https://kindroid.ai",
          localStorage: [
            {
              name: authStorageKey,
              value: JSON.stringify({
                uid: "firebase-uid",
                email: "test@example.com",
                stsTokenManager: {
                  [accessTokenKey]: "test-access-token",
                  [refreshTokenKey]: "test-refresh-token",
                  expirationTime: Date.now() + 3_600_000
                }
              })
            }
          ]
        }
      ]
    })}\n`
  );
  return dir;
}

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function testConfig(overrides: { sessionDir: string }): AppConfig {
  return {
    kindroid: {
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: "kinagent.log",
      logLevel: "info",
      sessionDir: overrides.sessionDir,
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
