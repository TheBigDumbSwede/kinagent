import type { KindroidChatNotification } from "../firestore/types.js";
import {
  ambientHermesMessageGuardrails,
  buildAmbientHermesContextTurn,
  type AmbientContextTone
} from "../kindroid/ambientContext.js";
import type { SendKindroidMessageResult } from "../kindroid/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import { newRequestId } from "../util/ids.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface SendAmbientContextTurnAction {
  type: "send_ambient_context_turn";
  ai_id?: string;
  group_id?: string;
  ambient_message: string;
  context: string;
  tone?: AmbientContextTone;
  source?: string;
  confidence: "high";
  suggested_use?: string;
  instruction?: string;
  reason?: string;
}

export interface KindroidAmbientContextSender {
  sendMessage(input: {
    aiId: string;
    message: string;
    requestId: string;
    idempotencyKey: string;
    internetResponse?: string | null;
  }): Promise<SendKindroidMessageResult>;
}

export interface AmbientContextSentEvent {
  aiId: string;
  documentId: string;
  timestamp: string;
  visibleMessage: string;
  internetResponse: string;
  source?: string;
  reason?: string;
  requestId: string;
  idempotencyKey: string;
}

export class AmbientContextActionHandler implements HermesActionHandler<SendAmbientContextTurnAction> {
  constructor(
    private readonly logger: Logger,
    private readonly kindroidClient: KindroidAmbientContextSender,
    private readonly dedupeStore: DedupeStore,
    private readonly onAmbientContextSent?: (event: AmbientContextSentEvent) => void
  ) {}

  promptLines(): string[] {
    return [
      'For direct Kin chats, you may request an immediate hidden context injection: {"type":"send_ambient_context_turn","ai_id":"<same direct chat ai_id>","ambient_message":"<small diegetic ambient beat fitted to the current conversation and current setting>","context":"<concise hidden operational context>","source":"<source or tool name>","confidence":"high","suggested_use":"<how the Kin should use this context if relevant>"}.',
      "Do not use send_ambient_context_turn for group chats. The group endpoint accepts internet_response but live diagnostics show group AI responses do not consume it.",
      "Use send_ambient_context_turn only when a direct Kin needs immediate per-turn operational context that should not be dumped visibly into chat.",
      "Do not use send_ambient_context_turn as a substitute for other registered actions: use update_current_scene or update_group_current_scene for current setting changes, and journal suggestions for reviewed durable memory.",
      "The ambient_message is visible in the Kindroid transcript; the context is attached through internet_response.",
      ...ambientHermesMessageGuardrails.map((line) => `Ambient message guardrail: ${line}`),
      "If the only useful action is a current setting update or journal proposal, do not add an ambient context turn."
    ];
  }

  normalizeActions(decision: HermesActionDecision): SendAmbientContextTurnAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): SendAmbientContextTurnAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (
        record.type !== "send_ambient_context_turn" ||
        record.confidence !== "high" ||
        typeof record.ambient_message !== "string" ||
        typeof record.context !== "string"
      ) {
        return [];
      }

      return [
        {
          type: "send_ambient_context_turn",
          ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
          group_id: typeof record.group_id === "string" ? record.group_id : undefined,
          ambient_message: record.ambient_message,
          context: record.context,
          tone: isAmbientContextTone(record.tone) ? record.tone : undefined,
          source: typeof record.source === "string" ? record.source : undefined,
          confidence: "high",
          suggested_use: typeof record.suggested_use === "string" ? record.suggested_use : undefined,
          instruction: typeof record.instruction === "string" ? record.instruction : undefined,
          reason: typeof record.reason === "string" ? record.reason : undefined
        }
      ];
    });
  }

  async handle(notification: KindroidChatNotification, action: SendAmbientContextTurnAction): Promise<void> {
    if (notification.type === "kindroid.chat.changed") {
      await this.handleDirectAmbientContextAction(notification, action);
      return;
    }

    if (notification.type === "kindroid.group_chat.changed") {
      this.logger.info(
        "Ignoring ambient context action for group chat because group internet_response is not consumed.",
        Object.assign(safeNotificationMeta(notification), { requestedGroupId: action.group_id })
      );
      return;
    }

    this.logger.info(
      "Ignoring ambient context action for unsupported Kindroid notification.",
      safeNotificationMeta(notification)
    );
  }

  private async handleDirectAmbientContextAction(
    notification: Extract<KindroidChatNotification, { type: "kindroid.chat.changed" }>,
    action: SendAmbientContextTurnAction
  ): Promise<void> {
    if (action.group_id) {
      this.logger.info(
        "Ignoring direct ambient context action with group_id.",
        Object.assign(safeNotificationMeta(notification), { requestedGroupId: action.group_id })
      );
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring ambient context action for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    const turn = buildAmbientHermesContextTurn({
      tone: action.tone,
      ambientMessage: action.ambient_message,
      hermesResult: action.context,
      suggestedUse: action.suggested_use,
      confidence: action.confidence,
      source: action.source,
      instruction: action.instruction
    });
    const requestId = newRequestId();
    const idempotencyKey = newRequestId();

    this.logger.info("Hermes ambient context action requested.", {
      aiId: notification.kinId,
      documentId: notification.documentId,
      tone: turn.tone,
      ambientMessageLength: turn.visibleMessage.length,
      contextLength: action.context.length,
      source: action.source,
      reason: action.reason
    });

    await this.dedupeStore.recordOutbound({
      kinId: notification.kinId,
      text: turn.visibleMessage,
      requestId,
      idempotencyKey
    });

    this.onAmbientContextSent?.({
      aiId: notification.kinId,
      documentId: notification.documentId,
      timestamp: new Date().toISOString(),
      visibleMessage: turn.visibleMessage,
      internetResponse: turn.internetResponse,
      source: action.source,
      reason: action.reason,
      requestId,
      idempotencyKey
    });

    const result = await this.kindroidClient.sendMessage({
      aiId: notification.kinId,
      message: turn.visibleMessage,
      requestId,
      idempotencyKey,
      internetResponse: turn.internetResponse
    });

    const meta = {
      aiId: notification.kinId,
      ok: result.ok,
      status: result.status,
      requestId: result.requestId,
      idempotencyKey: result.idempotencyKey,
      responseText: result.responseText
    };
    if (result.ok) {
      this.logger.info("Hermes ambient context action completed.", meta);
    } else {
      this.logger.warn("Hermes ambient context action failed.", meta);
    }
  }
}

export function isAmbientContextSender(value: unknown): value is KindroidAmbientContextSender {
  return Boolean(
    value && typeof value === "object" && typeof (value as { sendMessage?: unknown }).sendMessage === "function"
  );
}

function isAmbientContextTone(value: unknown): value is AmbientContextTone {
  return (
    value === "neutral" ||
    value === "domestic" ||
    value === "storm" ||
    value === "sci-fi" ||
    value === "noir" ||
    value === "fantasy" ||
    value === "gothic"
  );
}

function safeNotificationMeta(notification: KindroidChatNotification) {
  return {
    type: notification.type,
    documentId: notification.documentId,
    kinId: "kinId" in notification ? notification.kinId : undefined,
    groupId: "groupId" in notification ? notification.groupId : undefined,
    aiId: "aiId" in notification ? notification.aiId : undefined,
    timestamp: notification.timestamp,
    sender: notification.sender,
    role: notification.role,
    textPresent: Boolean(notification.text),
    textEncrypted: notification.textEncrypted,
    textDecrypted: notification.textDecrypted,
    source: notification.source
  };
}
