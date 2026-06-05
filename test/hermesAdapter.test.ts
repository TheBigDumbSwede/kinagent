import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { HermesChatAdapter } from "../src/hermes/hermesAdapter.js";
import { JournalSuggestionStore } from "../src/journal/journalSuggestionStore.js";
import { InMemoryDedupeStore } from "../src/state/dedupeStore.js";
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

  it("lets Hermes emit a local soundscape update for direct Kin chat", async () => {
    const onSoundscapeUpdated = vi.fn();
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
                      type: "update_soundscape",
                      ai_id: "kin-1",
                      reason: "The storm moved into the motel room scene.",
                      soundscape: {
                        enabled: true,
                        environment: "stormy motel room",
                        mood: "uneasy",
                        intensity: 0.42,
                        transition: "fade",
                        layers: [
                          { type: "rain", volume: 0.3, density: 0.7 },
                          { type: "roomTone", volume: 0.12 },
                          { type: "lowDrone", volume: 0.08, pitch: 72 }
                        ]
                      }
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
      onSoundscapeUpdated,
      isSoundscapeEnabled: () => true
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Rain lashes the motel window as the lights flicker.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(onSoundscapeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        documentId: "doc-1",
        reason: "The storm moved into the motel room scene.",
        state: expect.objectContaining({
          environment: "stormy motel room",
          mood: "uneasy",
          intensity: 0.42,
          layers: expect.arrayContaining([expect.objectContaining({ type: "rain", volume: 0.3 })])
        })
      })
    );
  });

  it("ignores local soundscape actions when disabled for the source Kin", async () => {
    const onSoundscapeUpdated = vi.fn();
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
                      type: "update_soundscape",
                      ai_id: "kin-1",
                      soundscape: {
                        enabled: true,
                        environment: "rainy street",
                        mood: "uneasy",
                        layers: [{ type: "rain", volume: 0.3 }]
                      }
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
      onSoundscapeUpdated,
      isSoundscapeEnabled: () => false
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Rain starts on the street outside.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(onSoundscapeUpdated).not.toHaveBeenCalled();
  });

  it("prewarms soundscape without executing non-soundscape actions", async () => {
    const kindroid = testKindroidUpdater();
    const onSoundscapeUpdated = vi.fn();
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
                      type: "update_current_scene",
                      ai_id: "kin-1",
                      current_scene: "Inside an abandoned hydro station during a thunderstorm."
                    },
                    {
                      type: "update_soundscape",
                      ai_id: "kin-1",
                      reason: "Prewarm from recent storm and turbine context.",
                      soundscape: {
                        enabled: true,
                        environment: "abandoned hydro station in a thunderstorm",
                        mood: "tense",
                        intensity: 0.5,
                        transition: "fade",
                        layers: [
                          { type: "rain", volume: 0.28, density: 0.75 },
                          { type: "hum", volume: 0.18 }
                        ]
                      }
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
      onSoundscapeUpdated,
      isSoundscapeEnabled: () => true
    });
    await adapter.prewarmSoundscape({
      scope: "kin",
      kinId: "kin-1",
      documentId: "soundscape-prewarm:kin-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "SOUNDSCAPE_PREWARM_REQUEST\nRecent messages mention rain, turbines, and warning lights.",
      soundscapeContext: {
        enabledForSource: true,
        prewarm: true,
        sourceScope: "direct",
        sourceKinId: "kin-1",
        mutation: "local-renderer-only"
      }
    });

    expect(kindroid.updateCurrentScene).not.toHaveBeenCalled();
    expect(kindroid.updateGroupCurrentScene).not.toHaveBeenCalled();
    expect(onSoundscapeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "kin",
        kinId: "kin-1",
        documentId: "soundscape-prewarm:kin-1",
        state: expect.objectContaining({
          environment: "abandoned hydro station in a thunderstorm",
          mood: "tense"
        })
      })
    );
  });

  it("lets Hermes send an ambient context turn for direct Kin chat", async () => {
    const kindroid = testKindroidClient();
    const dedupeStore = new InMemoryDedupeStore(60_000);
    const onAmbientContextSent = vi.fn();
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
                      type: "send_ambient_context_turn",
                      ai_id: "kin-1",
                      ambient_message: "The console gives a soft two-note chime.",
                      context: "The north service door is now unlocked.",
                      source: "tool:door-control",
                      confidence: "high",
                      suggested_use: "Let the Kin incorporate this as immediate situational awareness."
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid, { dedupeStore, onAmbientContextSent });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Check the north service door.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        aiId: "kin-1",
        message: "*The console gives a soft two-note chime.*",
        internetResponse: expect.stringContaining("The north service door is now unlocked.")
      })
    );
    expect(kindroid.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        internetResponse: expect.stringContaining("Source: tool:door-control")
      })
    );
    await expect(
      dedupeStore.matchRecentOutbound({ kinId: "kin-1", text: "*The console gives a soft two-note chime.*" })
    ).resolves.toEqual(expect.objectContaining({ matched: true }));
    expect(onAmbientContextSent).toHaveBeenCalledWith(
      expect.objectContaining({
        aiId: "kin-1",
        documentId: "doc-1",
        visibleMessage: "*The console gives a soft two-note chime.*",
        internetResponse: expect.stringContaining("The north service door is now unlocked."),
        source: "tool:door-control",
        requestId: expect.any(String),
        idempotencyKey: expect.any(String)
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Hermes ambient context action requested.",
      expect.objectContaining({
        aiId: "kin-1",
        ambientMessageLength: expect.any(Number),
        contextLength: expect.any(Number),
        source: "tool:door-control"
      })
    );
  });

  it("ignores ambient context turns for group chat", async () => {
    const kindroid = testKindroidClient();
    const dedupeStore = new InMemoryDedupeStore(60_000);
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
                      type: "send_ambient_context_turn",
                      group_id: "group-1",
                      ambient_message: "*The wall display gives a low amber pulse.*",
                      context: "The group route through the west corridor is clear.",
                      source: "tool:route-control",
                      confidence: "high",
                      suggested_use: "Let the group incorporate this as immediate situational awareness."
                    }
                  ]
                })
              }
            }
          ]
        })
      )
    );

    const adapter = new HermesChatAdapter(testConfig(), logger, kindroid, { dedupeStore });
    await adapter.handleChatChanged({
      type: "kindroid.group_chat.changed",
      groupId: "group-1",
      aiId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Can everyone reach the west corridor?",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.sendGroupMessage).not.toHaveBeenCalled();
    await expect(
      dedupeStore.matchRecentOutbound({ kinId: "group-1", text: "*The wall display gives a low amber pulse.*" })
    ).resolves.toEqual(expect.objectContaining({ matched: false }));
    expect(logger.info).toHaveBeenCalledWith(
      "Ignoring ambient context action for group chat because group internet_response is not consumed.",
      expect.objectContaining({
        groupId: "group-1",
        aiId: "kin-1",
        requestedGroupId: "group-1"
      })
    );
  });

  it("does not send ambient context when disabled for the Kin", async () => {
    const kindroid = testKindroidClient();
    const dedupeStore = new InMemoryDedupeStore(60_000);
    const onAmbientContextSent = vi.fn();
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
                      type: "send_ambient_context_turn",
                      ai_id: "kin-1",
                      ambient_message: "*The console gives a soft two-note chime.*",
                      context: "The north service door is now unlocked.",
                      source: "tool:door-control",
                      confidence: "high"
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
      dedupeStore,
      onAmbientContextSent,
      isAmbientContextEnabled: () => false
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "Check the north service door.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(kindroid.sendMessage).not.toHaveBeenCalled();
    expect(onAmbientContextSent).not.toHaveBeenCalled();
    await expect(
      dedupeStore.matchRecentOutbound({ kinId: "kin-1", text: "*The console gives a soft two-note chime.*" })
    ).resolves.toEqual({ matched: false });
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

  it("lets Hermes emit a local soundscape update for group chat", async () => {
    const onSoundscapeUpdated = vi.fn();
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
                      type: "update_group_soundscape",
                      group_id: "group-1",
                      reason: "The group moved into the engine bay.",
                      soundscape: {
                        enabled: true,
                        environment: "ship engine bay",
                        mood: "tense",
                        intensity: 0.5,
                        transition: "swell",
                        layers: [
                          { type: "hum", volume: 0.28, pitch: 58 },
                          { type: "static", volume: 0.12, density: 0.45 }
                        ]
                      }
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
      onSoundscapeUpdated,
      isSoundscapeEnabled: () => true
    });
    await adapter.handleChatChanged({
      type: "kindroid.group_chat.changed",
      groupId: "group-1",
      aiId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "The crew spills into the engine bay as warning lights strobe.",
      sender: "user",
      role: null,
      source: "firestore"
    });

    expect(onSoundscapeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "group",
        groupId: "group-1",
        documentId: "doc-1",
        reason: "The group moved into the engine bay.",
        state: expect.objectContaining({
          environment: "ship engine bay",
          mood: "tense",
          transition: "swell"
        })
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
            id: "journal-1",
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
          id: "journal-1",
          title: "Old Trust Concern",
          entry: "Sam and the user already resolved the old trust concern.",
          keyphrases: ["old trust concern"]
        }
      ],
      fieldExcerpts: [{ field: "Key Memories", value: "Sam treats the old trust concern as resolved." }]
    });
  });

  it("includes Chat Dynamism context in Hermes requests when available", async () => {
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
      chatDynamismContextProvider: async () => ({
        displayName: "Chat Dynamism",
        fieldName: "user_set_temperature",
        enabledForKin: true,
        allowedRange: { min: 0.8, max: 1.4 },
        hardLimits: { min: 0.6, max: 1.8, step: 0.05 },
        practicalRange: { min: 0.8, max: 1.4 },
        recommendedStartingValue: 0.95,
        deltaGuidance: {
          noticeableBase: 0.05,
          slight: 0.05,
          moderate: 0.1,
          strong: 0.15,
          severe: 0.2,
          rule: "A 0.05 move either way is the recommended noticeable base adjustment. Choose the smallest delta that fits the repeated pattern; larger moves require stronger, repeated evidence."
        },
        currentValue: { raw: 0.75, numeric: 0.75, display: "0.75" },
        mutation: "reviewed-suggestion-only"
      })
    });
    await adapter.handleChatChanged({
      type: "kindroid.chat.changed",
      kinId: "kin-1",
      documentId: "doc-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "That felt a little flat.",
      sender: "ai",
      role: null,
      source: "firestore"
    });

    const fetchCall = fetchMock.mock.calls[0] as unknown as [string, { body?: string }];
    const body = JSON.parse(String(fetchCall[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const event = JSON.parse(body.messages.find((message) => message.role === "user")?.content ?? "{}") as {
      chatDynamismContext?: unknown;
    };
    expect(event.chatDynamismContext).toEqual({
      displayName: "Chat Dynamism",
      fieldName: "user_set_temperature",
      enabledForKin: true,
      allowedRange: { min: 0.8, max: 1.4 },
      hardLimits: { min: 0.6, max: 1.8, step: 0.05 },
      practicalRange: { min: 0.8, max: 1.4 },
      recommendedStartingValue: 0.95,
      deltaGuidance: {
        noticeableBase: 0.05,
        slight: 0.05,
        moderate: 0.1,
        strong: 0.15,
        severe: 0.2,
        rule: "A 0.05 move either way is the recommended noticeable base adjustment. Choose the smallest delta that fits the repeated pattern; larger moves require stronger, repeated evidence."
      },
      currentValue: { raw: 0.75, numeric: 0.75, display: "0.75" },
      mutation: "reviewed-suggestion-only"
    });
  });

  it("stores high-confidence Hermes journal deletion suggestions for captured entries", async () => {
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
                      type: "delete_journal_entry",
                      ai_id: "kin-1",
                      journal_entry_id: "journal-1",
                      title: "Remove stale trust concern",
                      target_title: "Old Trust Concern",
                      target_entry: "Sam still treats the old trust concern as unresolved.",
                      evidence: ["Sam said the concern has now been resolved."],
                      durability_reason: "Keeping this entry would preserve stale recall.",
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
      onJournalSuggestionCreated: onSuggestionCreated,
      journalContextProvider: async () => ({
        existingEntries: [
          {
            id: "journal-1",
            title: "Old Trust Concern",
            entry: "Sam still treats the old trust concern as unresolved.",
            keyphrases: ["old trust concern"]
          }
        ],
        fieldExcerpts: []
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

    expect(store.list("pending")).toEqual([
      expect.objectContaining({
        action: "delete",
        aiId: "kin-1",
        targetJournalEntryId: "journal-1",
        targetJournalTitle: "Old Trust Concern",
        targetJournalEntry: "Sam still treats the old trust concern as unresolved.",
        durabilityReason: "Keeping this entry would preserve stale recall."
      })
    ]);
    expect(onSuggestionCreated).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
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

function testKindroidClient() {
  return {
    ...testKindroidUpdater(),
    sendMessage: vi.fn(async (input: { requestId: string; idempotencyKey: string }) => ({
      ok: true,
      status: 200,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey
    })),
    sendGroupMessage: vi.fn(async (input: { requestId: string; idempotencyKey: string }) => ({
      ok: true,
      status: 200,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      nextAiId: "kin-1",
      aiResponseStatus: 200,
      aiResponseOk: true
    }))
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
