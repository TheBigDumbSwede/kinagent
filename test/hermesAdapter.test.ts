import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { HermesChatAdapter } from "../src/hermes/hermesAdapter.js";
import type { Logger } from "../src/util/logger.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

describe("HermesChatAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lets Hermes request a current scene update for direct Kin chat", async () => {
    const kindroid = testKindroidUpdater();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  {
                    type: "update_current_scene",
                    ai_id: "kin-1",
                    current_scene: "The user and Sam are moving boxes into Sam's apartment.",
                    reason: "The chat established a new scene."
                  }
                ]
              })
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Come on in, I'll help you move the boxes.",
      textEncrypted: true,
      textDecrypted: true,
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8642/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer local-hermes-token"
        }
      })
    );
    expect(kindroid.updateCurrentScene).toHaveBeenCalledWith({
      aiId: "kin-1",
      currentScene: "The user and Sam are moving boxes into Sam's apartment."
    });
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Hermes action decision hit.",
      expect.objectContaining({
        actionCount: 1,
        actionTypes: ["update_current_scene"],
        textPresent: true
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Hermes current scene action requested.",
      expect.objectContaining({
        aiId: "kin-1",
        currentSceneLength: 55,
        truncated: false
      })
    );
  });

  it("ignores current scene actions for mismatched Kin ids", async () => {
    const kindroid = testKindroidUpdater();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [{ type: "update_current_scene", ai_id: "kin-2", current_scene: "Elsewhere." }]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: null,
      text: "We're somewhere new.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
  });

  it("does not send unreadable encrypted text to Hermes", async () => {
    const kindroid = testKindroidUpdater();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: null,
      text: "!enc:ciphertext",
      textEncrypted: true,
      textDecrypted: false,
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
  });

  it("truncates current scene actions to the configured Kindroid limit", async () => {
    const kindroid = testKindroidUpdater();
    const longScene = "x".repeat(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [{ type: "update_current_scene", ai_id: "kin-1", current_scene: longScene }]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: null,
      text: "The scene changed.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.updateCurrentScene).toHaveBeenCalledWith({
      aiId: "kin-1",
      currentScene: "x".repeat(160)
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Hermes current scene action requested.",
      expect.objectContaining({
        currentSceneLength: 200,
        truncated: true
      })
    );
  });

  it("lets Hermes request a group current scene update for group chat", async () => {
    const kindroid = testKindroidUpdater();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      type: "update_group_current_scene",
                      group_id: "group-1",
                      current_scene: "The group is gathering in the kitchen.",
                      reason: "The group chat established a new shared scene."
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.group_chat.changed",
      groupId: "group-1",
      aiId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Everyone is in the kitchen now.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.updateGroupCurrentScene).toHaveBeenCalledWith({
      groupId: "group-1",
      currentScene: "The group is gathering in the kitchen."
    });
    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Hermes group current scene action requested.",
      expect.objectContaining({
        groupId: "group-1",
        currentSceneLength: 38,
        truncated: false
      })
    );
  });

  it("ignores group current scene actions for mismatched group ids", async () => {
    const kindroid = testKindroidUpdater();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    { type: "update_group_current_scene", group_id: "group-2", current_scene: "Somewhere else." }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid);
    await adapter.handleChatChanged({
      type: "kindroid.group_chat.changed",
      groupId: "group-1",
      aiId: "kin-1",
      documentId: "doc-1",
      timestamp: null,
      text: "We're somewhere new.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
  });
});

function testKindroidUpdater() {
  return {
    updateCurrentScene: vi.fn(async () => ({ ok: true, status: 200 })),
    updateGroupCurrentScene: vi.fn(async () => ({ ok: true, status: 200 }))
  };
}

function testConfig(): AppConfig {
  return {
    kindroid: {
      firebaseProjectId: "kindroid-ai",
      uid: "firebase-uid",
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
      baseUrl: "http://127.0.0.1:8642/v1/",
      apiKey: "local-hermes-token",
      agentId: "kindroid-bridge",
      currentSceneUpdates: {
        enabled: true,
        maxLength: 160
      }
    }
  };
}
