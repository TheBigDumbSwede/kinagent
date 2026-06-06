import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { LocalSceneState } from "../localScene/localSceneStore.js";
import type { HermesAdapter } from "../hermes/types.js";
import { type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { loadRecentKindroidChatHistoryWindow } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";
import {
  PrewarmStateStore,
  type PrewarmSourceKey,
  type PrewarmSourceState,
  type PrewarmTrigger
} from "./prewarmStateStore.js";

interface LocalScenePrewarmCoordinatorOptions {
  config: AppConfig;
  logger: Logger;
  hermes: HermesAdapter;
  prewarmState: PrewarmStateStore;
  onPrewarmStateChanged?: (state: PrewarmSourceState) => void;
}

const recentChatHistoryPageBudget = 2;
const catchupRetryDelayMs = process.env.NODE_ENV === "test" ? 1_000 : 45_000;

export class LocalScenePrewarmCoordinator {
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly readySources = new Set<string>();
  private readonly catchupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: LocalScenePrewarmCoordinatorOptions) {}

  markReady(state: LocalSceneState): void {
    if (state.scope === "kin" && state.kinId) {
      const key = `kin:${state.kinId}`;
      this.readySources.add(key);
      this.attempts.delete(key);
      this.options.prewarmState.markReady(
        "localScene",
        { scope: "kin", id: state.kinId },
        {
          documentId: state.sourceDocumentId,
          timestamp: state.sourceTimestamp
        }
      );
      return;
    }
    if (state.scope === "group" && state.groupId) {
      const key = `group:${state.groupId}`;
      this.readySources.add(key);
      this.attempts.delete(key);
      this.options.prewarmState.markReady(
        "localScene",
        { scope: "group", id: state.groupId },
        {
          documentId: state.sourceDocumentId,
          timestamp: state.sourceTimestamp
        }
      );
    }
  }

  async prewarmKin(
    kin: KindroidKin,
    reason: string,
    input: { trigger?: PrewarmTrigger; force?: boolean } = {}
  ): Promise<void> {
    const key = `kin:${kin.aiId}`;
    if (!this.begin(key, { scope: "kin", id: kin.aiId }, input)) {
      return;
    }

    try {
      const messages = await this.loadRecentKinMessages(kin.aiId, 18);
      if (!messages) {
        this.scheduleKinCatchup(kin);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
      const text = buildLocalScenePrewarmText({
        scope: "direct",
        displayName: kin.name,
        messages
      });
      if (!text) {
        this.options.logger.debug("Skipping local scene prewarm because no readable recent messages were found.", {
          scope: "kin",
          kinId: kin.aiId,
          reason
        });
        return;
      }

      this.options.logger.info("Starting Hermes local scene prewarm.", {
        scope: "kin",
        kinId: kin.aiId,
        kinName: kin.name,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmLocalScene?.({
        scope: "kin",
        kinId: kin.aiId,
        documentId:
          latestMessage?.documentId ?? input.trigger?.documentId ?? `local-scene-prewarm:${kin.aiId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        localSceneContext: {
          prewarm: true,
          sourceScope: "direct",
          sourceKinId: kin.aiId,
          mutation: "local-kinagent-only"
        }
      });
      this.options.prewarmState.markAttempt(
        "localScene",
        { scope: "kin", id: kin.aiId },
        latestMessage ?? input.trigger
      );
    } catch (error) {
      this.options.logger.warn("Hermes local scene prewarm setup failed.", {
        scope: "kin",
        kinId: kin.aiId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  async prewarmGroup(
    group: KindroidGroup,
    notification: KindroidChatNotification | null,
    reason: string,
    input: { trigger?: PrewarmTrigger; force?: boolean } = {}
  ): Promise<void> {
    if (notification && notification.type !== "kindroid.group_chat.changed") {
      return;
    }

    const key = `group:${group.groupId}`;
    if (!this.begin(key, { scope: "group", id: group.groupId }, input)) {
      return;
    }

    try {
      const messages = await this.loadRecentGroupMessages(group.groupId, 18);
      if (!messages) {
        this.scheduleGroupCatchup(group);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
      const latestSpeakerKinId = notification?.aiId || mostRecentKinId(messages);
      const text = buildLocalScenePrewarmText({
        scope: "group",
        displayName: group.name,
        messages
      });
      if (!text) {
        this.options.logger.debug(
          "Skipping group local scene prewarm because no readable recent messages were found.",
          {
            groupId: group.groupId,
            reason
          }
        );
        return;
      }

      this.options.logger.info("Starting Hermes group local scene prewarm.", {
        groupId: group.groupId,
        groupName: group.name,
        latestSpeakerKinId,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmLocalScene?.({
        scope: "group",
        groupId: group.groupId,
        aiId: latestSpeakerKinId,
        documentId:
          latestMessage?.documentId ??
          input.trigger?.documentId ??
          `local-scene-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        localSceneContext: {
          prewarm: true,
          sourceScope: "group",
          latestSpeakerKinId,
          groupId: group.groupId,
          mutation: "local-kinagent-only"
        }
      });
      this.options.prewarmState.markAttempt(
        "localScene",
        { scope: "group", id: group.groupId },
        latestMessage ?? input.trigger
      );
    } catch (error) {
      this.options.logger.warn("Hermes group local scene prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  private begin(
    key: string,
    source: { scope: "kin" | "group"; id: string },
    input: { trigger?: PrewarmTrigger; force?: boolean }
  ): boolean {
    if (!this.options.config.hermes.enabled || !this.options.config.hermes.apiKey) {
      return false;
    }

    if (this.inFlight.has(key)) {
      return false;
    }

    if (!this.options.prewarmState.shouldPrewarm("localScene", source, input)) {
      return false;
    }

    const attempts = this.attempts.get(key) ?? 0;
    if (!input.force && attempts >= 2) {
      return false;
    }

    this.attempts.set(key, attempts + 1);
    this.inFlight.add(key);
    return true;
  }

  private async loadRecentKinMessages(kinId: string, limit: number): Promise<NormalizedKindroidMessage[] | null> {
    return this.loadRecentMessages({ scope: "kin", id: kinId }, limit);
  }

  private async loadRecentGroupMessages(groupId: string, limit: number): Promise<NormalizedKindroidMessage[] | null> {
    return this.loadRecentMessages({ scope: "group", id: groupId }, limit);
  }

  private async loadRecentMessages(
    source: PrewarmSourceKey,
    limit: number
  ): Promise<NormalizedKindroidMessage[] | null> {
    const result = await loadRecentKindroidChatHistoryWindow(this.options.config, this.options.logger, {
      ...source,
      limit,
      maxPages: recentChatHistoryPageBudget,
      startAfterTimestamp: this.options.prewarmState.chatHistoryStartAfter(source)
    });
    if (!result.complete) {
      if (typeof result.nextStartAfterTimestamp === "number") {
        const state = this.options.prewarmState.markChatHistoryCursor(source, result.nextStartAfterTimestamp);
        this.options.onPrewarmStateChanged?.(state);
      }
      this.options.logger.info("Deferred local scene prewarm while recent chat history catches up.", {
        scope: source.scope,
        id: source.id,
        pageCount: result.pageCount,
        nextStartAfterTimestamp: result.nextStartAfterTimestamp,
        status: result.status
      });
      return null;
    }

    const state = this.options.prewarmState.clearChatHistoryCursor(source);
    this.options.onPrewarmStateChanged?.(state);
    return sortChronological(result.messages.filter((message) => isReadablePrewarmMessage(message)));
  }

  private scheduleKinCatchup(kin: KindroidKin): void {
    this.scheduleCatchup(`kin:${kin.aiId}`, () => this.prewarmKin(kin, "chat-history-catchup", { force: true }));
  }

  private scheduleGroupCatchup(group: KindroidGroup): void {
    this.scheduleCatchup(`group:${group.groupId}`, () =>
      this.prewarmGroup(group, null, "chat-history-catchup", { force: true })
    );
  }

  private scheduleCatchup(key: string, run: () => Promise<void>): void {
    if (this.catchupTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this.catchupTimers.delete(key);
      void run();
    }, catchupRetryDelayMs);
    unrefTimer(timer);
    this.catchupTimers.set(key, timer);
  }
}

export function buildLocalScenePrewarmText(input: {
  scope: "direct" | "group";
  displayName: string;
  messages: NormalizedKindroidMessage[];
}): string | null {
  const readableMessages = input.messages.filter((message) => isReadablePrewarmMessage(message)).slice(-14);
  if (readableMessages.length === 0) {
    return null;
  }

  return [
    "LOCAL_SCENE_PREWARM_REQUEST",
    `Build initial local scene metadata for this ${input.scope} chat before waiting for a future scene-change turn.`,
    `Source: ${input.displayName}.`,
    "Infer the current location, time of day if known, mood, activity, privacy, tension, soundscape hints, visual palette hints, and concise evidence from recent context.",
    "Return update_local_scene_state or update_group_local_scene_state when a grounded local scene can be inferred. Return no non-local-scene actions.",
    "This is local Kinagent backstage metadata only. Do not write Kindroid memory, current_scene, journals, chat text, or user replies.",
    "Recent messages, oldest to newest:",
    ...readableMessages.map((message) => `${prewarmMessagePrefix(message)} ${truncatePrewarmText(message.text ?? "")}`)
  ].join("\n");
}

function prewarmMessagePrefix(message: NormalizedKindroidMessage): string {
  const timestamp = message.timestamp ? message.timestamp : "unknown-time";
  const speaker = message.sender || message.role || message.kinId || "unknown";
  return `[${timestamp}] ${speaker}:`;
}

function truncatePrewarmText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 357)}...` : normalized;
}

function sortChronological(messages: NormalizedKindroidMessage[]): NormalizedKindroidMessage[] {
  return [...messages].sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
}

function timestampMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isReadablePrewarmMessage(message: NormalizedKindroidMessage): boolean {
  return Boolean(message.text?.trim()) && !(message.textEncrypted && !message.textDecrypted);
}

function mostRecentKinId(messages: NormalizedKindroidMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.kinId) {
      return message.kinId;
    }
  }
  return null;
}

function mostRecentMessage(messages: NormalizedKindroidMessage[]): PrewarmTrigger | undefined {
  const message = messages[messages.length - 1];
  return message ? { documentId: message.id, timestamp: message.timestamp } : undefined;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
