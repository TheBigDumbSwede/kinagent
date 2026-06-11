import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import CryptoJS from "crypto-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { FirestoreDocumentLike } from "../src/firestore/types.js";
import { normalizeGroupDocument } from "../src/kindroid/client/groups.js";
import { normalizeKinDocument } from "../src/kindroid/client/kins.js";
import { KindroidClient } from "../src/kindroid/kindroidClient.js";
import {
  buildBreakChatPayload,
  buildBreakGroupChatPayload,
  buildApplyGroupBackgroundPayload,
  buildCreateGroupAiResponsePayload,
  buildCreateJournalEntryPayload,
  buildDeleteJournalEntryPayload,
  buildGetGroupTurnPayload,
  buildRewindMessagesPayload,
  buildSendGroupMessagePayload,
  buildSendMessagePayload,
  buildUpdateChatDynamismPayload,
  buildUpdateIdentityPayload
} from "../src/kindroid/payloads.js";
import type { Logger } from "../src/util/logger.js";

describe("Kindroid client normalizers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses Firestore AI fields for Kin identity", () => {
    const document = documentLike("doc-1", {
      ai_id: "kin-1",
      ai_name: "Brielle"
    });

    expect(normalizeKinDocument(document)).toEqual([
      {
        documentId: "doc-1",
        aiId: "kin-1",
        name: "Brielle",
        current: false,
        chatDynamism: {
          raw: undefined,
          numeric: null,
          display: "(not set)"
        },
        llmFlair: undefined,
        reasoningEffort: undefined
      }
    ]);
  });

  it("falls back to document id when Firestore omits ai_id", () => {
    const document = documentLike("doc-2", {
      ai_name: "Unnamed"
    });

    expect(normalizeKinDocument(document)).toEqual([
      {
        documentId: "doc-2",
        aiId: "doc-2",
        name: "Unnamed",
        current: false,
        chatDynamism: {
          raw: undefined,
          numeric: null,
          display: "(not set)"
        },
        llmFlair: undefined,
        reasoningEffort: undefined
      }
    ]);
  });

  it("normalizes Kin Chat Dynamism from Firestore profile fields", () => {
    const document = documentLike("doc-3", {
      ai_id: "kin-3",
      ai_name: "Mara",
      user_set_temperature: 0.85,
      reasoning_effort: "medium",
      llm_flair: "balanced"
    });

    expect(normalizeKinDocument(document)[0]).toEqual(
      expect.objectContaining({
        aiId: "kin-3",
        chatDynamism: {
          raw: 0.85,
          numeric: 0.85,
          display: "0.85"
        },
        reasoningEffort: "medium",
        llmFlair: "balanced"
      })
    );
  });

  it("normalizes group metadata without exposing raw group context", () => {
    const document = documentLike("group-doc-1", {
      group_id: "group-1",
      group_name: "Evening Roundtable",
      group_ais: [{ ai_id: "kin-1" }, { aiId: "kin-2" }, "kin-3"],
      use_manual_turntaking: true
    });

    expect(normalizeGroupDocument(document)).toEqual([
      {
        documentId: "group-doc-1",
        groupId: "group-1",
        name: "Evening Roundtable",
        aiIds: ["kin-1", "kin-2", "kin-3"],
        useManualTurntaking: true
      }
    ]);
  });

  it("decrypts group names when the Firebase UID is available", () => {
    const document = documentLike("group-doc-2", {
      group_id: "group-2",
      group_name: `!enc:${CryptoJS.AES.encrypt("Workshop", "firebase-uid").toString()}`
    });

    expect(normalizeGroupDocument(document, { decryptionKey: "firebase-uid" })[0]?.name).toBe("Workshop");
  });

  it("rejects current scene updates over Kindroid's 160 character limit before calling the endpoint", async () => {
    const client = new KindroidClient(testConfig(), testLogger);

    await expect(
      client.updateCurrentScene({
        aiId: "kin-1",
        currentScene: "x".repeat(161)
      })
    ).rejects.toThrow("Current scene cannot exceed 160 characters.");
  });

  it("rejects group current scene updates over Kindroid's 160 character limit before calling the endpoint", async () => {
    const client = new KindroidClient(testConfig(), testLogger);

    await expect(
      client.updateGroupCurrentScene({
        groupId: "group-1",
        currentScene: "x".repeat(161)
      })
    ).rejects.toThrow("Current scene cannot exceed 160 characters.");
  });

  it("builds send-message payloads with no internet_response by default", () => {
    expect(
      buildSendMessagePayload({
        aiId: "kin-1",
        message: "Visible diagnostic message.",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).toMatchObject({
      ai_id: "kin-1",
      message: "Visible diagnostic message.",
      stream: false
    });
  });

  it("builds send-message payloads with explicit internet_response text", () => {
    expect(
      buildSendMessagePayload({
        aiId: "kin-1",
        message: "Visible diagnostic message.",
        requestId: "request-1",
        idempotencyKey: "idempotency-1",
        internetResponse: "Diagnostic hidden context: KINAGENT-CANARY-1234."
      })
    ).toMatchObject({
      ai_id: "kin-1",
      message: "Visible diagnostic message.",
      stream: false,
      internet_response: "Diagnostic hidden context: KINAGENT-CANARY-1234."
    });
  });

  it("builds group user-message payloads with no internet_response by default", () => {
    expect(
      buildSendGroupMessagePayload({
        groupId: "group-1",
        message: "Visible group diagnostic message.",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).toMatchObject({
      group_id: "group-1",
      message: "Visible group diagnostic message.",
      image_urls: null,
      image_description: null,
      video_url: null,
      video_description: null,
      internet_response: null,
      link_url: null,
      link_description: null,
      client_platform: "web"
    });
  });

  it("builds group user-message payloads with explicit internet_response text", () => {
    expect(
      buildSendGroupMessagePayload({
        groupId: "group-1",
        message: "Visible group diagnostic message.",
        requestId: "request-1",
        idempotencyKey: "idempotency-1",
        internetResponse: "Diagnostic hidden group context: KINAGENT-GROUP-CANARY-1234."
      })
    ).toMatchObject({
      group_id: "group-1",
      message: "Visible group diagnostic message.",
      internet_response: "Diagnostic hidden group context: KINAGENT-GROUP-CANARY-1234.",
      client_platform: "web"
    });
  });

  it("builds documented group user-message payloads with audio_url instead of message", () => {
    expect(
      buildSendGroupMessagePayload({
        groupId: "group-1",
        audioUrl: "https://example.test/audio.mp3",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).toEqual({
      group_id: "group-1",
      image_urls: null,
      image_description: null,
      video_url: null,
      video_description: null,
      internet_response: null,
      link_url: null,
      link_description: null,
      client_platform: "web",
      audio_url: "https://example.test/audio.mp3"
    });
  });

  it("rejects invalid group user-message one-of payloads", () => {
    expect(() =>
      buildSendGroupMessagePayload({
        groupId: "group-1",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).toThrow("Group user message requires message or audioUrl.");

    expect(() =>
      buildSendGroupMessagePayload({
        groupId: "group-1",
        message: "Visible group diagnostic message.",
        audioUrl: "https://example.test/audio.mp3",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).toThrow("Group user message must specify either message or audioUrl, not both.");
  });

  it("builds the observed Kindroid group get-turn payload", () => {
    expect(
      buildGetGroupTurnPayload({
        groupId: "group-1",
        allowUser: false
      })
    ).toEqual({
      group_id: "group-1",
      allow_user: false
    });
  });

  it("builds the documented Kindroid group AI response payload", () => {
    expect(
      buildCreateGroupAiResponsePayload({
        groupId: "group-1",
        aiId: "kin-1",
        requestId: "group-ai-request-1"
      })
    ).toEqual({
      ai_id: "kin-1",
      group_id: "group-1",
      stream: false,
      request_id: "group-ai-request-1",
      client_platform: "web"
    });
  });

  it("builds group background update payloads without dropping existing group settings", () => {
    expect(
      buildApplyGroupBackgroundPayload({
        storagePath: "users/firebase-uid/referenceimages/background.png",
        group: {
          group_id: "group-1",
          group_ais: [{ ai_id: "kin-1" }, { aiId: "kin-2" }, "kin-3"],
          group_name: "Prairie Ghosts",
          group_context: "Existing context.",
          group_directive: "Existing directive.",
          use_manual_turntaking: true,
          share_short_term_memory: true,
          disable_ltm_recall: true,
          disable_ltm_consolidate: false,
          user_persona_id: "persona-1",
          background_settings: {
            background_url: "users/firebase-uid/referenceimages/old.png",
            use_latest_gallery: true,
            background_opacity: 42,
            message_fading_strength: 3,
            message_mask_drag: 0.4,
            background_blur: 2,
            enable_background_blur_on_wide_screen_only: false,
            enable_message_fade: true,
            top_offset: 12,
            left_offset: 34
          }
        }
      })
    ).toEqual({
      group_id: "group-1",
      ai_list: ["kin-1", "kin-2", "kin-3"],
      group_name: "Prairie Ghosts",
      group_context: "Existing context.",
      group_directive: "Existing directive.",
      use_manual_turntaking: true,
      share_short_term_memory: true,
      disable_ltm_recall: true,
      disable_ltm_consolidate: false,
      user_persona_id: "persona-1",
      background_settings: {
        background_url: "users/firebase-uid/referenceimages/background.png",
        use_latest_gallery: false,
        background_opacity: 42,
        message_fading_strength: 3,
        message_mask_drag: 0.4,
        background_blur: 2,
        enable_background_blur_on_wide_screen_only: false,
        enable_message_fade: true,
        top_offset: 12,
        left_offset: 34
      }
    });
  });

  it("builds documented chat-break payloads", () => {
    expect(
      buildBreakChatPayload({
        aiId: "kin-1",
        greeting: "  A clean opening.  ",
        wipeCascaded: true
      })
    ).toEqual({
      ai_id: "kin-1",
      greeting: "A clean opening.",
      wipe_cascaded: true
    });
  });

  it("builds documented group chat-break payloads", () => {
    expect(
      buildBreakGroupChatPayload({
        groupId: "group-1",
        greeting: "A clean group opening.",
        wipeCascaded: false
      })
    ).toEqual({
      group_id: "group-1",
      greeting: "A clean group opening.",
      wipe_cascaded: false
    });
  });

  it("builds documented rewind-messages payloads", () => {
    expect(
      buildRewindMessagesPayload({
        aiId: "kin-1",
        count: 2
      })
    ).toEqual({
      ai_id: "kin-1",
      count: 2
    });

    expect(
      buildRewindMessagesPayload({
        groupId: "group-1",
        count: 1
      })
    ).toEqual({
      group_id: "group-1",
      count: 1
    });
  });

  it("rejects invalid rewind-messages payloads before calling the endpoint", () => {
    expect(() => buildRewindMessagesPayload({ aiId: "kin-1", groupId: "group-1", count: 2 })).toThrow(
      "Rewind request must specify either aiId or groupId, not both."
    );
    expect(() => buildRewindMessagesPayload({ aiId: "kin-1", count: 1 })).toThrow(
      "Direct Kin rewind count must be even."
    );
  });

  it("authenticates /v1 requests with the configured Kindroid API key when available", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ apiKey: "kn_test-token" }), testLogger);

    await expect(
      client.sendMessage({
        aiId: "kin-1",
        message: "Visible diagnostic message.",
        requestId: "request-1",
        idempotencyKey: "idempotency-1"
      })
    ).resolves.toMatchObject({ ok: true, status: 200, replyText: "OK" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kindroid.ai/v1/send-message",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer kn_test-token"
        })
      })
    );
  });

  it("fetches chat history through the public get-chat-messages endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            messages: [
              {
                id: "message-1",
                sender: "Alexis",
                sender_type: "ai",
                display_name: "Alexis",
                timestamp: 1_780_000_000_000,
                message: "Hello."
              }
            ],
            pagination: {
              hasMore: false,
              lastTimestamp: 1_780_000_000_000,
              limit: 100
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ apiKey: "kn_test-token" }), testLogger);

    await expect(
      client.getChatMessages({
        aiId: "kin-1",
        limit: 100,
        startAfterTimestamp: 1_779_999_999_000
      })
    ).resolves.toEqual({
      ok: true,
      status: 200,
      messages: [
        {
          id: "message-1",
          sender: "Alexis",
          sender_type: "ai",
          display_name: "Alexis",
          timestamp: 1_780_000_000_000,
          message: "Hello."
        }
      ],
      pagination: {
        hasMore: false,
        lastTimestamp: 1_780_000_000_000,
        limit: 100
      }
    });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.href).toBe(
      "https://api.kindroid.ai/v1/get-chat-messages?ai_id=kin-1&limit=100&start_after_timestamp=1779999999000"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer kn_test-token"
        })
      })
    );
  });

  it("returns Retry-After timing from rate-limited chat history responses", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("Too many requests.", {
          status: 429,
          headers: { "retry-after": "2" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ apiKey: "kn_test-token" }), testLogger);

    await expect(client.getChatMessages({ aiId: "kin-1", limit: 100 })).resolves.toMatchObject({
      ok: false,
      status: 429,
      messages: [],
      responseText: "Too many requests.",
      retryAfterMs: 2000
    });
  });

  it("does not trigger a group AI response after group user-message sends by default", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ sessionDir }), testLogger);

    const result = await client.sendGroupMessage({
      groupId: "group-1",
      message: "Visible group diagnostic message.",
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      internetResponse: "Hidden group context."
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      requestId: "request-1",
      idempotencyKey: "idempotency-1"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kindroid.ai/v1/groupchats-user-message",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("can explicitly trigger the observed group turn and AI response sequence", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("OK", { status: 200 }))
      .mockResolvedValueOnce(new Response("kin-1", { status: 200 }))
      .mockResolvedValueOnce(new Response("Generated group reply.", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ sessionDir }), testLogger);

    const result = await client.sendGroupMessage({
      groupId: "group-1",
      message: "Visible group diagnostic message.",
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      internetResponse: "Hidden group context.",
      triggerAiResponse: true
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      nextAiId: "kin-1",
      aiResponseStatus: 200,
      aiResponseOk: true,
      aiResponseText: "Generated group reply."
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.kindroid.ai/v1/groupchats-user-message",
      "https://api.kindroid.ai/v1/groupchats-get-turn",
      "https://api.kindroid.ai/v1/groupchats-ai-response"
    ]);
  });

  it("uploads, registers, and applies a reviewed generated group background image", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://storage.example.test/upload",
            path: "users/firebase-uid/referenceimages/generated.png"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("OK", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "projects/kindroid-ai/databases/(default)/documents/Users/firebase-uid/Groups/group-1",
            fields: {
              group_id: { stringValue: "group-1" },
              group_ais: {
                arrayValue: {
                  values: [
                    { mapValue: { fields: { ai_id: { stringValue: "kin-1" } } } },
                    { mapValue: { fields: { aiId: { stringValue: "kin-2" } } } }
                  ]
                }
              },
              group_name: { stringValue: "Prairie Ghosts" },
              group_context: { stringValue: "Existing context." },
              group_directive: { stringValue: "Existing directive." },
              use_manual_turntaking: { booleanValue: true },
              share_short_term_memory: { booleanValue: true },
              disable_ltm_recall: { booleanValue: false },
              disable_ltm_consolidate: { booleanValue: false },
              user_persona_id: { stringValue: "persona-1" },
              background_settings: {
                mapValue: {
                  fields: {
                    background_url: { stringValue: "users/firebase-uid/referenceimages/old.png" },
                    background_opacity: { integerValue: "50" }
                  }
                }
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ sessionDir, apiKey: "kn_test-token" }), testLogger);

    await expect(
      client.applyGroupBackground({
        groupId: "group-1",
        image: Buffer.from("png-bytes"),
        fileName: "generated.png",
        contentType: "image/png"
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      storagePath: expect.stringMatching(/^users\/firebase-uid\/referenceimages\/.+-generated\.png$/),
      uploadStatus: 200,
      registerStatus: 200,
      applyStatus: 200
    });

    const storagePath = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).path as string;
    expect(fetchMock.mock.calls.map((call) => String(call[0]).split("?")[0])).toEqual([
      "https://api.kindroid.ai/v1/storage-presign",
      "https://storage.example.test/upload",
      "https://api.kindroid.ai/v1/update-info",
      "https://firestore.googleapis.com/v1/projects/kindroid-ai/databases/(default)/documents/Users/firebase-uid/Groups/group-1",
      "https://api.kindroid.ai/v1/groupchats-update"
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://storage.example.test/upload",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "image/png",
          "Content-Length": "9"
        })
      })
    );
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      uploaded_background_images: [storagePath]
    });
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toMatchObject({
      group_id: "group-1",
      ai_list: ["kin-1", "kin-2"],
      group_name: "Prairie Ghosts",
      group_context: "Existing context.",
      group_directive: "Existing directive.",
      background_settings: {
        background_url: storagePath,
        use_latest_gallery: false,
        background_opacity: 50
      }
    });
  });

  it("calls documented chat-break, group chat-break, and rewind endpoints", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ sessionDir }), testLogger);

    await expect(client.breakChat({ aiId: "kin-1", greeting: "Fresh start." })).resolves.toEqual({
      ok: true,
      status: 200,
      responseText: undefined
    });
    await expect(client.breakGroupChat({ groupId: "group-1", greeting: "Fresh group start." })).resolves.toEqual({
      ok: true,
      status: 200,
      responseText: undefined
    });
    await expect(client.rewindMessages({ groupId: "group-1", count: 1 })).resolves.toEqual({
      ok: true,
      status: 200,
      responseText: undefined
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.kindroid.ai/v1/chat-break",
      "https://api.kindroid.ai/v1/groupchats-chat-break",
      "https://api.kindroid.ai/v1/rewind-messages"
    ]);
  });

  it("builds the observed Kindroid journal-create payload", () => {
    expect(
      buildCreateJournalEntryPayload({
        aiId: "kin-1",
        entry: "  The old trust hook has resolved into shared history.  ",
        keyphrases: [" trust ", "", "trust", "history"]
      })
    ).toEqual({
      entry: "The old trust hook has resolved into shared history.",
      keyphrases: ["trust", "history"],
      ai_id: "kin-1"
    });
  });

  it("rejects empty journal entries before calling the endpoint", async () => {
    const client = new KindroidClient(testConfig(), testLogger);

    await expect(
      client.createJournalEntry({
        aiId: "kin-1",
        entry: "   "
      })
    ).rejects.toThrow("Journal entry cannot be empty.");
  });

  it("builds the observed Kindroid journal-delete payload", () => {
    expect(
      buildDeleteJournalEntryPayload({
        aiId: "kin-1",
        id: "journal-1"
      })
    ).toEqual({
      ai_id: "kin-1",
      id: "journal-1"
    });
  });

  it("builds the observed Kindroid update-info identity payload", () => {
    expect(
      buildUpdateIdentityPayload({
        aiId: "kin-1",
        backstory: "Revised backstory.",
        memory: "Existing memory.",
        exampleMessage: "Existing example.",
        directive: "Existing directive.",
        additionalContext: "Existing additional context."
      })
    ).toEqual({
      ai_id: "kin-1",
      ai_backstory: "Revised backstory.",
      ai_memory: "Existing memory.",
      ai_example_message: "Existing example.",
      ai_directive: "Existing directive.",
      ai_additional_context: "Existing additional context."
    });
  });

  it("builds a narrow Kindroid Chat Dynamism update-info payload", () => {
    expect(
      buildUpdateChatDynamismPayload({
        aiId: "kin-1",
        value: 0.85
      })
    ).toEqual({
      ai_id: "kin-1",
      user_set_temperature: 0.85
    });
  });

  it("updates Chat Dynamism through a separate update-info path", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KindroidClient(testConfig({ sessionDir }), testLogger);

    await expect(client.updateChatDynamism({ aiId: "kin-1", value: 0.85 })).resolves.toEqual({
      ok: true,
      status: 200,
      responseText: undefined
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kindroid.ai/v1/update-info",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ai_id: "kin-1",
          user_set_temperature: 0.85
        })
      })
    );
  });

  it("rejects empty backstory identity updates before calling the endpoint", async () => {
    const client = new KindroidClient(testConfig(), testLogger);

    await expect(
      client.updateIdentity({
        aiId: "kin-1",
        backstory: "   ",
        memory: "",
        exampleMessage: "",
        directive: "",
        additionalContext: ""
      })
    ).rejects.toThrow("Backstory cannot be empty.");
  });
});

function documentLike(id: string, data: Record<string, unknown>): FirestoreDocumentLike {
  return {
    id,
    data: () => data
  };
}

function createTestSessionDir(tempDirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-kindroid-client-"));
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

function testConfig(overrides: { apiKey?: string; sessionDir?: string } = {}): AppConfig {
  return {
    kindroid: {
      apiKey: overrides.apiKey ?? "",
      firebaseProjectId: "kindroid-ai",
      uid: "",
      kins: []
    },
    bridge: {
      dedupeWindowSeconds: 180,
      logPath: "kinagent.log",
      logLevel: "info",
      sessionDir: overrides.sessionDir ?? "session",
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
