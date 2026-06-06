import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import {
  type ChatDynamismSuggestion,
  type ChatDynamismSuggestionStore
} from "../chatDynamism/chatDynamismSuggestionStore.js";
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
import type { AmbientContextPreference, AmbientContextSentEvent } from "./ambientContextActionHandler.js";
import type { ScopedSoundscapeUpdate, SoundscapePreference } from "./soundscapeActionHandler.js";
import type { HermesAdapter, HermesSoundscapePrewarmRequest } from "./types.js";

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
  chatDynamismSuggestions?: ChatDynamismSuggestionStore;
  onChatDynamismSuggestionCreated?: (suggestion: ChatDynamismSuggestion) => void;
  isChatDynamismEnabled?: (aiId: string) => boolean;
  chatDynamismRange?: (aiId: string) => { min: number; max: number };
  chatDynamismContextProvider?: (notification: KindroidChatNotification) => Promise<unknown>;
  soundscapeContextProvider?: (notification: KindroidChatNotification) => Promise<unknown>;
  journalContextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
  dedupeStore?: DedupeStore;
  onAmbientContextSent?: (event: AmbientContextSentEvent) => void;
  isAmbientContextEnabled?: AmbientContextPreference;
  onSoundscapeUpdated?: (update: ScopedSoundscapeUpdate) => void;
  isSoundscapeEnabled?: SoundscapePreference;
}

export class LoggingHermesAdapter implements HermesAdapter {
  constructor(private readonly logger: Logger) {}

  async handleChatChanged(notification: KindroidChatNotification): Promise<void> {
    this.logger.info("Hermes adapter received Kindroid chat change notification.", safeNotificationMeta(notification));
  }

  async prewarmSoundscape(request: HermesSoundscapePrewarmRequest): Promise<void> {
    this.logger.info("Hermes soundscape prewarm skipped because Hermes chat adapter is not active.", {
      scope: request.scope,
      kinId: "kinId" in request ? request.kinId : undefined,
      groupId: "groupId" in request ? request.groupId : undefined,
      documentId: request.documentId
    });
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

  async prewarmSoundscape(request: HermesSoundscapePrewarmRequest): Promise<void> {
    const notification = toPrewarmNotification(request);
    this.logger.info("Forwarding soundscape prewarm request to Hermes.", safeNotificationMeta(notification));

    try {
      const decision = await this.requestDecision(notification, {
        soundscapeContext: request.soundscapeContext
      });
      const actions = this.normalizeActions(decision).filter(({ action }) => isSoundscapeAction(action));
      this.logger.info("Hermes soundscape prewarm decision received.", {
        ...safeNotificationMeta(notification),
        actionCount: actions.length,
        actionTypes: [...new Set(actions.map(({ action }) => actionType(action)))]
      });
      for (const { handler, action } of actions) {
        await handler.handle(notification, action);
      }
    } catch (error) {
      this.logger.warn("Hermes soundscape prewarm failed.", {
        ...safeNotificationMeta(notification),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async requestDecision(
    notification: KindroidChatNotification,
    overrides: {
      journalContext?: JournalSuggestionContext;
      chatDynamismContext?: unknown;
      soundscapeContext?: unknown;
    } = {}
  ): Promise<HermesActionDecision> {
    const journalContext = overrides.journalContext ?? (await this.journalContextProvider?.(notification));
    const chatDynamismContext =
      overrides.chatDynamismContext ?? (await this.options.chatDynamismContextProvider?.(notification));
    const soundscapeContext =
      overrides.soundscapeContext ?? (await this.options.soundscapeContextProvider?.(notification));
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
            content: JSON.stringify(toHermesEvent(notification, journalContext, chatDynamismContext, soundscapeContext))
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
      "Use soundscape actions only for local ambience changes, not as a substitute for current_scene, memory, journal, or chat text.",
      "Use soundscape actions only when soundscapeContext.enabledForSource is true.",
      "For group soundscapes, enabledForSource refers to the group preference, not ownership by the most recent speaker Kin.",
      "For kindroid.soundscape.prewarm events, return a conservative soundscape action when recent context gives enough venue, weather, machinery, room tone, crowd, vehicle, or tension clues. Do not return non-soundscape actions for prewarm events.",
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

function toPrewarmNotification(request: HermesSoundscapePrewarmRequest): KindroidChatNotification {
  if (request.scope === "group") {
    return {
      type: "kindroid.group_chat.changed",
      groupId: request.groupId,
      aiId: request.aiId ?? null,
      documentId: request.documentId,
      timestamp: request.timestamp,
      text: request.text,
      textEncrypted: false,
      textDecrypted: true,
      sender: "system",
      role: "soundscape-prewarm",
      source: "soundscape-prewarm"
    };
  }

  return {
    type: "kindroid.chat.changed",
    kinId: request.kinId,
    documentId: request.documentId,
    timestamp: request.timestamp,
    text: request.text,
    textEncrypted: false,
    textDecrypted: true,
    sender: "system",
    role: "soundscape-prewarm",
    source: "soundscape-prewarm"
  };
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

function toHermesEvent(
  notification: KindroidChatNotification,
  journalContext?: JournalSuggestionContext,
  chatDynamismContext?: unknown,
  soundscapeContext?: unknown
) {
  const context =
    journalContext && (journalContext.existingEntries.length > 0 || journalContext.fieldExcerpts.length > 0)
      ? {
          journalContext: {
            existingEntries: journalContext.existingEntries,
            fieldExcerpts: journalContext.fieldExcerpts
          }
        }
      : {};
  const chatDynamism = chatDynamismContext ? { chatDynamismContext } : {};
  const soundscape = soundscapeContext ? { soundscapeContext } : {};

  if (notification.type === "kindroid.chat.changed") {
    return {
      agentId: "kindroid",
      type: notification.source === "soundscape-prewarm" ? "kindroid.soundscape.prewarm" : "kindroid.chat.message",
      chatKind: "direct",
      aiId: notification.kinId,
      documentId: notification.documentId,
      timestamp: notification.timestamp,
      sender: notification.sender,
      role: notification.role,
      text: notification.text,
      ...context,
      ...chatDynamism,
      ...soundscape
    };
  }

  return {
    agentId: "kindroid",
    type: notification.source === "soundscape-prewarm" ? "kindroid.soundscape.prewarm" : "kindroid.group_chat.message",
    chatKind: "group",
    groupId: notification.groupId,
    aiId: notification.aiId,
    documentId: notification.documentId,
    timestamp: notification.timestamp,
    sender: notification.sender,
    role: notification.role,
    text: notification.text,
    ...context,
    ...chatDynamism,
    ...soundscape
  };
}

function actionType(action: unknown): string {
  return action && typeof action === "object" && "type" in action && typeof action.type === "string"
    ? action.type
    : "unknown";
}

function isSoundscapeAction(action: unknown): boolean {
  const type = actionType(action);
  return type === "update_soundscape" || type === "update_group_soundscape";
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
