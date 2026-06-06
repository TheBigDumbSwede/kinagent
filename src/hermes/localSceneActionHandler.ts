import type { KindroidChatNotification } from "../firestore/types.js";
import {
  type LocalSceneState,
  type LocalSceneStateInput,
  type LocalSceneStateStore
} from "../localScene/localSceneStore.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface UpdateLocalSceneStateAction extends LocalSceneStateInput {
  type: "update_local_scene_state";
  ai_id?: string;
}

export interface UpdateGroupLocalSceneStateAction extends LocalSceneStateInput {
  type: "update_group_local_scene_state";
  group_id?: string;
}

type LocalSceneAction = UpdateLocalSceneStateAction | UpdateGroupLocalSceneStateAction;

export class LocalSceneActionHandler implements HermesActionHandler<LocalSceneAction> {
  constructor(
    private readonly logger: Logger,
    private readonly store: LocalSceneStateStore,
    private readonly onLocalSceneUpdated?: (state: LocalSceneState) => void
  ) {}

  promptLines(): string[] {
    return [
      'For local direct-Kin scene metadata, you may request: {"type":"update_local_scene_state","ai_id":"<same direct chat ai_id>","location":"<current place>","timeOfDay":"<time if known>","mood":"<scene mood>","activity":"<current activity>","tension":0.25,"privacy":"private|public|unknown","suggestedUiAccent":"<short UI color/light cue>","evidence":["<short supporting evidence>"],"reason":"<why this scene state changed>"}.',
      'For local group scene metadata, you may request: {"type":"update_group_local_scene_state","group_id":"<same group_id>","location":"<current group place>","timeOfDay":"<time if known>","mood":"<scene mood>","activity":"<current activity>","tension":0.25,"privacy":"private|public|unknown","suggestedUiAccent":"<short UI color/light cue>","evidence":["<short supporting evidence>"],"reason":"<why this scene state changed>"}.',
      "Local scene metadata is backstage Kinagent state only. It must not write Kindroid memory, current_scene, journals, chat text, or user replies.",
      "Update local scene metadata only when the venue, time, activity, privacy, tension, mood, or scene direction materially changes.",
      "Keep local scene metadata compact, factual, inspectable, and grounded in the recent chat. If unsure, return no local scene action."
    ];
  }

  normalizeActions(decision: HermesActionDecision): LocalSceneAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): LocalSceneAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      const scene = parseLocalSceneInput(record);
      if (!scene) {
        return [];
      }

      if (record.type === "update_local_scene_state") {
        return [
          {
            type: "update_local_scene_state",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            ...scene
          }
        ];
      }

      if (record.type === "update_group_local_scene_state") {
        return [
          {
            type: "update_group_local_scene_state",
            group_id: typeof record.group_id === "string" ? record.group_id : undefined,
            ...scene
          }
        ];
      }

      return [];
    });
  }

  async handle(notification: KindroidChatNotification, action: LocalSceneAction): Promise<void> {
    if (action.type === "update_group_local_scene_state") {
      this.handleGroupLocalScene(notification, action);
      return;
    }

    this.handleKinLocalScene(notification, action);
  }

  private handleKinLocalScene(notification: KindroidChatNotification, action: UpdateLocalSceneStateAction): void {
    if (notification.type !== "kindroid.chat.changed") {
      this.logger.debug("Ignoring local scene action for non-direct chat.", safeNotificationMeta(notification));
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring local scene action for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    const updated = this.store.update(notification, action);
    if (!updated) {
      return;
    }

    this.logger.info("Hermes local scene state updated.", {
      scope: "kin",
      aiId: notification.kinId,
      documentId: notification.documentId,
      location: updated.location,
      activity: updated.activity
    });
    this.onLocalSceneUpdated?.(updated);
  }

  private handleGroupLocalScene(
    notification: KindroidChatNotification,
    action: UpdateGroupLocalSceneStateAction
  ): void {
    if (notification.type !== "kindroid.group_chat.changed") {
      this.logger.debug("Ignoring group local scene action for non-group chat.", safeNotificationMeta(notification));
      return;
    }

    const targetGroupId = action.group_id ?? notification.groupId;
    if (targetGroupId !== notification.groupId) {
      this.logger.warn("Ignoring group local scene action for mismatched group_id.", {
        expectedGroupId: notification.groupId,
        requestedGroupId: targetGroupId
      });
      return;
    }

    const updated = this.store.update(notification, action);
    if (!updated) {
      return;
    }

    this.logger.info("Hermes group local scene state updated.", {
      scope: "group",
      groupId: notification.groupId,
      documentId: notification.documentId,
      location: updated.location,
      activity: updated.activity
    });
    this.onLocalSceneUpdated?.(updated);
  }
}

function parseLocalSceneInput(record: Record<string, unknown>): LocalSceneStateInput | null {
  const input: LocalSceneStateInput = {
    location: stringField(record.location),
    timeOfDay: stringField(record.timeOfDay) ?? stringField(record.time_of_day),
    mood: stringField(record.mood),
    activity: stringField(record.activity),
    tension: numberField(record.tension),
    privacy: stringField(record.privacy),
    soundscape: metadataField(record.soundscape),
    visualPalette: metadataField(record.visualPalette) ?? metadataField(record.visual_palette),
    suggestedUiAccent: stringField(record.suggestedUiAccent) ?? stringField(record.suggested_ui_accent),
    evidence: stringArray(record.evidence),
    reason: stringField(record.reason)
  };

  return hasSceneInput(input) ? input : null;
}

function hasSceneInput(input: LocalSceneStateInput): boolean {
  return Boolean(
    input.location ||
    input.timeOfDay ||
    input.mood ||
    input.activity ||
    input.tension !== undefined ||
    input.privacy ||
    input.soundscape ||
    input.visualPalette ||
    input.suggestedUiAccent ||
    input.reason ||
    (input.evidence && input.evidence.length > 0)
  );
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return values.length > 0 ? values : undefined;
}

function metadataField(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number | boolean] =>
      typeof entry[0] === "string" &&
      (typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean")
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
