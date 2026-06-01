import type { AppConfig } from "../config/types.js";
import type { HermesAdapter } from "../hermes/types.js";
import { KindroidApiClient } from "../kindroid/client/index.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import type { FirestoreDocumentLike, KindroidGroupChatChangeNotification } from "./types.js";

export interface GroupChatListenerOptions {
  groupId: string;
  pageSize?: number;
  signal?: AbortSignal;
}

export class KindroidGroupChatListener {
  constructor(
    private readonly config: AppConfig,
    private readonly hermes: HermesAdapter,
    _dedupeStore: DedupeStore,
    private readonly logger: Logger
  ) {}

  async start(options: GroupChatListenerOptions): Promise<void> {
    const client = new KindroidApiClient(this.config, this.logger);
    const pageSize = options.pageSize ?? 50;
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
        const notification = toGroupChatChangeNotification(document, options.groupId);
        process.stdout.write(`${JSON.stringify(notification)}\n`);
        await this.hermes.handleChatChanged(notification);
      }
    });
  }
}

function toGroupChatChangeNotification(
  document: FirestoreDocumentLike,
  groupId: string
): KindroidGroupChatChangeNotification {
  const data = document.data();
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return {
    type: "kindroid.group_chat.changed",
    groupId,
    aiId: stringValue(record.ai_id),
    documentId: document.id,
    timestamp: normalizeTimestamp(record.timestamp ?? record._createTime ?? record._updateTime),
    sender: stringValue(record.sender),
    role: stringValue(record.role),
    source: "firestore"
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
