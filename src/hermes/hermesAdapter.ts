import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { type JournalSuggestion, type JournalSuggestionStore } from "../journal/journalSuggestionStore.js";
import type { JournalSuggestionContext } from "../journal/journalContext.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import {
  type HermesActionDecision,
  type HermesActionHandler,
  type KindroidSceneUpdater
} from "./currentSceneActionHandler.js";
import { createHermesActionRegistry } from "./actionRegistry.js";
import type { HermesAdapter } from "./types.js";

interface HermesChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export type { KindroidSceneUpdater } from "./currentSceneActionHandler.js";

export interface HermesChatAdapterOptions {
  journalSuggestions?: JournalSuggestionStore;
  onJournalSuggestionCreated?: (suggestion: JournalSuggestion) => void;
  journalContextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
  dedupeStore?: DedupeStore;
}

export class LoggingHermesAdapter implements HermesAdapter {
  constructor(private readonly logger: Logger) {}

  async handleChatChanged(notification: KindroidChatNotification): Promise<void> {
    this.logger.info("Hermes adapter received Kindroid chat change notification.", safeNotificationMeta(notification));
  }
}

export class HermesChatAdapter implements HermesAdapter {
  private readonly actionHandlers: Array<HermesActionHandler<unknown>>;
  private readonly journalContextProvider?: (
    notification: KindroidChatNotification
  ) => Promise<JournalSuggestionContext>;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly kindroidClient: KindroidSceneUpdater = new KindroidClient(config, logger),
    private readonly options: HermesChatAdapterOptions = {}
  ) {
    const registry = createHermesActionRegistry({
      config,
      logger,
      kindroidClient: this.kindroidClient,
      options
    });
    this.actionHandlers = registry.handlers;
    this.journalContextProvider = registry.journalContextProvider;
  }

  async handleChatChanged(notification: KindroidChatNotification): Promise<void> {
    this.logger.info("Forwarding Kindroid chat event to Hermes.", safeNotificationMeta(notification));

    if (!notification.text || (notification.textEncrypted && !notification.textDecrypted)) {
      this.logger.debug("Skipping Hermes event without readable chat text.", safeNotificationMeta(notification));
      return;
    }

    try {
      this.options.journalSuggestions?.recordReadableMessage(notification);
      const decision = await this.requestDecision(notification);
      const actions = this.normalizeActions(decision);
      this.logger.info("Hermes action decision received.", {
        ...safeNotificationMeta(notification),
        actionCount: actions.length,
        actionTypes: [...new Set(actions.map(({ action }) => actionType(action)))]
      });
      if (actions.length > 0) {
        this.logger.info("Hermes action decision hit.", {
          ...safeNotificationMeta(notification),
          actionCount: actions.length,
          actionTypes: [...new Set(actions.map(({ action }) => actionType(action)))]
        });
      }
      for (const { handler, action } of actions) {
        await handler.handle(notification, action);
      }
    } catch (error) {
      this.logger.warn("Hermes chat event handling failed.", {
        ...safeNotificationMeta(notification),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async requestDecision(notification: KindroidChatNotification): Promise<HermesActionDecision> {
    const journalContext = await this.journalContextProvider?.(notification);
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
            content: JSON.stringify(toHermesEvent(notification, journalContext))
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
    const toolLines = this.actionHandlers.flatMap((handler) => handler.promptLines());
    const toolState = toolLines.length > 0 ? toolLines.join("\n") : "No mutation actions are currently available.";

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

  private normalizeActions(
    decision: HermesActionDecision
  ): Array<{ handler: HermesActionHandler<unknown>; action: unknown }> {
    return this.actionHandlers.flatMap((handler) =>
      handler.normalizeActions(decision).map((action) => ({ handler, action }))
    );
  }
}

export function createHermesAdapter(
  config: AppConfig,
  logger: Logger,
  options: HermesChatAdapterOptions = {}
): HermesAdapter {
  if (!config.hermes.enabled) {
    return new LoggingHermesAdapter(logger);
  }

  if (!config.hermes.apiKey) {
    logger.warn("Hermes is enabled but HERMES_API_KEY/hermes.apiKey is missing; using logging adapter.");
    return new LoggingHermesAdapter(logger);
  }

  return new HermesChatAdapter(config, logger, undefined, options);
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

function toHermesEvent(notification: KindroidChatNotification, journalContext?: JournalSuggestionContext) {
  const context =
    journalContext && (journalContext.existingEntries.length > 0 || journalContext.fieldExcerpts.length > 0)
      ? {
          journalContext: {
            existingEntries: journalContext.existingEntries,
            fieldExcerpts: journalContext.fieldExcerpts
          }
        }
      : {};

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
      text: notification.text,
      ...context
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
    text: notification.text,
    ...context
  };
}

function actionType(action: unknown): string {
  return action && typeof action === "object" && "type" in action && typeof action.type === "string"
    ? action.type
    : "unknown";
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
