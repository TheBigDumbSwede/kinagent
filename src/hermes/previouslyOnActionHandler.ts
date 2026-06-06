import type { KindroidChatNotification } from "../firestore/types.js";
import {
  type PreviouslyOnBrief,
  type PreviouslyOnBriefInput,
  type PreviouslyOnStore
} from "../previouslyOn/previouslyOnStore.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface UpdatePreviouslyOnBriefAction extends PreviouslyOnBriefInput {
  type: "update_previously_on_brief";
  ai_id?: string;
}

export interface UpdateGroupPreviouslyOnBriefAction extends PreviouslyOnBriefInput {
  type: "update_group_previously_on_brief";
  group_id?: string;
}

type PreviouslyOnAction = UpdatePreviouslyOnBriefAction | UpdateGroupPreviouslyOnBriefAction;

export class PreviouslyOnActionHandler implements HermesActionHandler<PreviouslyOnAction> {
  constructor(
    private readonly logger: Logger,
    private readonly store: PreviouslyOnStore,
    private readonly onPreviouslyOnUpdated?: (brief: PreviouslyOnBrief) => void
  ) {}

  promptLines(): string[] {
    return [
      'For direct Kin continuity recap, you may request: {"type":"update_previously_on_brief","ai_id":"<same direct chat ai_id>","facts":["<known recent fact>"],"inferredTone":"<brief inferred tone>","unresolvedThreads":["<open thread>"],"suggestedOpeningFrame":"<small practical next frame>","recap":"<short user-readable recap>","confidence":"low|medium|high"}.',
      'For group continuity recap, you may request: {"type":"update_group_previously_on_brief","group_id":"<same group_id>","facts":["<known recent fact>"],"inferredTone":"<brief inferred tone>","unresolvedThreads":["<open thread>"],"suggestedOpeningFrame":"<small practical next frame>","recap":"<short user-readable recap>","confidence":"low|medium|high"}.',
      "Previously On briefs are local Kinagent continuity notes only. They must not write Kindroid memory, current_scene, journals, chat text, or user replies.",
      "Keep Previously On briefs short and practical. Facts must come from recent readable chat; inferredTone may summarize mood or subtext but must not invent events.",
      "Use suggestedOpeningFrame as optional user-facing guidance, not as automatic prompt injection."
    ];
  }

  normalizeActions(decision: HermesActionDecision): PreviouslyOnAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): PreviouslyOnAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      const brief = parsePreviouslyOnInput(record);
      if (!brief) {
        return [];
      }

      if (record.type === "update_previously_on_brief") {
        return [
          {
            type: "update_previously_on_brief",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            ...brief
          }
        ];
      }

      if (record.type === "update_group_previously_on_brief") {
        return [
          {
            type: "update_group_previously_on_brief",
            group_id: typeof record.group_id === "string" ? record.group_id : undefined,
            ...brief
          }
        ];
      }

      return [];
    });
  }

  async handle(notification: KindroidChatNotification, action: PreviouslyOnAction): Promise<void> {
    if (action.type === "update_group_previously_on_brief") {
      this.handleGroupBrief(notification, action);
      return;
    }

    this.handleKinBrief(notification, action);
  }

  private handleKinBrief(notification: KindroidChatNotification, action: UpdatePreviouslyOnBriefAction): void {
    if (notification.type !== "kindroid.chat.changed") {
      this.logger.debug("Ignoring Previously On action for non-direct chat.", safeNotificationMeta(notification));
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring Previously On action for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    const updated = this.store.update(notification, action);
    if (!updated) {
      return;
    }

    this.logger.info("Hermes Previously On brief updated.", {
      scope: "kin",
      aiId: notification.kinId,
      documentId: notification.documentId,
      confidence: updated.confidence
    });
    this.onPreviouslyOnUpdated?.(updated);
  }

  private handleGroupBrief(notification: KindroidChatNotification, action: UpdateGroupPreviouslyOnBriefAction): void {
    if (notification.type !== "kindroid.group_chat.changed") {
      this.logger.debug("Ignoring group Previously On action for non-group chat.", safeNotificationMeta(notification));
      return;
    }

    const targetGroupId = action.group_id ?? notification.groupId;
    if (targetGroupId !== notification.groupId) {
      this.logger.warn("Ignoring group Previously On action for mismatched group_id.", {
        expectedGroupId: notification.groupId,
        requestedGroupId: targetGroupId
      });
      return;
    }

    const updated = this.store.update(notification, action);
    if (!updated) {
      return;
    }

    this.logger.info("Hermes group Previously On brief updated.", {
      scope: "group",
      groupId: notification.groupId,
      documentId: notification.documentId,
      confidence: updated.confidence
    });
    this.onPreviouslyOnUpdated?.(updated);
  }
}

function parsePreviouslyOnInput(record: Record<string, unknown>): PreviouslyOnBriefInput | null {
  const input: PreviouslyOnBriefInput = {
    facts: stringArray(record.facts),
    inferredTone: stringField(record.inferredTone) ?? stringField(record.inferred_tone),
    unresolvedThreads: stringArray(record.unresolvedThreads) ?? stringArray(record.unresolved_threads),
    suggestedOpeningFrame: stringField(record.suggestedOpeningFrame) ?? stringField(record.suggested_opening_frame),
    recap: stringField(record.recap),
    confidence: confidenceField(record.confidence)
  };

  return hasPreviouslyOnInput(input) ? input : null;
}

function hasPreviouslyOnInput(input: PreviouslyOnBriefInput): boolean {
  return Boolean(
    input.recap ||
    input.inferredTone ||
    input.suggestedOpeningFrame ||
    (input.facts && input.facts.length > 0) ||
    (input.unresolvedThreads && input.unresolvedThreads.length > 0)
  );
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return values.length > 0 ? values : undefined;
}

function confidenceField(value: unknown): PreviouslyOnBriefInput["confidence"] {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
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
