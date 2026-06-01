import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { UpdateKindroidCurrentSceneResult, UpdateKindroidGroupCurrentSceneResult } from "../kindroid/types.js";
import type { Logger } from "../util/logger.js";
import type { HermesAdapter } from "./types.js";

interface HermesChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface HermesActionDecision {
  actions?: unknown;
}

interface UpdateCurrentSceneAction {
  type: "update_current_scene";
  ai_id?: string;
  current_scene: string;
  reason?: string;
}

interface UpdateGroupCurrentSceneAction {
  type: "update_group_current_scene";
  group_id?: string;
  current_scene: string;
  reason?: string;
}

export interface KindroidSceneUpdater {
  updateCurrentScene(input: { aiId: string; currentScene: string }): Promise<UpdateKindroidCurrentSceneResult>;
  updateGroupCurrentScene(input: {
    groupId: string;
    currentScene: string;
  }): Promise<UpdateKindroidGroupCurrentSceneResult>;
}

export class LoggingHermesAdapter implements HermesAdapter {
  constructor(private readonly logger: Logger) {}

  async handleChatChanged(notification: KindroidChatNotification): Promise<void> {
    this.logger.info("Hermes adapter received Kindroid chat change notification.", safeNotificationMeta(notification));
  }
}

export class HermesChatAdapter implements HermesAdapter {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly kindroidClient: KindroidSceneUpdater = new KindroidClient(config, logger)
  ) {}

  async handleChatChanged(notification: KindroidChatNotification): Promise<void> {
    this.logger.info("Forwarding Kindroid chat event to Hermes.", safeNotificationMeta(notification));

    if (!notification.text || (notification.textEncrypted && !notification.textDecrypted)) {
      this.logger.debug("Skipping Hermes event without readable chat text.", safeNotificationMeta(notification));
      return;
    }

    try {
      const decision = await this.requestDecision(notification);
      const actions = normalizeActions(decision);
      this.logger.info("Hermes action decision received.", {
        ...safeNotificationMeta(notification),
        actionCount: actions.length,
        actionTypes: [...new Set(actions.map((action) => action.type))]
      });
      if (actions.length > 0) {
        this.logger.info("Hermes action decision hit.", {
          ...safeNotificationMeta(notification),
          actionCount: actions.length,
          actionTypes: [...new Set(actions.map((action) => action.type))]
        });
      }
      for (const action of actions) {
        await this.handleAction(notification, action);
      }
    } catch (error) {
      this.logger.warn("Hermes chat event handling failed.", {
        ...safeNotificationMeta(notification),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async requestDecision(notification: KindroidChatNotification): Promise<HermesActionDecision> {
    const response = await fetch(`${normalizeBaseUrl(this.config.hermes.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.hermes.apiKey}`
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [
          {
            role: "system",
            content: this.systemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify(toHermesEvent(notification))
          }
        ]
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Hermes chat request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const result = JSON.parse(responseText) as HermesChatCompletionResult;
    const content = result.choices?.[0]?.message?.content ?? "";
    return parseDecision(content);
  }

  private systemPrompt(): string {
    const toolState = this.config.hermes.currentSceneUpdates.enabled
      ? [
          `For direct Kin chats, you may request: {"type":"update_current_scene","ai_id":"<same direct chat ai_id>","current_scene":"<brief current situation>","reason":"<short reason>"}.`,
          `For group chats, you may request: {"type":"update_group_current_scene","group_id":"<same group_id>","current_scene":"<brief current situation>","reason":"<short reason>"}.`
        ].join("\n")
      : "No mutation actions are currently available.";

    return [
      "You are Hermes, evaluating Kindroid chat events for useful state updates.",
      'Return only compact JSON with this shape: {"actions":[]}.',
      toolState,
      "Use current scene actions only when the current location, activity, scene, or situation materially changes.",
      "Do not update the scene for routine conversation, greetings, emotional tone, preferences, memories, or speculation.",
      `Keep current_scene under ${this.config.hermes.currentSceneUpdates.maxLength} characters.`,
      'Never invent a different ai_id or group_id. If unsure, return {"actions":[]}.'
    ].join("\n");
  }

  private async handleAction(
    notification: KindroidChatNotification,
    action: UpdateCurrentSceneAction | UpdateGroupCurrentSceneAction
  ): Promise<void> {
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

export function createHermesAdapter(config: AppConfig, logger: Logger): HermesAdapter {
  if (!config.hermes.enabled) {
    return new LoggingHermesAdapter(logger);
  }

  if (!config.hermes.apiKey) {
    logger.warn("Hermes is enabled but HERMES_API_KEY/hermes.apiKey is missing; using logging adapter.");
    return new LoggingHermesAdapter(logger);
  }

  return new HermesChatAdapter(config, logger);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseDecision(content: string): HermesActionDecision {
  const jsonText = extractJsonObject(content.trim());
  if (!jsonText) {
    return { actions: [] };
  }

  try {
    const parsed = JSON.parse(jsonText) as HermesActionDecision;
    return parsed && typeof parsed === "object" ? parsed : { actions: [] };
  } catch {
    return { actions: [] };
  }
}

function extractJsonObject(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}

function normalizeActions(
  decision: HermesActionDecision
): Array<UpdateCurrentSceneAction | UpdateGroupCurrentSceneAction> {
  if (!Array.isArray(decision.actions)) {
    return [];
  }

  return decision.actions.flatMap((action): Array<UpdateCurrentSceneAction | UpdateGroupCurrentSceneAction> => {
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

function toHermesEvent(notification: KindroidChatNotification) {
  if (notification.type === "kindroid.chat.changed") {
    return {
      agentId: "kindroid",
      type: "kindroid.chat.message",
      chatKind: "direct",
      aiId: notification.kinId,
      documentId: notification.documentId,
      timestamp: notification.timestamp,
      sender: notification.sender,
      role: notification.role,
      text: notification.text
    };
  }

  return {
    agentId: "kindroid",
    type: "kindroid.group_chat.message",
    chatKind: "group",
    groupId: notification.groupId,
    aiId: notification.aiId,
    documentId: notification.documentId,
    timestamp: notification.timestamp,
    sender: notification.sender,
    role: notification.role,
    text: notification.text
  };
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
