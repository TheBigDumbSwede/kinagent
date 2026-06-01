import { describe, expect, it } from "vitest";
import { normalizeKinDocument, type FirestoreRestDocument } from "../src/firestore/firestoreRestClient.js";

describe("normalizeKinDocument", () => {
  it("uses Firestore AI fields for Kin identity", () => {
    const document: FirestoreRestDocument = {
      name: "projects/kindroid-ai/databases/(default)/documents/Users/user-1/AIs/doc-1",
      fields: {
        ai_id: { stringValue: "kin-1" },
        ai_name: { stringValue: "Brielle" }
      }
    };

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
    const document: FirestoreRestDocument = {
      name: "projects/kindroid-ai/databases/(default)/documents/Users/user-1/AIs/doc-2",
      fields: {
        ai_name: { stringValue: "Unnamed" }
      }
    };

    expect(normalizeKinDocument(document)).toEqual([
      {
        documentId: "doc-2",
        aiId: "doc-2",
        name: "Unnamed",
        current: false
      }
    ]);
  });
});
