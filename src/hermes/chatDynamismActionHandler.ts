import type {
  ChatDynamismSuggestion,
  ChatDynamismSuggestionStore
} from "../chatDynamism/chatDynamismSuggestionStore.js";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import {
  clampChatDynamism,
  defaultChatDynamismBounds,
  normalizeChatDynamismInput,
  roundChatDynamismStep
} from "../kindroid/chatDynamism.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface ProposeChatDynamismAdjustmentAction {
  type: "propose_chat_dynamism_adjustment";
  ai_id?: string;
  direction: "increase" | "decrease" | "set";
  suggested_delta?: number;
  suggested_target: number;
  current_value?: unknown;
  reason: string;
  confidence: "high";
}

export class ChatDynamismActionHandler implements HermesActionHandler<ProposeChatDynamismAdjustmentAction> {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly store: ChatDynamismSuggestionStore,
    private readonly onSuggestionCreated?: (suggestion: ChatDynamismSuggestion) => void,
    private readonly options: {
      isEnabled?: (aiId: string) => boolean;
      range?: (aiId: string) => { min: number; max: number };
    } = {}
  ) {}

  promptLines(): string[] {
    if (!this.config.hermes.chatDynamism.suggestions.enabled) {
      return [];
    }

    return [
      'For reviewed direct Kin Chat Dynamism changes, you may request: {"type":"propose_chat_dynamism_adjustment","ai_id":"<same direct chat ai_id>","direction":"increase","suggested_delta":0.05,"suggested_target":0.82,"reason":"<specific multi-message pattern>","confidence":"high"}.',
      "Chat Dynamism is a reviewed setting only. Never apply it automatically; Kinagent will store a pending suggestion for human review.",
      "Only propose Chat Dynamism changes when chatDynamismContext.enabledForKin is true and the target is inside chatDynamismContext.allowedRange and chatDynamismContext.hardLimits.",
      "Use chatDynamismContext.currentValue, recommendedStartingValue, practicalRange, and deltaGuidance to tune the suggested_delta. Treat deltaGuidance.noticeableBase as the minimum adjustment a user is likely to notice; stronger repeated patterns may justify moderate or strong deltas. Do not use a fixed delta for every case.",
      "Suggest lowering Chat Dynamism only for repeated drift, over-improvisation, emotional inflation, rambling, tone instability, ignored corrections, or excessive metaphor after more than one message.",
      "Suggest raising Chat Dynamism only for repeated flatness, repetitive replies, under-reaction, generic support-bot tone, or failure to advance roleplay when clearly invited.",
      "Prefer the smallest effective target change. Do not suggest a change when the user is actively steering tone manually or confidence is not high.",
      "Do not propose Chat Dynamism changes for group chats."
    ];
  }

  normalizeActions(decision: HermesActionDecision): ProposeChatDynamismAdjustmentAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): ProposeChatDynamismAdjustmentAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (
        record.type !== "propose_chat_dynamism_adjustment" ||
        record.confidence !== "high" ||
        typeof record.reason !== "string" ||
        !isDirection(record.direction)
      ) {
        return [];
      }

      try {
        const suggestedTarget = roundChatDynamismStep(
          clampChatDynamism(normalizeChatDynamismInput(valueOrThrow(record.suggested_target))),
          defaultChatDynamismBounds.step
        );
        const suggestedDelta =
          record.suggested_delta === undefined
            ? undefined
            : roundChatDynamismStep(normalizeChatDynamismInput(valueOrThrow(record.suggested_delta)));

        return [
          {
            type: "propose_chat_dynamism_adjustment",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            direction: record.direction,
            suggested_delta: suggestedDelta,
            suggested_target: suggestedTarget,
            current_value: record.current_value,
            reason: record.reason,
            confidence: "high"
          }
        ];
      } catch {
        return [];
      }
    });
  }

  async handle(notification: KindroidChatNotification, action: ProposeChatDynamismAdjustmentAction): Promise<void> {
    if (!this.config.hermes.chatDynamism.suggestions.enabled) {
      return;
    }

    if (notification.type !== "kindroid.chat.changed") {
      this.logger.info("Ignoring Chat Dynamism suggestion for group chat.", {
        documentId: notification.documentId,
        type: notification.type
      });
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring Chat Dynamism suggestion for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    if (this.options.isEnabled && !this.options.isEnabled(notification.kinId)) {
      this.logger.info("Ignoring Chat Dynamism suggestion because it is disabled for this Kin.", {
        aiId: notification.kinId,
        documentId: notification.documentId
      });
      return;
    }

    const range = this.options.range?.(notification.kinId);
    if (range && (action.suggested_target < range.min || action.suggested_target > range.max)) {
      this.logger.info("Ignoring Chat Dynamism suggestion outside the Kin range.", {
        aiId: notification.kinId,
        documentId: notification.documentId,
        suggestedTarget: action.suggested_target,
        min: range.min,
        max: range.max
      });
      return;
    }

    const suggestion = this.store.createPending(notification, {
      currentValue: action.current_value,
      suggestedTarget: action.suggested_target,
      suggestedDelta: action.suggested_delta,
      direction: action.direction,
      reason: action.reason,
      confidence: "high",
      safetyNotes: [
        "Reviewed suggestion only; no automatic Kindroid mutation is performed.",
        "Use the manual experiment before enabling any write path for this Kin."
      ]
    });
    if (!suggestion) {
      this.logger.info("Chat Dynamism suggestion skipped.", {
        aiId: notification.kinId,
        documentId: notification.documentId
      });
      return;
    }

    this.logger.info("Chat Dynamism suggestion created.", {
      aiId: suggestion.aiId,
      documentId: suggestion.sourceDocumentId,
      direction: suggestion.direction,
      suggestedTarget: suggestion.suggestedTarget
    });
    this.onSuggestionCreated?.(suggestion);
  }
}

function isDirection(value: unknown): value is "increase" | "decrease" | "set" {
  return value === "increase" || value === "decrease" || value === "set";
}

function valueOrThrow(value: unknown): string | number {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  throw new Error("Expected a numeric Chat Dynamism value.");
}
