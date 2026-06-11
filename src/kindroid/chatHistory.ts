import type { AppConfig } from "../config/types.js";
import type { NormalizedKindroidMessage } from "../firestore/types.js";
import { KindroidClient } from "./kindroidClient.js";
import type { GetKindroidChatMessagesResult, KindroidChatHistoryMessage } from "./types.js";
import type { Logger } from "../util/logger.js";

export type KindroidChatHistoryScope = "kin" | "group";

export interface KindroidChatHistoryTarget {
  scope: KindroidChatHistoryScope;
  id: string;
}

export interface KindroidRecentChatHistoryWindow {
  messages: NormalizedKindroidMessage[];
  complete: boolean;
  nextStartAfterTimestamp?: number;
  status?: number;
  responseText?: string;
  pageCount: number;
}

export async function loadRecentKindroidChatHistoryWindow(
  config: AppConfig,
  logger: Logger,
  options: KindroidChatHistoryTarget & {
    limit: number;
    maxPages: number;
    startAfterTimestamp?: number;
  }
): Promise<KindroidRecentChatHistoryWindow> {
  const client = new KindroidClient(config, logger);
  const messages: KindroidChatHistoryMessage[] = [];
  let startAfterTimestamp = options.startAfterTimestamp;
  let pageCount = 0;

  for (;;) {
    if (pageCount >= Math.max(1, options.maxPages)) {
      return recentWindowResult(messages, options, false, startAfterTimestamp, pageCount);
    }

    const result = await pacedGetChatMessages(client, {
      aiId: options.scope === "kin" ? options.id : undefined,
      groupId: options.scope === "group" ? options.id : undefined,
      limit: 100,
      startAfterTimestamp
    });
    pageCount += 1;
    if (!result.ok) {
      return {
        ...recentWindowResult(messages, options, false, startAfterTimestamp, pageCount),
        status: result.status,
        responseText: result.responseText
      };
    }

    messages.push(...result.messages);
    if (!result.pagination?.hasMore || typeof result.pagination.lastTimestamp !== "number") {
      return recentWindowResult(messages, options, true, undefined, pageCount);
    }
    if (result.pagination.lastTimestamp === startAfterTimestamp) {
      throw new Error("Kindroid get-chat-messages pagination did not advance.");
    }
    startAfterTimestamp = result.pagination.lastTimestamp;
  }
}

export async function loadRecentKindroidChatHistoryMessages(
  config: AppConfig,
  logger: Logger,
  options: KindroidChatHistoryTarget & { limit: number }
): Promise<NormalizedKindroidMessage[]> {
  const result = await loadRecentKindroidChatHistoryWindow(config, logger, {
    ...options,
    maxPages: 2
  });
  if (!result.complete) {
    if (result.status) {
      throw new Error(`Kindroid get-chat-messages failed with HTTP ${result.status}.`);
    }
    throw new Error("Kindroid get-chat-messages recent read stopped before the newest page; retry later.");
  }
  return result.messages;
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
    const result = await pacedGetChatMessages(client, {
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

function recentWindowResult(
  messages: KindroidChatHistoryMessage[],
  options: KindroidChatHistoryTarget & { limit: number },
  complete: boolean,
  nextStartAfterTimestamp: number | undefined,
  pageCount: number
): KindroidRecentChatHistoryWindow {
  return {
    messages: messages
      .slice(-Math.max(1, options.limit))
      .map((message) => normalizeKindroidChatHistoryMessage(message, options)),
    complete,
    nextStartAfterTimestamp,
    pageCount
  };
}

let chatHistoryRequestChain: Promise<void> = Promise.resolve();
let nextChatHistoryRequestAt = 0;
const chatHistoryRequestIntervalMs = process.env.NODE_ENV === "test" ? 0 : 500;
const chatHistoryRateLimitMaxAttempts = 10;
const chatHistoryRateLimitBaseDelayMs = process.env.NODE_ENV === "test" ? 0 : 2_000;
const chatHistoryRateLimitMaxDelayMs = process.env.NODE_ENV === "test" ? 0 : 60_000;

async function pacedGetChatMessages(
  client: KindroidClient,
  input: Parameters<KindroidClient["getChatMessages"]>[0]
): ReturnType<KindroidClient["getChatMessages"]> {
  const previous = chatHistoryRequestChain;
  let release!: () => void;
  chatHistoryRequestChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);
  try {
    const waitMs = nextChatHistoryRequestAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return await getChatMessagesWithRateLimitRetry(client, input);
  } finally {
    nextChatHistoryRequestAt = Date.now() + chatHistoryRequestIntervalMs;
    release();
  }
}

async function getChatMessagesWithRateLimitRetry(
  client: KindroidClient,
  input: Parameters<KindroidClient["getChatMessages"]>[0]
): Promise<GetKindroidChatMessagesResult> {
  let result: GetKindroidChatMessagesResult;
  for (let attempt = 1; ; attempt += 1) {
    result = await client.getChatMessages(input);
    if (result.status !== 429 || attempt >= chatHistoryRateLimitMaxAttempts) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, rateLimitDelayMs(result.retryAfterMs, attempt)));
  }
}

function rateLimitDelayMs(retryAfterMs: number | undefined, attempt: number): number {
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, chatHistoryRateLimitMaxDelayMs);
  }

  return Math.min(chatHistoryRateLimitBaseDelayMs * 2 ** (attempt - 1), chatHistoryRateLimitMaxDelayMs);
}
