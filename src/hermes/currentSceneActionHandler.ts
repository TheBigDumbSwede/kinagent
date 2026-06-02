import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import type { UpdateKindroidCurrentSceneResult, UpdateKindroidGroupCurrentSceneResult } from "../kindroid/types.js";
import type { Logger } from "../util/logger.js";

export interface HermesActionDecision {
  actions?: unknown;
}

export interface UpdateCurrentSceneAction {
  type: "update_current_scene";
  ai_id?: string;
  current_scene: string;
  reason?: string;
}

export interface UpdateGroupCurrentSceneAction {
  type: "update_group_current_scene";
  group_id?: string;
  current_scene: string;
  reason?: string;
}

export type HermesAction = UpdateCurrentSceneAction | UpdateGroupCurrentSceneAction;

export interface KindroidSceneUpdater {
  updateCurrentScene(input: { aiId: string; currentScene: string }): Promise<UpdateKindroidCurrentSceneResult>;
  updateGroupCurrentScene(input: {
    groupId: string;
    currentScene: string;
  }): Promise<UpdateKindroidGroupCurrentSceneResult>;
}

export interface HermesActionHandler {
  promptLines(): string[];
  normalizeActions(decision: HermesActionDecision): HermesAction[];
  handle(notification: KindroidChatNotification, action: HermesAction): Promise<void>;
}

export class CurrentSceneActionHandler implements HermesActionHandler {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly kindroidClient: KindroidSceneUpdater
  ) {}

  promptLines(): string[] {
    if (!this.config.hermes.currentSceneUpdates.enabled) {
      return [];
    }

    return [
      `For direct Kin chats, you may request: {"type":"update_current_scene","ai_id":"<same direct chat ai_id>","current_scene":"<brief current situation>","reason":"<short reason>"}.`,
      `For group chats, you may request: {"type":"update_group_current_scene","group_id":"<same group_id>","current_scene":"<brief current situation>","reason":"<short reason>"}.`
    ];
  }

  normalizeActions(decision: HermesActionDecision): HermesAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): HermesAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (typeof record.current_scene !== "string") {
        return [];
      }

      if (record.type === "update_current_scene") {
        return [
          {
            type: "update_current_scene",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            current_scene: record.current_scene,
            reason: typeof record.reason === "string" ? record.reason : undefined
          }
        ];
      }

      if (record.type === "update_group_current_scene") {
        return [
          {
            type: "update_group_current_scene",
            group_id: typeof record.group_id === "string" ? record.group_id : undefined,
            current_scene: record.current_scene,
            reason: typeof record.reason === "string" ? record.reason : undefined
          }
        ];
      }

      return [];
    });
  }

  async handle(notification: KindroidChatNotification, action: HermesAction): Promise<void> {
    if (!this.config.hermes.currentSceneUpdates.enabled) {
      return;
    }

    if (action.type === "update_group_current_scene") {
      await this.handleGroupCurrentSceneAction(notification, action);
      return;
    }

    await this.handleKinCurrentSceneAction(notification, action);
  }

  private async handleKinCurrentSceneAction(
    notification: KindroidChatNotification,
    action: UpdateCurrentSceneAction
  ): Promise<void> {
    if (notification.type !== "kindroid.chat.changed") {
      this.logger.debug(
        "Ignoring current scene action for non-direct Kindroid chat.",
        safeNotificationMeta(notification)
      );
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring Hermes current scene action for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    const currentScene = action.current_scene.trim();
    if (!currentScene) {
      return;
    }

    const maxLength = this.config.hermes.currentSceneUpdates.maxLength;
    this.logger.info("Hermes current scene action requested.", {
      aiId: notification.kinId,
      documentId: notification.documentId,
      currentSceneLength: currentScene.length,
      truncated: currentScene.length > maxLength,
      reason: action.reason
    });
    const result = await this.kindroidClient.updateCurrentScene({
      aiId: notification.kinId,
      currentScene: currentScene.slice(0, maxLength)
    });

    const meta = {
      aiId: notification.kinId,
      ok: result.ok,
      status: result.status,
      reason: action.reason,
      responseText: result.responseText
    };
    if (result.ok) {
      this.logger.info("Hermes current scene action completed.", meta);
    } else {
      this.logger.warn("Hermes current scene action failed.", meta);
    }
  }

  private async handleGroupCurrentSceneAction(
    notification: KindroidChatNotification,
    action: UpdateGroupCurrentSceneAction
  ): Promise<void> {
    if (notification.type !== "kindroid.group_chat.changed") {
      this.logger.debug(
        "Ignoring group current scene action for non-group Kindroid chat.",
        safeNotificationMeta(notification)
      );
      return;
    }

    const targetGroupId = action.group_id ?? notification.groupId;
    if (targetGroupId !== notification.groupId) {
      this.logger.warn("Ignoring Hermes group current scene action for mismatched group_id.", {
        expectedGroupId: notification.groupId,
        requestedGroupId: targetGroupId
      });
      return;
    }

    const currentScene = action.current_scene.trim();
    if (!currentScene) {
      return;
    }

    const maxLength = this.config.hermes.currentSceneUpdates.maxLength;
    this.logger.info("Hermes group current scene action requested.", {
      groupId: notification.groupId,
      documentId: notification.documentId,
      currentSceneLength: currentScene.length,
      truncated: currentScene.length > maxLength,
      reason: action.reason
    });
    const result = await this.kindroidClient.updateGroupCurrentScene({
      groupId: notification.groupId,
      currentScene: currentScene.slice(0, maxLength)
    });

    const meta = {
      groupId: notification.groupId,
      ok: result.ok,
      status: result.status,
      reason: action.reason,
      responseText: result.responseText
    };
    if (result.ok) {
      this.logger.info("Hermes group current scene action completed.", meta);
    } else {
      this.logger.warn("Hermes group current scene action failed.", meta);
    }
  }
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
