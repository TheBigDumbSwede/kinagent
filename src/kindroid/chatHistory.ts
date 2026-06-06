import type { AppConfig } from "../config/types.js";
import type { NormalizedKindroidMessage } from "../firestore/types.js";
import { KindroidClient } from "./kindroidClient.js";
import type { KindroidChatHistoryMessage } from "./types.js";
import type { Logger } from "../util/logger.js";

export type KindroidChatHistoryScope = "kin" | "group";

export interface KindroidChatHistoryTarget {
  scope: KindroidChatHistoryScope;
  id: string;
}

export async function loadRecentKindroidChatHistoryMessages(
  config: AppConfig,
  logger: Logger,
  options: KindroidChatHistoryTarget & { limit: number }
): Promise<NormalizedKindroidMessage[]> {
  const result = await new KindroidClient(config, logger).getChatMessages({
    aiId: options.scope === "kin" ? options.id : undefined,
    groupId: options.scope === "group" ? options.id : undefined,
    limit: options.limit
  });
  if (!result.ok) {
    throw new Error(`Kindroid get-chat-messages failed with HTTP ${result.status}.`);
  }

  return result.messages.map((message) => normalizeKindroidChatHistoryMessage(message, options));
}

export async function loadAllKindroidChatHistoryMessages(
  config: AppConfig,
  logger: Logger,
  options: KindroidChatHistoryTarget
): Promise<NormalizedKindroidMessage[]> {
  const client = new KindroidClient(config, logger);
  const messages: KindroidChatHistoryMessage[] = [];
  let startAfterTimestamp: number | undefined;

  for (;;) {
    const result = await client.getChatMessages({
      aiId: options.scope === "kin" ? options.id : undefined,
      groupId: options.scope === "group" ? options.id : undefined,
      limit: 100,
      startAfterTimestamp
    });
    if (!result.ok) {
      throw new Error(`Kindroid get-chat-messages failed with HTTP ${result.status}.`);
    }

    messages.push(...result.messages);
    if (!result.pagination?.hasMore || typeof result.pagination.lastTimestamp !== "number") {
      return messages.map((message) => normalizeKindroidChatHistoryMessage(message, options));
    }
    if (result.pagination.lastTimestamp === startAfterTimestamp) {
      throw new Error("Kindroid get-chat-messages pagination did not advance.");
    }
    startAfterTimestamp = result.pagination.lastTimestamp;
  }
}

export function normalizeKindroidChatHistoryMessage(
  message: KindroidChatHistoryMessage,
  options: KindroidChatHistoryTarget
): NormalizedKindroidMessage {
  const timestamp = normalizePublicApiTimestamp(message.timestamp);
  return {
    id: stringValue(message.id) ?? `${options.id}-${timestamp ?? "undated"}`,
    kinId: options.scope === "kin" ? options.id : (chatHistorySourceKinId(message) ?? options.id),
    groupId: options.scope === "group" ? options.id : undefined,
    timestamp,
    text: stringValue(message.message),
    textEncrypted: false,
    textDecrypted: true,
    sender: stringValue(message.sender_type) ?? stringValue(message.sender),
    role: stringValue(message.sender_type),
    raw: message
  };
}

export function chatHistoryDisplayName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  return stringValue((raw as { display_name?: unknown }).display_name);
}

function chatHistorySourceKinId(message: KindroidChatHistoryMessage): string | null {
  const record = message as KindroidChatHistoryMessage & { ai_id?: unknown; aiId?: unknown };
  return stringValue(record.ai_id) ?? stringValue(record.aiId) ?? stringValue(message.sender);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizePublicApiTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
}
