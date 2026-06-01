import type { AppConfig } from "../config/types.js";
import type { HermesAdapter } from "../hermes/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import { FirestoreListenClient } from "./firestoreListenClient.js";
import { mapKindroidMessage } from "./messageMapper.js";
import type { KindroidChatChangeNotification } from "./types.js";

export interface ChatListenerOptions {
  kinId: string;
  pageSize?: number;
  signal?: AbortSignal;
}

export class KindroidChatListener {
  constructor(
    private readonly config: AppConfig,
    private readonly hermes: HermesAdapter,
    private readonly dedupeStore: DedupeStore,
    private readonly logger: Logger
  ) {}

  async start(options: ChatListenerOptions): Promise<void> {
    const client = new FirestoreListenClient(this.config, this.logger);
    const pageSize = options.pageSize ?? 50;
    this.logger.info("Preparing Firestore listener.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pageSize,
      mode: "notification-only"
    });

    await client.listenChatMessages({
      kinId: options.kinId,
      limit: pageSize,
      signal: options.signal,
      onDocument: async (document) => {
        const message = mapKindroidMessage(document, options.kinId);
        const notification = toChatChangeNotification(message);

        process.stdout.write(`${JSON.stringify(notification)}\n`);
        await this.hermes.handleChatChanged(notification);
      }
    });
  }
}

function toChatChangeNotification(message: {
  id: string;
  kinId: string;
  timestamp: string | null;
  sender: string | null;
  role: string | null;
}): KindroidChatChangeNotification {
  return {
    type: "kindroid.chat.changed",
    kinId: message.kinId,
    documentId: message.id,
    timestamp: message.timestamp,
    sender: message.sender,
    role: message.role,
    source: "firestore"
  };
}
