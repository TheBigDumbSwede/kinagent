import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatDynamismSuggestionStore } from "../src/chatDynamism/chatDynamismSuggestionStore.js";
import type { AppConfig } from "../src/config/types.js";
import type { KindroidChatNotification } from "../src/firestore/types.js";
import { ChatDynamismActionHandler } from "../src/hermes/chatDynamismActionHandler.js";
import type { Logger } from "../src/util/logger.js";

const tempDirs: string[] = [];

describe("ChatDynamismActionHandler", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts high-confidence direct suggestions without executing a mutation", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store);
    const actions = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-1",
          direction: "increase",
          suggested_delta: 0.05,
          suggested_target: 0.82,
          current_value: 0.75,
          reason: "Recent replies are repetitive across several turns.",
          confidence: "high"
        }
      ]
    });

    expect(actions).toHaveLength(1);
    await handler.handle(directNotification("kin-1"), actions[0]);

    expect(store.list("pending")).toEqual([
      expect.objectContaining({
        aiId: "kin-1",
        direction: "increase",
        currentNumeric: 0.75,
        suggestedTarget: 0.8,
        suggestedDelta: 0.05,
        status: "pending"
      })
    ]);
  });

  it("rejects low-confidence suggestions during normalization", () => {
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, testStore());

    expect(
      handler.normalizeActions({
        actions: [
          {
            type: "propose_chat_dynamism_adjustment",
            ai_id: "kin-1",
            direction: "increase",
            suggested_target: 0.82,
            reason: "Maybe flatter than usual.",
            confidence: "medium"
          }
        ]
      })
    ).toEqual([]);
  });

  it("rejects group suggestions", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store);
    const action = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-1",
          direction: "decrease",
          suggested_target: 0.7,
          reason: "The group thread is drifting.",
          confidence: "high"
        }
      ]
    })[0];

    await handler.handle(groupNotification(), action);

    expect(store.list()).toHaveLength(0);
  });

  it("rejects mismatched ai_id suggestions", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store);
    const action = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-2",
          direction: "set",
          suggested_target: 0.7,
          reason: "The direct Kin is over-improvising.",
          confidence: "high"
        }
      ]
    })[0];

    await handler.handle(directNotification("kin-1"), action);

    expect(store.list()).toHaveLength(0);
  });

  it("rejects suggestions when drift is disabled for the Kin", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store, undefined, {
      isEnabled: () => false
    });
    const action = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-1",
          direction: "increase",
          suggested_target: 1.0,
          reason: "The direct Kin is flat across multiple turns.",
          confidence: "high"
        }
      ]
    })[0];

    await handler.handle(directNotification("kin-1"), action);

    expect(store.list()).toHaveLength(0);
  });

  it("rejects suggestions outside the selected Kin range", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store, undefined, {
      isEnabled: () => true,
      range: () => ({ min: 0.8, max: 0.9 })
    });
    const action = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-1",
          direction: "increase",
          suggested_target: 1.0,
          reason: "The direct Kin is flat across multiple turns.",
          confidence: "high"
        }
      ]
    })[0];

    await handler.handle(directNotification("kin-1"), action);

    expect(store.list()).toHaveLength(0);
  });

  it("marks pending suggestions stale when their source message is deleted", async () => {
    const store = testStore();
    const handler = new ChatDynamismActionHandler(testConfig(), testLogger, store);
    const action = handler.normalizeActions({
      actions: [
        {
          type: "propose_chat_dynamism_adjustment",
          ai_id: "kin-1",
          direction: "increase",
          suggested_target: 0.9,
          reason: "The direct Kin is flat across multiple turns.",
          confidence: "high"
        }
      ]
    })[0];
    await handler.handle(directNotification("kin-1"), action);

    const stale = store.markSourceDeleted({ aiId: "kin-1", documentId: "doc-1" });

    expect(stale).toEqual([
      expect.objectContaining({
        aiId: "kin-1",
        sourceDocumentId: "doc-1",
        status: "stale",
        staleReason: "Source chat message was deleted or rewound before review."
      })
    ]);
    expect(store.list("pending")).toHaveLength(0);
    expect(store.list("stale")).toHaveLength(1);
  });
});

function testStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-chat-dynamism-suggestions-"));
  tempDirs.push(dir);
  return new ChatDynamismSuggestionStore(path.join(dir, "chat-dynamism-suggestions.json"));
}

function directNotification(kinId: string): KindroidChatNotification {
  return {
    type: "kindroid.chat.changed",
    kinId,
    documentId: "doc-1",
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Readable Kin message.",
    sender: "ai",
    role: null,
    source: "firestore"
  };
}

function groupNotification(): KindroidChatNotification {
  return {
    type: "kindroid.group_chat.changed",
    groupId: "group-1",
    aiId: "kin-1",
    documentId: "doc-1",
    timestamp: "2026-06-01T12:00:00.000Z",
    text: "Readable group message.",
    sender: "ai",
    role: null,
    source: "firestore"
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
