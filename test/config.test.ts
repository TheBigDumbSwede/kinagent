import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfig } from "../src/config/loadConfig.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads defaults when the config file is missing", () => {
    vi.stubEnv("KINAGENT_OPENAI_IMAGE_API_KEY", "");
    vi.stubEnv("OPENAI_IMAGE_API_KEY", "");
    vi.stubEnv("KINAGENT_OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const missingConfig = path.join(tempDir, "missing.yaml");

    const config = loadConfig({ configPath: missingConfig });

    expect(config.kindroid.apiKey).toBe("");
    expect(config.kindroid.firebaseProjectId).toBe("kindroid-ai");
    expect(config.bridge.sessionDir).toBe(path.resolve(process.cwd(), "./data/browser-session"));
    expect(config.hermes.enabled).toBe(false);
    expect(config.hermes.journalSuggestions).toEqual({
      enabled: true,
      throttleMessages: 20,
      strongEventBypass: true
    });
    expect(config.hermes.groupBackgrounds.images).toEqual({
      enabled: true,
      provider: "openai",
      openai: {
        apiKey: "",
        model: "gpt-image-1",
        size: "1536x1024",
        quality: "medium"
      }
    });
    expect(config.hermes.groupBackgrounds.suggestions).toEqual({
      enabled: false,
      autonomous: false,
      minMessagesBetweenProposals: 12,
      minSignificance: 0.7
    });
    expect(config.hermes.chatDynamism).toEqual({
      suggestions: {
        enabled: true
      },
      autoAdjust: {
        enabled: false,
        minTurnsBetweenAdjustments: 12,
        min: 0.8,
        max: 1.4,
        maxDelta: 0.2
      }
    });
    expect(config.voice).toMatchObject({
      enabled: false,
      provider: "none",
      openai: {
        model: "gpt-4o-mini-tts",
        voice: "marin"
      },
      elevenlabs: {
        model: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128"
      }
    });
  });

  it("creates a default config file when requested", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const configPath = path.join(tempDir, "config.yaml");

    const config = loadConfig({ configPath, createDefaultConfig: true });

    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, "utf8")).toContain("kindroid:");
    expect(config.bridge.sqlitePath).toBe(path.resolve(process.cwd(), "./data/bridge.sqlite"));
  });

  it("saves config files that can be loaded again", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const configPath = path.join(tempDir, "config.yaml");
    const config = loadConfig({ configPath, createDefaultConfig: true });

    config.hermes.enabled = true;
    config.hermes.baseUrl = "http://127.0.0.1:9000/v1";
    saveConfig(config, configPath);

    const reloaded = loadConfig({ configPath });

    expect(reloaded.hermes.enabled).toBe(true);
    expect(reloaded.hermes.baseUrl).toBe("http://127.0.0.1:9000/v1");
  });

  it("merges file config and environment overrides", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const configPath = path.join(tempDir, "config.yaml");
    fs.writeFileSync(
      configPath,
      [
        "kindroid:",
        '  apiKey: "file-kindroid-key"',
        '  firebaseProjectId: "file-project"',
        '  uid: "file-uid"',
        "  kins:",
        '    - name: "Brielle"',
        '      aiId: "kin-1"',
        "      enabled: true",
        "bridge:",
        "  dedupeWindowSeconds: 30",
        '  logPath: "./kinagent-test.log"',
        '  logLevel: "warn"',
        '  sessionDir: "./session"',
        "hermes:",
        "  enabled: true",
        '  baseUrl: "http://example.test"',
        '  apiKey: "file-token"',
        '  agentId: "agent-from-file"',
        "  currentSceneUpdates:",
        "    enabled: false",
        "    maxLength: 120",
        "  journalSuggestions:",
        "    enabled: false",
        "    throttleMessages: 12",
        "    strongEventBypass: false",
        "  chatDynamism:",
        "    suggestions:",
        "      enabled: true",
        "    autoAdjust:",
        "      enabled: false",
        "      minTurnsBetweenAdjustments: 10",
        "      min: 0.5",
        "      max: 1.1",
        "      maxDelta: 0.04",
        "voice:",
        "  enabled: true",
        '  provider: "openai"',
        "  openai:",
        '    model: "file-tts"',
        '    voice: "file-voice"',
        '    instructions: "speak warmly"',
        "  elevenlabs:",
        '    model: "file-eleven"'
      ].join("\n")
    );

    vi.stubEnv("KINDROID_UID", "env-uid");
    vi.stubEnv("KINAGENT_KINDROID_API_KEY", "env-kindroid-key");
    vi.stubEnv("BRIDGE_LOG_LEVEL", "debug");
    vi.stubEnv("HERMES_ENABLED", "false");
    vi.stubEnv("HERMES_API_KEY", "env-token");
    vi.stubEnv("HERMES_CURRENT_SCENE_UPDATES_ENABLED", "true");
    vi.stubEnv("HERMES_JOURNAL_SUGGESTIONS_ENABLED", "true");
    vi.stubEnv("HERMES_JOURNAL_SUGGESTION_THROTTLE_MESSAGES", "15");
    vi.stubEnv("HERMES_JOURNAL_STRONG_EVENT_BYPASS", "true");
    vi.stubEnv("HERMES_GROUP_BACKGROUNDS_ENABLED", "true");
    vi.stubEnv("HERMES_GROUP_BACKGROUNDS_AUTONOMOUS", "true");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_SUGGESTIONS_ENABLED", "false");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_AUTO_ADJUST_ENABLED", "false");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_MIN_TURNS_BETWEEN_ADJUSTMENTS", "14");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_MIN", "0.85");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_MAX", "1.35");
    vi.stubEnv("HERMES_CHAT_DYNAMISM_MAX_DELTA", "0.03");
    vi.stubEnv("KINAGENT_OPENAI_IMAGE_API_KEY", "env-image-key");
    vi.stubEnv("KINAGENT_OPENAI_IMAGE_MODEL", "gpt-image-test");
    vi.stubEnv("KINAGENT_OPENAI_IMAGE_SIZE", "1024x1024");
    vi.stubEnv("KINAGENT_OPENAI_IMAGE_QUALITY", "low");
    vi.stubEnv("KINAGENT_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("KINAGENT_OPENAI_API_KEY", "env-openai");
    vi.stubEnv("KINAGENT_OPENAI_TTS_VOICE", "alloy");
    vi.stubEnv("KINAGENT_ELEVENLABS_API_KEY", "env-elevenlabs");

    const config = loadConfig({ configPath });

    expect(config.kindroid.apiKey).toBe("env-kindroid-key");
    expect(config.kindroid.firebaseProjectId).toBe("file-project");
    expect(config.kindroid.uid).toBe("env-uid");
    expect(config.kindroid.kins).toEqual([{ name: "Brielle", aiId: "kin-1", enabled: true }]);
    expect(config.bridge.dedupeWindowSeconds).toBe(30);
    expect(config.bridge.logPath).toBe(path.resolve(process.cwd(), "./kinagent-test.log"));
    expect(config.bridge.logLevel).toBe("debug");
    expect(config.bridge.sessionDir).toBe(path.resolve(process.cwd(), "./session"));
    expect(config.hermes.enabled).toBe(false);
    expect(config.hermes.baseUrl).toBe("http://example.test");
    expect(config.hermes.apiKey).toBe("env-token");
    expect(config.hermes.currentSceneUpdates).toEqual({ enabled: true, maxLength: 120 });
    expect(config.hermes.journalSuggestions).toEqual({
      enabled: true,
      throttleMessages: 15,
      strongEventBypass: true
    });
    expect(config.hermes.groupBackgrounds.images.openai).toEqual({
      apiKey: "env-image-key",
      model: "gpt-image-test",
      size: "1024x1024",
      quality: "low"
    });
    expect(config.hermes.groupBackgrounds.suggestions).toMatchObject({
      enabled: true,
      autonomous: true
    });
    expect(config.hermes.chatDynamism).toEqual({
      suggestions: {
        enabled: false
      },
      autoAdjust: {
        enabled: false,
        minTurnsBetweenAdjustments: 14,
        min: 0.85,
        max: 1.35,
        maxDelta: 0.03
      }
    });
    expect(config.voice.enabled).toBe(true);
    expect(config.voice.provider).toBe("elevenlabs");
    expect(config.voice.openai).toMatchObject({
      apiKey: "env-openai",
      model: "file-tts",
      voice: "marin",
      instructions: "speak warmly"
    });
    expect(config.voice.elevenlabs).toMatchObject({
      apiKey: "env-elevenlabs",
      model: "file-eleven",
      outputFormat: "mp3_44100_128"
    });
  });

  it("rejects current scene limits above Kindroid's endpoint limit", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-config-"));
    const configPath = path.join(tempDir, "config.yaml");
    fs.writeFileSync(configPath, ["hermes:", "  currentSceneUpdates:", "    maxLength: 161"].join("\n"));

    expect(() => loadConfig({ configPath })).toThrow("hermes.currentSceneUpdates.maxLength cannot exceed 160.");
  });

  it("rejects invalid numeric environment overrides", () => {
    vi.stubEnv("BRIDGE_DEDUPE_WINDOW_SECONDS", "not-a-number");

    expect(() => loadConfig({ configPath: path.join(os.tmpdir(), "missing-kinagent-config.yaml") })).toThrow(
      "BRIDGE_DEDUPE_WINDOW_SECONDS must be a number."
    );
  });
});
