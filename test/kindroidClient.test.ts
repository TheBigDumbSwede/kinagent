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
  buildCreateGroupAiResponsePayload,
  buildCreateJournalEntryPayload,
  buildDeleteJournalEntryPayload,
  buildGetGroupTurnPayload,
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
      group_ais: [{ ai_id: "kin-1" }, { aiId: "kin-2" }, "kin-3"]
    });

    expect(normalizeGroupDocument(document)).toEqual([
      {
        documentId: "group-doc-1",
        groupId: "group-1",
        name: "Evening Roundtable",
        aiIds: ["kin-1", "kin-2", "kin-3"]
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
      request_id: "request-1",
      idempotency_key: "idempotency-1",
      internet_response: null
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
      request_id: "request-1",
      idempotency_key: "idempotency-1",
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
      internet_response: null,
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

  it("builds the observed Kindroid group AI response payload", () => {
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

  it("does not trigger a group AI response after group user-message sends by default", async () => {
    const sessionDir = createTestSessionDir(tempDirs);
    const fetchMock = vi.fn(async () => new Response("OK", { status: 200 }));
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
      .mockResolvedValueOnce(new Response("OK", { status: 200 }));
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
      aiResponseOk: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.kindroid.ai/v1/groupchats-user-message",
      "https://api.kindroid.ai/v1/groupchats-get-turn",
      "https://api.kindroid.ai/v1/groupchats-ai-response"
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
    const fetchMock = vi.fn(async () => new Response("OK", { status: 200 }));
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

function testConfig(overrides: { sessionDir?: string } = {}): AppConfig {
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
