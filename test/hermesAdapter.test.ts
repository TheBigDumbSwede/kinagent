import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { HermesChatAdapter } from "../src/hermes/hermesAdapter.js";
import { JournalSuggestionStore } from "../src/journal/journalSuggestionStore.js";
import type { Logger } from "../src/util/logger.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const tempDirs: string[] = [];

describe("HermesChatAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it("stores high-confidence Hermes journal entry suggestions", async () => {
    const kindroid = testKindroidUpdater();
    const store = testJournalSuggestionStore();
    const onSuggestionCreated = vi.fn();
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
                      type: "propose_journal_entry",
                      ai_id: "kin-1",
                      title: "Old Trust Concern Resolved",
                      category: "resolved_conflict",
                      category_detail: "old trust repair",
                      entry: "Sam and the user agreed that the old trust concern is now part of their history.",
                      keyphrases: ["old trust concern", "Sam history"],
                      evidence: ["Sam said the old worry no longer applies."],
                      durability_reason: "This changes how future relationship context should be interpreted.",
                      confidence: "high",
                      strong_event: false
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid, {
      journalSuggestions: store,
      onJournalSuggestionCreated: onSuggestionCreated
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "That old worry no longer applies.",
      sender: "ai",
      role: null,
      source: "firestore"
    });

    const suggestions = store.list("pending");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(
      expect.objectContaining({
        aiId: "kin-1",
        title: "Old Trust Concern Resolved",
        entry: "Sam and the user agreed that the old trust concern is now part of their history.",
        category: "resolved_conflict",
        categoryDetail: "old trust repair",
        keyphrases: ["old trust concern", "Sam history"],
        durabilityReason: "This changes how future relationship context should be interpreted.",
        strongEvent: false
      })
    );
    expect(onSuggestionCreated).toHaveBeenCalledWith(expect.objectContaining({ aiId: "kin-1" }));
    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
  });

  it("includes captured journal context in Hermes requests when available", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ actions: [] })
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HermesChatAdapter(testConfig(), logger, testKindroidUpdater(), {
      journalSuggestions: testJournalSuggestionStore(),
      journalContextProvider: async () => ({
        existingEntries: [
          {
            title: "Old Trust Concern",
            entry: "Sam and the user already resolved the old trust concern.",
            keyphrases: ["old trust concern"]
          }
        ],
        fieldExcerpts: [{ field: "Key Memories", value: "Sam treats the old trust concern as resolved." }]
      })
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "That old worry no longer applies.",
      sender: "ai",
      role: null,
      source: "firestore"
    });

    const fetchCall = fetchMock.mock.calls[0] as unknown as [string, { body?: string }];
    const body = JSON.parse(String(fetchCall[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const event = JSON.parse(body.messages.find((message) => message.role === "user")?.content ?? "{}") as {
      journalContext?: unknown;
    };
    expect(event.journalContext).toEqual({
      existingEntries: [
        {
          title: "Old Trust Concern",
          entry: "Sam and the user already resolved the old trust concern.",
          keyphrases: ["old trust concern"]
        }
      ],
      fieldExcerpts: [{ field: "Key Memories", value: "Sam treats the old trust concern as resolved." }]
    });
  });

  it("ignores journal entry suggestions from user-authored messages", async () => {
    const store = testJournalSuggestionStore();
    const onSuggestionCreated = vi.fn();
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
                      type: "propose_journal_entry",
                      ai_id: "kin-1",
                      title: "User Personal Fact",
                      category: "personal_fact",
                      entry: "The user shared a durable personal fact.",
                      keyphrases: ["favorite observatory"],
                      evidence: ["The user said the fact directly."],
                      durability_reason: "This may matter later, but it came from the user message.",
                      confidence: "high",
                      strong_event: true
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, testKindroidUpdater(), {
      journalSuggestions: store,
      onJournalSuggestionCreated: onSuggestionCreated
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Here is an important thing about me.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(store.list("pending")).toHaveLength(0);
    expect(onSuggestionCreated).not.toHaveBeenCalled();
  });

  it("does not store lower-confidence journal suggestions", async () => {
    const store = testJournalSuggestionStore();
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
                      type: "propose_journal_entry",
                      ai_id: "kin-1",
                      title: "Passing Banter",
                      category: "other_durable_event",
                      entry: "Maybe this banter matters.",
                      keyphrases: ["passing joke"],
                      durability_reason: "Unclear.",
                      confidence: "medium"
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, testKindroidUpdater(), { journalSuggestions: store });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: null,
      text: "A passing joke.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(store.list("pending")).toHaveLength(0);
  });
});

function testKindroidUpdater() {
  return {
    updateCurrentScene: vi.fn(async () => ({ ok: true, status: 200 })),
    updateGroupCurrentScene: vi.fn(async () => ({ ok: true, status: 200 }))
  };
}

function testJournalSuggestionStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-journal-suggestions-"));
  tempDirs.push(dir);
  return new JournalSuggestionStore(path.join(dir, "journal-suggestions.json"));
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
      },
      journalSuggestions: {
        enabled: true,
        throttleMessages: 20,
        strongEventBypass: true
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
