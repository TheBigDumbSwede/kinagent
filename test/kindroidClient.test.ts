import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import type { FirestoreDocumentLike } from "../src/firestore/types.js";
import { normalizeGroupDocument } from "../src/kindroid/client/groups.js";
import { normalizeKinDocument } from "../src/kindroid/client/kins.js";

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
});

function documentLike(id: string, data: Record<string, unknown>): FirestoreDocumentLike {
  return {
    id,
    data: () => data
  };
}
