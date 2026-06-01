import type { AppConfig } from "../config/types.js";
import { loadBrowserSession } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import { FirestoreListenClient } from "./firestoreListenClient.js";
import { mapKindroidMessage } from "./messageMapper.js";
import type { NormalizedKindroidMessage } from "./types.js";

export interface KindroidLiveMonitorOptions {
  kinId: string;
  pageSize?: number;
  includeRaw?: boolean;
  signal?: AbortSignal;
  onMessage?: (message: KindroidLiveMonitorMessage) => void | Promise<void>;
}

export type KindroidLiveMonitorMessage = ReturnType<typeof toOutputMessage>;

export class KindroidLiveMonitor {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async start(options: KindroidLiveMonitorOptions): Promise<void> {
    const client = new FirestoreListenClient(this.config, this.logger);
    const pageSize = options.pageSize ?? 50;
    const decryptionKey = this.resolveDecryptionKey();

    this.logger.info("Preparing live Kindroid message monitor.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pageSize
    });

    await client.listenChatMessages({
      kinId: options.kinId,
      limit: pageSize,
      signal: options.signal,
      onDocument: async (document) => {
        const message = mapKindroidMessage(document, options.kinId, { decryptionKey });
        await emitMessage(toOutputMessage(message, Boolean(options.includeRaw)), options);
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

function toOutputMessage(message: NormalizedKindroidMessage, includeRaw: boolean) {
  const output = {
    type: "kindroid.chat.message",
    id: message.id,
    kinId: message.kinId,
    timestamp: message.timestamp,
    sender: message.sender,
    role: message.role,
    text: message.text,
    textEncrypted: message.textEncrypted,
    textDecrypted: message.textDecrypted,
    textDecryptionError: message.textDecryptionError,
    source: "firestore"
  };

  return includeRaw ? { ...output, raw: message.raw } : output;
}

async function emitMessage(message: KindroidLiveMonitorMessage, options: KindroidLiveMonitorOptions): Promise<void> {
  if (options.onMessage) {
    await options.onMessage(message);
    return;
  }

  process.stdout.write(`${JSON.stringify(message)}\n`);
}
