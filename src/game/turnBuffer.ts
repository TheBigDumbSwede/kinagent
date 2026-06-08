import type { KindroidGroupChatChangeNotification } from "../firestore/types.js";

export interface GameTurnBufferMessage {
  documentId: string;
  timestamp: string | null;
  aiId: string | null;
  sender: KindroidGroupChatChangeNotification["sender"];
  role: KindroidGroupChatChangeNotification["role"];
  text: string;
}

interface GameTurnBufferState {
  messages: GameTurnBufferMessage[];
  seenDocumentIds: string[];
}

export interface GameTurnParcel {
  closedBy: "user";
  contextMessages: GameTurnBufferMessage[];
  userMessage: GameTurnBufferMessage;
}

export interface TurnBufferOptions {
  maxMessages?: number;
  maxAgeMs?: number;
  seenDocumentIdLimit?: number;
}

const defaultMaxMessages = 12;
const defaultMaxAgeMs = 10 * 60 * 1000;
const defaultSeenDocumentIdLimit = 100;

export class TurnBuffer {
  private readonly buffers = new Map<string, GameTurnBufferState>();
  private readonly maxMessages: number;
  private readonly maxAgeMs: number;
  private readonly seenDocumentIdLimit: number;

  constructor(options: TurnBufferOptions = {}) {
    this.maxMessages = options.maxMessages ?? defaultMaxMessages;
    this.maxAgeMs = options.maxAgeMs ?? defaultMaxAgeMs;
    this.seenDocumentIdLimit = options.seenDocumentIdLimit ?? defaultSeenDocumentIdLimit;
  }

  bufferContext(groupId: string, notification: KindroidGroupChatChangeNotification): boolean {
    const buffer = this.pruned(groupId, notification.timestamp);
    if (buffer.seenDocumentIds.includes(notification.documentId)) {
      return false;
    }

    buffer.messages.push(turnBufferMessage(notification));
    buffer.messages = this.boundMessages(buffer.messages, notification.timestamp);
    buffer.seenDocumentIds = this.boundSeenDocumentIds([...buffer.seenDocumentIds, notification.documentId]);
    this.buffers.set(groupId, buffer);
    return true;
  }

  buildParcel(groupId: string, notification: KindroidGroupChatChangeNotification): GameTurnParcel {
    return {
      closedBy: "user",
      contextMessages: this.context(groupId, notification.timestamp),
      userMessage: turnBufferMessage(notification)
    };
  }

  context(groupId: string, timestamp: string | null | undefined): GameTurnBufferMessage[] {
    return this.pruned(groupId, timestamp).messages;
  }

  checkpoint(groupId: string, parcel: GameTurnParcel): void {
    const buffer = this.pruned(groupId, parcel.userMessage.timestamp);
    this.buffers.set(groupId, {
      messages: [],
      seenDocumentIds: this.boundSeenDocumentIds([
        ...buffer.seenDocumentIds,
        ...parcel.contextMessages.map((message) => message.documentId),
        parcel.userMessage.documentId
      ])
    });
  }

  clear(groupId: string): void {
    this.buffers.delete(groupId);
  }

  private pruned(groupId: string, timestamp: string | null | undefined): GameTurnBufferState {
    const current = this.buffers.get(groupId) ?? { messages: [], seenDocumentIds: [] };
    const pruned = {
      messages: this.boundMessages(current.messages, timestamp),
      seenDocumentIds: this.boundSeenDocumentIds(current.seenDocumentIds)
    };
    this.buffers.set(groupId, pruned);
    return pruned;
  }

  private boundMessages(
    messages: GameTurnBufferMessage[],
    timestamp: string | null | undefined
  ): GameTurnBufferMessage[] {
    const currentMs = timestampMs(timestamp);
    const recent = messages.filter((message) => {
      const messageMs = timestampMs(message.timestamp);
      return !Number.isFinite(currentMs) || !Number.isFinite(messageMs) || currentMs - messageMs <= this.maxAgeMs;
    });
    return recent.slice(-this.maxMessages);
  }

  private boundSeenDocumentIds(documentIds: string[]): string[] {
    return [...new Set(documentIds)].slice(-this.seenDocumentIdLimit);
  }
}

function turnBufferMessage(notification: KindroidGroupChatChangeNotification): GameTurnBufferMessage {
  return {
    documentId: notification.documentId,
    timestamp: notification.timestamp,
    aiId: notification.aiId,
    sender: notification.sender,
    role: notification.role,
    text: notification.text ?? ""
  };
}

function timestampMs(value: string | null | undefined): number {
  if (!value) {
    return NaN;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}
