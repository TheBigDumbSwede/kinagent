import type { AppConfig } from "../config/types.js";
import { loadBrowserSession } from "../auth/firebaseSession.js";
import type { HermesAdapter } from "../hermes/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import { KindroidApiClient } from "../kindroid/client/index.js";
import { findActiveDiagnosticSuppression } from "../state/diagnosticSuppressionStore.js";
import { isRecentOutboundEcho } from "./messageDedupe.js";
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
    const client = new KindroidApiClient(this.config, this.logger);
    const pageSize = options.pageSize ?? 50;
    const decryptionKey = this.resolveDecryptionKey();
    this.logger.info("Preparing Firestore listener.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pageSize,
      mode: "notification-only"
    });

    await client.chats.listenMessages({
      kinId: options.kinId,
      pageSize,
      signal: options.signal,
      onDocument: async (document) => {
        const message = mapKindroidMessage(document, options.kinId, { decryptionKey });
        if (
          await isRecentOutboundEcho({
            dedupeStore: this.dedupeStore,
            logger: this.logger,
            message,
            scope: "direct"
          })
        ) {
          return;
        }

        const diagnosticSuppression = findActiveDiagnosticSuppression(this.config, {
          kinId: message.kinId,
          timestamp: message.timestamp
        });
        if (diagnosticSuppression) {
          this.logger.info("Skipping diagnostic Kindroid chat event.", {
            kinId: message.kinId,
            documentId: message.id,
            sender: message.sender,
            reason: diagnosticSuppression.reason,
            expiresAt: new Date(diagnosticSuppression.expiresAt).toISOString()
          });
          return;
        }

        const notification = toChatChangeNotification(message);

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

function toSafeOutputNotification(notification: KindroidChatChangeNotification) {
  return {
    ...notification,
    text: undefined,
    textPresent: Boolean(notification.text)
  };
}

function toChatChangeNotification(message: {
  id: string;
  kinId: string;
  timestamp: string | null;
  text?: string | null;
  textEncrypted?: boolean;
  textDecrypted?: boolean;
  textDecryptionError?: string;
  sender: string | null;
  role: string | null;
}): KindroidChatChangeNotification {
  return {
    type: "kindroid.chat.changed",
    kinId: message.kinId,
    documentId: message.id,
    timestamp: message.timestamp,
    text: message.text,
    textEncrypted: message.textEncrypted,
    textDecrypted: message.textDecrypted,
    textDecryptionError: message.textDecryptionError,
    sender: message.sender,
    role: message.role,
    source: "firestore"
  };
}
