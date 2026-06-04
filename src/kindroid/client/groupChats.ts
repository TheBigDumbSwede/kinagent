import type { FirestoreListenClient } from "../../firestore/firestoreListenClient.js";
import type { FirestoreRestClient } from "../../firestore/firestoreRestClient.js";
import type { FirestoreDeletedDocumentLike, FirestoreDocumentLike } from "../../firestore/types.js";
import { groupChatMessagesPath, groupDocumentPath, groupPinnedMessagesPath } from "./firestorePaths.js";

export interface ListKindroidGroupChatMessagesOptions {
  groupId: string;
  limit: number;
}

export interface ListAllKindroidGroupChatMessagesOptions {
  groupId: string;
  pageSize?: number;
  maxMessages?: number;
}

export interface ListenKindroidGroupChatMessagesOptions {
  groupId: string;
  pageSize?: number;
  signal?: AbortSignal;
  onDocument: (document: FirestoreDocumentLike) => void | Promise<void>;
  onDocumentDeleted?: (document: FirestoreDeletedDocumentLike) => void | Promise<void>;
}

export interface ListenKindroidGroupPinnedMessagesOptions {
  groupId: string;
  pageSize?: number;
  signal?: AbortSignal;
  onDocument: (document: FirestoreDocumentLike) => void | Promise<void>;
}

export class KindroidGroupChatsClient {
  constructor(
    private readonly firestoreRest: FirestoreRestClient,
    private readonly firestoreListen: FirestoreListenClient
  ) {}

  async listRecentMessages(options: ListKindroidGroupChatMessagesOptions): Promise<FirestoreDocumentLike[]> {
    const uid = await this.firestoreRest.resolveUid();
    return this.firestoreRest.listDocuments({
      collectionPath: groupChatMessagesPath(uid, options.groupId),
      pageSize: options.limit,
      maxDocuments: options.limit,
      orderBy: "timestamp desc",
      logLabel: "kindroid.groupChatMessages"
    });
  }

  async listMessages(options: ListAllKindroidGroupChatMessagesOptions): Promise<FirestoreDocumentLike[]> {
    const uid = await this.firestoreRest.resolveUid();
    return this.firestoreRest.listDocuments({
      collectionPath: groupChatMessagesPath(uid, options.groupId),
      pageSize: options.pageSize ?? 100,
      maxDocuments: options.maxMessages,
      orderBy: "timestamp desc, __name__ desc",
      logLabel: "kindroid.groupChatMessages.export"
    });
  }

  async listenMessages(options: ListenKindroidGroupChatMessagesOptions): Promise<void> {
    const uid = await this.firestoreRest.resolveUid();
    await this.firestoreListen.listenCollection({
      parentPath: groupDocumentPath(uid, options.groupId),
      collectionId: "ChatMessages",
      limit: options.pageSize ?? 50,
      orderBy: [
        { fieldPath: "timestamp", direction: "DESCENDING" },
        { fieldPath: "__name__", direction: "DESCENDING" }
      ],
      targetLabel: `group:${options.groupId}:chatMessages`,
      signal: options.signal,
      onDocument: options.onDocument,
      onDocumentDeleted: options.onDocumentDeleted
    });
  }

  async listenPinnedMessages(options: ListenKindroidGroupPinnedMessagesOptions): Promise<void> {
    const uid = await this.firestoreRest.resolveUid();
    await this.firestoreListen.listenCollection({
      parentPath: groupDocumentPath(uid, options.groupId),
      collectionId: "PinnedMessages",
      limit: options.pageSize ?? 50,
      orderBy: [
        { fieldPath: "pinned_timestamp", direction: "DESCENDING" },
        { fieldPath: "__name__", direction: "DESCENDING" }
      ],
      targetLabel: `group:${options.groupId}:pinnedMessages`,
      signal: options.signal,
      onDocument: options.onDocument
    });
  }

  async listPinnedMessages(options: ListKindroidGroupChatMessagesOptions): Promise<FirestoreDocumentLike[]> {
    const uid = await this.firestoreRest.resolveUid();
    return this.firestoreRest.listDocuments({
      collectionPath: groupPinnedMessagesPath(uid, options.groupId),
      pageSize: options.limit,
      maxDocuments: options.limit,
      orderBy: "pinned_timestamp desc, __name__ desc",
      logLabel: "kindroid.groupPinnedMessages"
    });
  }
}
