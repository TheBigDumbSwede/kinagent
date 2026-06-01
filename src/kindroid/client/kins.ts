import type { FirestoreDocumentLike } from "../../firestore/types.js";
import type { FirestoreRestClient } from "../../firestore/firestoreRestClient.js";
import { userKinsPath } from "./firestorePaths.js";

export interface KindroidKin {
  documentId: string;
  aiId: string;
  name: string;
  current: boolean;
}

export class KindroidKinsClient {
  constructor(private readonly firestore: FirestoreRestClient) {}

  async list(): Promise<KindroidKin[]> {
    const uid = await this.firestore.resolveUid();
    const documents = await this.firestore.listDocuments({
      collectionPath: userKinsPath(uid),
      pageSize: 100,
      logLabel: "kindroid.kins"
    });
    return documents.flatMap(normalizeKinDocument);
  }
}

export function normalizeKinDocument(document: FirestoreDocumentLike): KindroidKin[] {
  const data = document.data() as Record<string, unknown>;
  const aiId = stringValue(data.ai_id) ?? document.id;
  if (!aiId) {
    return [];
  }

  return [
    {
      documentId: document.id,
      aiId,
      name: stringValue(data.ai_name) ?? "(unnamed)",
      current: booleanValue(data.current) ?? false
    }
  ];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
