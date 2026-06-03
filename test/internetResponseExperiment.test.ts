import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { runInternetResponseExperiment } from "../src/experiments/internetResponseExperiment.js";
import type { Logger } from "../src/util/logger.js";

describe("internet_response experiment", () => {
  it("builds a direct Kin dry-run report", async () => {
    const report = await runInternetResponseExperiment(testConfig(), testLogger, {
      kinId: "kin-1",
      message: "What is the diagnostic codename?",
      internetResponse: "The codename is LANTERN-MARMOT-7429.",
      expectedTexts: ["LANTERN-MARMOT-7429"],
      dryRun: true
    });

    expect(report).toMatchObject({
      experiment: "kindroid.internet_response",
      dryRun: true,
      targetType: "kin",
      targetId: "kin-1",
      kinId: "kin-1",
      groupId: undefined,
      expectedTexts: ["LANTERN-MARMOT-7429"],
      conclusion: "unknown"
    });
    expect(report.experimentSend.payloadPreview).toMatchObject({
      ai_id: "kin-1",
      message: "What is the diagnostic codename?",
      internet_response: expect.stringMatching(/^\[REDACTED length=\d+\]$/)
    });
  });

  it("builds a group dry-run report", async () => {
    const report = await runInternetResponseExperiment(testConfig(), testLogger, {
      groupId: "group-1",
      message: "What is the group diagnostic codename?",
      internetResponse: "The group codename is LANTERN-MARMOT-7429.",
      expectedTexts: ["LANTERN-MARMOT-7429"],
      dryRun: true
    });

    expect(report).toMatchObject({
      experiment: "kindroid.internet_response",
      dryRun: true,
      targetType: "group",
      targetId: "group-1",
      kinId: undefined,
      groupId: "group-1",
      expectedTexts: ["LANTERN-MARMOT-7429"],
      conclusion: "unknown"
    });
    expect(report.experimentSend.payloadPreview).toMatchObject({
      group_id: "group-1",
      message: "What is the group diagnostic codename?",
      internet_response: expect.stringMatching(/^\[REDACTED length=\d+\]$/)
    });
    expect(report.experimentSend.payloadPreview).not.toHaveProperty("ai_id");
  });

  it("requires exactly one target", async () => {
    await expect(
      runInternetResponseExperiment(testConfig(), testLogger, {
        kinId: "kin-1",
        groupId: "group-1",
        message: "What is the diagnostic codename?",
        dryRun: true
      })
    ).rejects.toThrow("Use either --kin or --group, not both.");

    await expect(
      runInternetResponseExperiment(testConfig(), testLogger, {
        message: "What is the diagnostic codename?",
        dryRun: true
      })
    ).rejects.toThrow("--kin or --group is required.");
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
