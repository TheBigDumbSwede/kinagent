import type { AppConfig } from "../config/types.js";
import { loadBrowserSession } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import { FirestoreRestClient } from "./firestoreRestClient.js";
import { mapKindroidMessage } from "./messageMapper.js";
import type { NormalizedKindroidMessage } from "./types.js";

export interface KindroidLiveMonitorOptions {
  kinId: string;
  pollSeconds?: number;
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
    const client = new FirestoreRestClient(this.config, this.logger);
    const pollMs = (options.pollSeconds ?? 5) * 1000;
    const pageSize = options.pageSize ?? 50;
    const decryptionKey = this.resolveDecryptionKey();
    const seen = new Set<string>();

    this.logger.info("Preparing live Kindroid message monitor.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pollSeconds: pollMs / 1000,
      pageSize
    });

    const initialDocuments = await client.listChatMessages({ kinId: options.kinId, limit: pageSize });
    for (const document of initialDocuments) {
      seen.add(document.id);
    }

    this.logger.info("Live Kindroid message monitor started.", {
      kinId: options.kinId,
      existingMessages: seen.size
    });

    while (!options.signal?.aborted) {
      await sleep(pollMs);
      if (options.signal?.aborted) {
        break;
      }

      const documents = await client.listChatMessages({ kinId: options.kinId, limit: pageSize });
      const newMessages: NormalizedKindroidMessage[] = [];

      for (const document of documents) {
        if (seen.has(document.id)) {
          continue;
        }

        seen.add(document.id);
        newMessages.push(mapKindroidMessage(document, options.kinId, { decryptionKey }));
      }

      for (const message of newMessages.reverse()) {
        await emitMessage(toOutputMessage(message, Boolean(options.includeRaw)), options);
      }
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
