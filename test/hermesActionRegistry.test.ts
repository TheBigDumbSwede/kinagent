import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { ChatDynamismSuggestionStore } from "../src/chatDynamism/chatDynamismSuggestionStore.js";
import { createHermesActionRegistry, hermesActionRegistryEntries } from "../src/hermes/actionRegistry.js";
import type { KindroidSceneUpdater } from "../src/hermes/hermesAdapter.js";
import { JournalSuggestionStore } from "../src/journal/journalSuggestionStore.js";
import { LocalSceneStateStore } from "../src/localScene/localSceneStore.js";
import { InMemoryDedupeStore } from "../src/state/dedupeStore.js";
import type { Logger } from "../src/util/logger.js";

describe("Hermes action registry", () => {
  it("documents the currently implemented Hermes action types", () => {
    expect(hermesActionRegistryEntries.flatMap((entry) => entry.actionTypes)).toEqual([
      "update_local_scene_state",
      "update_group_local_scene_state",
      "update_current_scene",
      "update_group_current_scene",
      "update_soundscape",
      "update_group_soundscape",
      "send_ambient_context_turn",
      "propose_journal_entry",
      "delete_journal_entry",
      "propose_chat_dynamism_adjustment"
    ]);
  });

  it("registers only current scene actions without journal suggestion storage", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testSceneUpdater
    });

    expect(registry.handlers).toHaveLength(1);
    expect(registry.journalContextProvider).toBeUndefined();
    expect(registry.handlers.flatMap((handler) => handler.promptLines()).join("\n")).toContain("update_current_scene");
  });

  it("registers ambient context actions when outbound dedupe is available", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testKindroidClient,
      options: {
        dedupeStore: new InMemoryDedupeStore(60_000)
      }
    });

    const prompt = registry.handlers.flatMap((handler) => handler.promptLines()).join("\n");
    expect(registry.handlers).toHaveLength(2);
    expect(prompt).toContain("send_ambient_context_turn");
    expect(prompt).toContain("current conversation and current setting");
    expect(prompt).toContain("Do not use send_ambient_context_turn for group chats");
    expect(prompt).toContain("Do not use send_ambient_context_turn as a substitute for other registered actions");
  });

  it("registers soundscape actions when local soundscapes are enabled", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testSceneUpdater,
      options: {
        onSoundscapeUpdated: () => undefined,
        isSoundscapeEnabled: () => true
      }
    });

    const prompt = registry.handlers.flatMap((handler) => handler.promptLines()).join("\n");
    expect(registry.handlers).toHaveLength(2);
    expect(prompt).toContain("update_soundscape");
    expect(prompt).toContain("update_group_soundscape");
    expect(prompt).toContain("control-plane metadata");
  });

  it("registers local scene actions when local scene storage is available", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testSceneUpdater,
      options: {
        localScenes: LocalSceneStateStore.fromConfig(testConfig())
      }
    });

    const prompt = registry.handlers.flatMap((handler) => handler.promptLines()).join("\n");
    expect(registry.handlers).toHaveLength(2);
    expect(prompt).toContain("update_local_scene_state");
    expect(prompt).toContain("update_group_local_scene_state");
    expect(prompt).toContain("backstage Kinagent state only");
    expect(prompt).toContain("must not write Kindroid memory");
  });

  it("registers journal suggestion actions when storage is available", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testSceneUpdater,
      options: {
        journalSuggestions: JournalSuggestionStore.fromConfig(testConfig())
      }
    });

    const prompt = registry.handlers.flatMap((handler) => handler.promptLines()).join("\n");
    expect(registry.handlers).toHaveLength(2);
    expect(registry.journalContextProvider).toBeDefined();
    expect(prompt).toContain("propose_journal_entry");
    expect(prompt).toContain("delete_journal_entry");
  });

  it("registers Chat Dynamism suggestion actions when storage is available", () => {
    const registry = createHermesActionRegistry({
      config: testConfig(),
      logger: testLogger,
      kindroidClient: testSceneUpdater,
      options: {
        chatDynamismSuggestions: ChatDynamismSuggestionStore.fromConfig(testConfig())
      }
    });

    const prompt = registry.handlers.flatMap((handler) => handler.promptLines()).join("\n");
    expect(registry.handlers).toHaveLength(2);
    expect(prompt).toContain("propose_chat_dynamism_adjustment");
    expect(prompt).toContain("Never apply it automatically");
  });
});

const testLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const testSceneUpdater: KindroidSceneUpdater = {
  updateCurrentScene: async () => ({ ok: true, status: 200 }),
  updateGroupCurrentScene: async () => ({ ok: true, status: 200 })
};

const testKindroidClient = {
  ...testSceneUpdater,
  sendMessage: async () => ({
    ok: true,
    status: 200,
    requestId: "request-1",
    idempotencyKey: "idempotency-1"
  }),
  sendGroupMessage: async () => ({
    ok: true,
    status: 200,
    requestId: "request-1",
    idempotencyKey: "idempotency-1"
  })
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
      enabled: true,
      baseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "test-key",
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
          enabled: true
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
