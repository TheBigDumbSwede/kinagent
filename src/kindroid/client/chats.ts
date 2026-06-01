import type { FirestoreListenClient } from "../../firestore/firestoreListenClient.js";
import type { FirestoreRestClient } from "../../firestore/firestoreRestClient.js";
import type { FirestoreDocumentLike } from "../../firestore/types.js";
import { kinChatMessagesPath, kinDocumentPath } from "./firestorePaths.js";

export interface ListKindroidChatMessagesOptions {
  kinId: string;
  limit: number;
}

export interface ListenKindroidChatMessagesOptions {
  kinId: string;
  pageSize?: number;
  signal?: AbortSignal;
  onDocument: (document: FirestoreDocumentLike) => void | Promise<void>;
}

export class KindroidChatsClient {
  constructor(
    private readonly firestoreRest: FirestoreRestClient,
    private readonly firestoreListen: FirestoreListenClient
  ) {}

  async listRecentMessages(options: ListKindroidChatMessagesOptions): Promise<FirestoreDocumentLike[]> {
    const uid = await this.firestoreRest.resolveUid();
    return this.firestoreRest.listDocuments({
      collectionPath: kinChatMessagesPath(uid, options.kinId),
      pageSize: options.limit,
      maxDocuments: options.limit,
      orderBy: "timestamp desc",
      logLabel: "kindroid.chatMessages"
    });
  }

  async listenMessages(options: ListenKindroidChatMessagesOptions): Promise<void> {
    const uid = await this.firestoreRest.resolveUid();
    await this.firestoreListen.listenCollection({
      parentPath: kinDocumentPath(uid, options.kinId),
      collectionId: "ChatMessages",
      limit: options.pageSize ?? 50,
      orderBy: [{ fieldPath: "timestamp", direction: "DESCENDING" }],
      targetLabel: `kin:${options.kinId}:chatMessages`,
      signal: options.signal,
      onDocument: options.onDocument
    });
  }
}
