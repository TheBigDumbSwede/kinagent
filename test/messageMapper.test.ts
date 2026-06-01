import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { mapKindroidMessage } from "../src/firestore/messageMapper.js";
import type { FirestoreDocumentLike } from "../src/firestore/types.js";

describe("mapKindroidMessage", () => {
  it("normalizes common Firestore message fields", () => {
    const doc = firestoreDoc("doc-1", {
      message: "hello",
      sender: "user",
      role: "member",
      timestamp: "2026-06-01T12:00:00.000Z"
    });

    expect(mapKindroidMessage(doc, "kin-1")).toMatchObject({
      id: "doc-1",
      kinId: "kin-1",
      timestamp: "2026-06-01T12:00:00.000Z",
      text: "hello",
      textEncrypted: undefined,
      textDecrypted: undefined,
      sender: "user",
      role: "member"
    });
  });

  it("decrypts encrypted message text when a decryption key is supplied", () => {
    const encrypted = `!enc:${CryptoJS.AES.encrypt("hello from firestore", "firebase-uid").toString()}`;
    const doc = firestoreDoc("doc-2", {
      message: encrypted,
      sender: "ai",
      timestamp: { seconds: 1780315200 }
    });

    expect(mapKindroidMessage(doc, "kin-1", { decryptionKey: "firebase-uid" })).toMatchObject({
      id: "doc-2",
      text: "hello from firestore",
      textEncrypted: true,
      textDecrypted: true,
      sender: "ai",
      timestamp: "2026-06-01T12:00:00.000Z"
    });
  });

  it("falls back to update time when no explicit timestamp field is present", () => {
    const doc = firestoreDoc("doc-3", {
      body: "hello",
      _updateTime: "2026-06-01T12:01:00.000Z"
    });

    expect(mapKindroidMessage(doc, "kin-1").timestamp).toBe("2026-06-01T12:01:00.000Z");
  });
});

function firestoreDoc(id: string, data: unknown): FirestoreDocumentLike {
  return {
    id,
    data: () => data
  };
}
