import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import type { FirestoreDocumentLike } from "../src/firestore/types.js";
import { normalizeGroupDocument } from "../src/kindroid/client/groups.js";
import { normalizeKinDocument } from "../src/kindroid/client/kins.js";
import { KindroidClient } from "../src/kindroid/kindroidClient.js";
import type { Logger } from "../src/util/logger.js";

describe("Kindroid client normalizers", () => {
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
        current: false
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
        current: false
      }
    ]);
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
});

function documentLike(id: string, data: Record<string, unknown>): FirestoreDocumentLike {
  return {
    id,
    data: () => data
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
