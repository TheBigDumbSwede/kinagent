import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { Logger } from "../src/util/logger.js";
import { VoiceRuntime } from "../src/voice/voiceRuntime.js";
import type { VoicePlaybackChunk } from "../src/voice/types.js";
import { saveKinVoicePreference } from "../src/voice/voicePreferences.js";

describe("VoiceRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call a provider when voice is disabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const output = vi.fn();
    const runtime = new VoiceRuntime({
      config: testConfig({ enabled: false, provider: "openai", apiKey: "token" }),
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue(assistantMessage());
    await runtime.idle();

    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it("does not call a provider without desktop playback", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runtime = new VoiceRuntime({
      config: testConfig({ enabled: true, provider: "openai", apiKey: "token" }),
      logger: testLogger
    });

    runtime.enqueue(assistantMessage());
    await runtime.idle();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips user messages", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const output = vi.fn();
    const runtime = new VoiceRuntime({
      config: testConfig({ enabled: true, provider: "openai", apiKey: "token" }),
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue({ ...assistantMessage(), sender: "user", role: "user" });
    await runtime.idle();

    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it("synthesizes eligible assistant messages once", async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(audio, { status: 200 }));
    const output = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const config = testConfig({ enabled: true, provider: "openai", apiKey: "token" });
    saveKinVoicePreference(config, "kin-1", {
      enabled: true,
      provider: "openai",
      openaiVoice: "nova"
    });
    const runtime = new VoiceRuntime({
      config,
      logger: testLogger,
      desktopPlayback: output
    });

    const message = assistantMessage();
    runtime.enqueue(message);
    runtime.enqueue(message);
    await runtime.idle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const requestInit = fetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      voice: "nova"
    });
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VoicePlaybackChunk>>({
        turnId: "kin-1:message-1",
        provider: "openai",
        format: "mp3",
        kinId: "kin-1"
      })
    );
  });

  it("strips Kindroid narration before synthesis", async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(audio, { status: 200 }));
    const output = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const config = testConfig({ enabled: true, provider: "openai", apiKey: "token" });
    saveKinVoicePreference(config, "kin-1", {
      enabled: true,
      provider: "openai",
      openaiVoice: "marin",
      filterNarrationForTts: true,
      narrationDelimiter: "*"
    });
    const runtime = new VoiceRuntime({
      config,
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue({
      ...assistantMessage(),
      text: "*She leans closer.* Hello there."
    });
    await runtime.idle();

    const requestInit = fetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      input: "Hello there."
    });
  });

  it("synthesizes paragraph chunks in order", async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(audio, { status: 200 }));
    const output = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const config = testConfig({ enabled: true, provider: "openai", apiKey: "token" });
    saveKinVoicePreference(config, "kin-1", {
      enabled: true,
      provider: "openai",
      openaiVoice: "marin"
    });
    const runtime = new VoiceRuntime({
      config,
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue({
      ...assistantMessage(),
      text: "First paragraph.\n\nSecond paragraph."
    });
    await runtime.idle();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      input: "First paragraph."
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      input: "Second paragraph."
    });
    expect(output).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<VoicePlaybackChunk>>({
        sequence: 0,
        boundaryGapMs: 0
      })
    );
    expect(output).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<VoicePlaybackChunk>>({
        sequence: 1,
        boundaryGapMs: 120
      })
    );
  });

  it("skips synthesis when a message only contains stripped narration", async () => {
    const fetch = vi.fn();
    const output = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const config = testConfig({ enabled: true, provider: "openai", apiKey: "token" });
    saveKinVoicePreference(config, "kin-1", {
      enabled: true,
      provider: "openai",
      filterNarrationForTts: true
    });
    const runtime = new VoiceRuntime({
      config,
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue({
      ...assistantMessage(),
      text: "*She looks away.*"
    });
    await runtime.idle();

    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it("does not synthesize until the Kin has voice enabled", async () => {
    const fetch = vi.fn();
    const output = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runtime = new VoiceRuntime({
      config: testConfig({ enabled: true, provider: "openai", apiKey: "token" }),
      logger: testLogger,
      desktopPlayback: output
    });

    runtime.enqueue(assistantMessage());
    await runtime.idle();

    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });
});

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function assistantMessage() {
  return {
    id: "message-1",
    kinId: "kin-1",
    kinName: "Kin",
    sender: "ai",
    role: "assistant",
    text: "Hello from the Kin.",
    textEncrypted: true,
    textDecrypted: true
  };
}

function testConfig(options: {
  enabled: boolean;
  provider: AppConfig["voice"]["provider"];
  apiKey?: string;
}): AppConfig {
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
      sqlitePath: tempSqlitePath()
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
      enabled: options.enabled,
      provider: options.provider,
      openai: {
        apiKey: options.apiKey ?? "",
        model: "gpt-4o-mini-tts",
        voice: "marin",
        instructions: ""
      },
      elevenlabs: {
        apiKey: options.apiKey ?? "",
        model: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128"
      }
    }
  };
}

function tempSqlitePath(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-voice-"));
  return path.join(tempDir, "bridge.sqlite");
}
