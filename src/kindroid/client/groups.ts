import type { FirestoreListenClient } from "../../firestore/firestoreListenClient.js";
import type { FirestoreRestClient } from "../../firestore/firestoreRestClient.js";
import type { FirestoreDocumentLike } from "../../firestore/types.js";
import { decryptKindroidValue } from "../kindroidCrypto.js";
import { userDocumentPath, userGroupsPath } from "./firestorePaths.js";

export interface KindroidGroup {
  documentId: string;
  groupId: string;
  name: string;
  aiIds: string[];
}

export interface ListenKindroidGroupsOptions {
  pageSize?: number;
  signal?: AbortSignal;
  onGroup: (group: KindroidGroup) => void | Promise<void>;
}

export interface NormalizeGroupDocumentOptions {
  decryptionKey?: string;
}

export class KindroidGroupsClient {
  constructor(
    private readonly firestoreRest: FirestoreRestClient,
    private readonly firestoreListen: FirestoreListenClient
  ) {}

  async list(): Promise<KindroidGroup[]> {
    const uid = await this.firestoreRest.resolveUid();
    const documents = await this.firestoreRest.listDocuments({
      collectionPath: userGroupsPath(uid),
      pageSize: 100,
      orderBy: "__name__ asc",
      logLabel: "kindroid.groups"
    });
    return documents.flatMap((document) => normalizeGroupDocument(document, { decryptionKey: uid }));
  }

  async listen(options: ListenKindroidGroupsOptions): Promise<void> {
    const uid = await this.firestoreRest.resolveUid();
    await this.firestoreListen.listenCollection({
      parentPath: userDocumentPath(uid),
      collectionId: "Groups",
      limit: options.pageSize ?? 100,
      orderBy: [{ fieldPath: "__name__", direction: "ASCENDING" }],
      targetLabel: "kindroid.groups",
      signal: options.signal,
      onDocument: async (document) => {
        const group = normalizeGroupDocument(document, { decryptionKey: uid })[0];
        if (group) {
          await options.onGroup(group);
        }
      }
    });
  }
}

export function normalizeGroupDocument(
  document: FirestoreDocumentLike,
  options: NormalizeGroupDocumentOptions = {}
): KindroidGroup[] {
  const data = document.data() as Record<string, unknown>;
  const groupId = stringValue(data.group_id) ?? document.id;
  if (!groupId) {
    return [];
  }
  const rawName = stringValue(data.group_name);
  const name = rawName && options.decryptionKey ? decryptKindroidValue(rawName, options.decryptionKey).value : rawName;

  return [
    {
      documentId: document.id,
      groupId,
      name: name ?? "(unnamed group)",
      aiIds: normalizeAiIds(data.group_ais)
    }
  ];
}

function normalizeAiIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string" && item.length > 0) {
      return [item];
    }

    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const aiId = stringValue(record.ai_id) ?? stringValue(record.aiId) ?? stringValue(record.id);
      return aiId ? [aiId] : [];
    }

    return [];
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
