import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";

export interface DedupeCandidateMessage {
  id: string;
  kinId: string;
  text?: string | null;
  sender?: string | null;
  role?: string | null;
}

export async function isRecentOutboundEcho(input: {
  dedupeStore: DedupeStore;
  logger: Logger;
  message: DedupeCandidateMessage;
  scope: "direct" | "group";
}): Promise<boolean> {
  const { dedupeStore, logger, message, scope } = input;
  if (!message.text?.trim() || isAssistantAuthored(message)) {
    return false;
  }

  const match = await dedupeStore.matchRecentOutbound({
    kinId: message.kinId,
    text: message.text
  });
  if (!match.matched || !match.record) {
    return false;
  }

  await dedupeStore.confirm(match.record);
  logger.info("Skipping recently sent outbound Kindroid message.", {
    scope,
    kinId: message.kinId,
    documentId: message.id,
    requestId: match.record.requestId,
    idempotencyKey: match.record.idempotencyKey
  });
  return true;
}

function isAssistantAuthored(message: DedupeCandidateMessage): boolean {
  const sender = normalize(message.sender);
  const role = normalize(message.role);
  return (
    sender === "ai" ||
    sender === "assistant" ||
    sender === "kindroid" ||
    role === "ai" ||
    role === "assistant" ||
    role === "model"
  );
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
