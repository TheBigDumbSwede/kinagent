import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { loadKinVoicePreference, saveKinVoicePreference, voicePreferencesPath } from "../src/voice/voicePreferences.js";

describe("voicePreferences", () => {
  it("defaults to disabled OpenAI voice per Kin", () => {
    const config = testConfig();

    expect(loadKinVoicePreference(config, "kin-1")).toMatchObject({
      enabled: false,
      provider: "openai",
      openaiVoice: "marin",
      elevenLabsVoiceId: "",
      filterNarrationForTts: true,
      narrationDelimiter: "*"
    });
  });

  it("persists a Kin voice preference next to bridge storage", () => {
    const config = testConfig();

    saveKinVoicePreference(config, "kin-1", {
      enabled: true,
      provider: "elevenlabs",
      elevenLabsVoiceId: "voice-id-1"
    });

    expect(loadKinVoicePreference(config, "kin-1")).toMatchObject({
      enabled: true,
      provider: "elevenlabs",
      openaiVoice: "marin",
      elevenLabsVoiceId: "voice-id-1",
      filterNarrationForTts: true,
      narrationDelimiter: "*"
    });
    expect(fs.existsSync(voicePreferencesPath(config))).toBe(true);
  });
});

function testConfig(): AppConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-voice-pref-"));
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
      sessionDir: path.join(tempDir, "session"),
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
      }
    },
    voice: {
      enabled: true,
      provider: "openai",
      openai: {
        apiKey: "openai-token",
        model: "gpt-4o-mini-tts",
        voice: "marin",
        instructions: ""
      },
      elevenlabs: {
        apiKey: "elevenlabs-token",
        model: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128"
      }
    }
  };
}
