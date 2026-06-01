import type { AppConfig } from "../config/types.js";
import type { HermesAdapter } from "../hermes/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import { FirestoreRestClient } from "./firestoreRestClient.js";
import { mapKindroidMessage } from "./messageMapper.js";
import type { KindroidChatChangeNotification } from "./types.js";

export interface ChatListenerOptions {
  kinId: string;
  pollSeconds?: number;
}

export class KindroidChatListener {
  constructor(
    private readonly config: AppConfig,
    private readonly hermes: HermesAdapter,
    private readonly dedupeStore: DedupeStore,
    private readonly logger: Logger
  ) {}

  async start(options: ChatListenerOptions): Promise<void> {
    const client = new FirestoreRestClient(this.config, this.logger);
    const pollMs = (options.pollSeconds ?? 5) * 1000;
    const seen = new Set<string>();
    this.logger.info("Preparing Firestore listener.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pollSeconds: pollMs / 1000,
      mode: "notification-only"
    });

    const initialDocuments = await client.listChatMessages({ kinId: options.kinId, limit: 50 });
    for (const document of initialDocuments) {
      seen.add(document.id);
    }

    this.logger.info("Firestore polling listener started.", {
      kinId: options.kinId,
      existingMessages: seen.size
    });

    for (;;) {
      await sleep(pollMs);
      const documents = await client.listChatMessages({ kinId: options.kinId, limit: 50 });
      for (const document of documents) {
        if (seen.has(document.id)) {
          continue;
        }

        seen.add(document.id);
        const message = mapKindroidMessage(document, options.kinId);
        const notification = toChatChangeNotification(message);

        process.stdout.write(`${JSON.stringify(notification)}\n`);
        await this.hermes.handleChatChanged(notification);
      }
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
