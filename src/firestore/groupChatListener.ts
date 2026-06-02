import type { AppConfig } from "../config/types.js";
import { loadBrowserSession } from "../auth/firebaseSession.js";
import type { HermesAdapter } from "../hermes/types.js";
import { KindroidApiClient } from "../kindroid/client/index.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import type { FirestoreDocumentLike, KindroidGroupChatChangeNotification } from "./types.js";
import { isRecentOutboundEcho } from "./messageDedupe.js";
import { mapKindroidMessage } from "./messageMapper.js";

export interface GroupChatListenerOptions {
  groupId: string;
  pageSize?: number;
  signal?: AbortSignal;
}

export class KindroidGroupChatListener {
  constructor(
    private readonly config: AppConfig,
    private readonly hermes: HermesAdapter,
    private readonly dedupeStore: DedupeStore,
    private readonly logger: Logger
  ) {}

  async start(options: GroupChatListenerOptions): Promise<void> {
    const client = new KindroidApiClient(this.config, this.logger);
    const pageSize = options.pageSize ?? 50;
    const decryptionKey = this.resolveDecryptionKey();
    this.logger.info("Preparing Firestore group chat listener.", {
      projectId: this.config.kindroid.firebaseProjectId,
      groupId: options.groupId,
      pageSize,
      mode: "notification-only"
    });

    await client.groupChats.listenMessages({
      groupId: options.groupId,
      pageSize,
      signal: options.signal,
      onDocument: async (document) => {
        const { message, notification } = toGroupChatChangeNotification(document, options.groupId, decryptionKey);
        if (
          await isRecentOutboundEcho({
            dedupeStore: this.dedupeStore,
            logger: this.logger,
            message,
            scope: "group"
          })
        ) {
          return;
        }

        process.stdout.write(`${JSON.stringify(toSafeOutputNotification(notification))}\n`);
        await this.hermes.handleChatChanged(notification);
      }
    });
  }

  private resolveDecryptionKey(): string {
    if (this.config.kindroid.uid) {
      return this.config.kindroid.uid;
    }

    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const uid = session.firebaseAuth?.uid;
    if (!uid) {
      throw new Error(
        "Cannot decrypt live messages without a Firebase UID. Run npm run session-info to verify the saved session."
      );
    }

    return uid;
  }
}

function toSafeOutputNotification(notification: KindroidGroupChatChangeNotification) {
  return {
    ...notification,
    text: undefined,
    textPresent: Boolean(notification.text)
  };
}

function toGroupChatChangeNotification(
  document: FirestoreDocumentLike,
  groupId: string,
  decryptionKey: string
): { message: ReturnType<typeof mapKindroidMessage>; notification: KindroidGroupChatChangeNotification } {
  const data = document.data();
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const aiId = stringValue(record.ai_id);
  const message = mapKindroidMessage(document, aiId ?? groupId, { decryptionKey });
  return {
    message,
    notification: {
      type: "kindroid.group_chat.changed",
      groupId,
      aiId,
      documentId: document.id,
      timestamp: message.timestamp ?? normalizeTimestamp(record.timestamp ?? record._createTime ?? record._updateTime),
      text: message.text,
      textEncrypted: message.textEncrypted,
      textDecrypted: message.textDecrypted,
      textDecryptionError: message.textDecryptionError,
      sender: message.sender,
      role: message.role,
      source: "firestore"
    }
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "object" && value !== null && "seconds" in value && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }

  return null;
}
