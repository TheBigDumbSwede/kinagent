import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { HermesAdapter } from "../hermes/types.js";
import type { KindroidGroup, KindroidKin } from "../kindroid/client/index.js";
import { loadRecentKindroidChatHistoryWindow } from "../kindroid/chatHistory.js";
import type { PreviouslyOnBrief } from "../previouslyOn/previouslyOnStore.js";
import type { Logger } from "../util/logger.js";
import {
  PrewarmStateStore,
  type PrewarmSourceKey,
  type PrewarmSourceState,
  type PrewarmTrigger
} from "./prewarmStateStore.js";

interface PreviouslyOnPrewarmCoordinatorOptions {
  config: AppConfig;
  logger: Logger;
  hermes: HermesAdapter;
  prewarmState: PrewarmStateStore;
  onPrewarmStateChanged?: (state: PrewarmSourceState) => void;
}

const recentChatHistoryPageBudget = 2;
const catchupRetryDelayMs = process.env.NODE_ENV === "test" ? 1_000 : 45_000;

export class PreviouslyOnPrewarmCoordinator {
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly readySources = new Set<string>();
  private readonly catchupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: PreviouslyOnPrewarmCoordinatorOptions) {}

  resumeKinCatchup(kin: KindroidKin): void {
    this.scheduleKinCatchup(kin);
  }

  resumeGroupCatchup(group: KindroidGroup): void {
    this.scheduleGroupCatchup(group);
  }

  markReady(brief: PreviouslyOnBrief): void {
    if (brief.scope === "kin" && brief.kinId) {
      const key = `kin:${brief.kinId}`;
      this.readySources.add(key);
      this.attempts.delete(key);
      this.options.prewarmState.markReady(
        "previouslyOn",
        { scope: "kin", id: brief.kinId },
        {
          documentId: brief.sourceDocumentId,
          timestamp: brief.sourceTimestamp
        }
      );
      return;
    }
    if (brief.scope === "group" && brief.groupId) {
      const key = `group:${brief.groupId}`;
      this.readySources.add(key);
      this.attempts.delete(key);
      this.options.prewarmState.markReady(
        "previouslyOn",
        { scope: "group", id: brief.groupId },
        {
          documentId: brief.sourceDocumentId,
          timestamp: brief.sourceTimestamp
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
      const messages = await this.loadRecentKinMessages(kin.aiId, 24);
      if (!messages) {
        this.scheduleKinCatchup(kin);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
      const text = buildPreviouslyOnPrewarmText({
        scope: "direct",
        displayName: kin.name,
        messages
      });
      if (!text) {
        this.options.logger.debug("Skipping Previously On prewarm because no readable recent messages were found.", {
          scope: "kin",
          kinId: kin.aiId,
          reason
        });
        return;
      }

      this.options.logger.info("Starting Hermes Previously On prewarm.", {
        scope: "kin",
        kinId: kin.aiId,
        kinName: kin.name,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmPreviouslyOn?.({
        scope: "kin",
        kinId: kin.aiId,
        documentId:
          latestMessage?.documentId ?? input.trigger?.documentId ?? `previously-on-prewarm:${kin.aiId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        previouslyOnContext: {
          prewarm: true,
          sourceScope: "direct",
          sourceKinId: kin.aiId,
          mutation: "local-kinagent-only"
        }
      });
      this.options.prewarmState.markAttempt(
        "previouslyOn",
        { scope: "kin", id: kin.aiId },
        latestMessage ?? input.trigger
      );
    } catch (error) {
      this.options.logger.warn("Hermes Previously On prewarm setup failed.", {
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
      const messages = await this.loadRecentGroupMessages(group.groupId, 24);
      if (!messages) {
        this.scheduleGroupCatchup(group);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
      const latestSpeakerKinId = notification?.aiId || mostRecentKinId(messages);
      const text = buildPreviouslyOnPrewarmText({
        scope: "group",
        displayName: group.name,
        messages
      });
      if (!text) {
        this.options.logger.debug(
          "Skipping group Previously On prewarm because no readable recent messages were found.",
          {
            groupId: group.groupId,
            reason
          }
        );
        return;
      }

      this.options.logger.info("Starting Hermes group Previously On prewarm.", {
        groupId: group.groupId,
        groupName: group.name,
        latestSpeakerKinId,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmPreviouslyOn?.({
        scope: "group",
        groupId: group.groupId,
        aiId: latestSpeakerKinId,
        documentId:
          latestMessage?.documentId ??
          input.trigger?.documentId ??
          `previously-on-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        previouslyOnContext: {
          prewarm: true,
          sourceScope: "group",
          latestSpeakerKinId,
          groupId: group.groupId,
          mutation: "local-kinagent-only"
        }
      });
      this.options.prewarmState.markAttempt(
        "previouslyOn",
        { scope: "group", id: group.groupId },
        latestMessage ?? input.trigger
      );
    } catch (error) {
      this.options.logger.warn("Hermes group Previously On prewarm setup failed.", {
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

    if (!this.options.prewarmState.shouldPrewarm("previouslyOn", source, input)) {
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
      this.options.logger.info("Deferred Previously On prewarm while recent chat history catches up.", {
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

export function buildPreviouslyOnPrewarmText(input: {
  scope: "direct" | "group";
  displayName: string;
  messages: NormalizedKindroidMessage[];
}): string | null {
  const readableMessages = input.messages.filter((message) => isReadablePrewarmMessage(message)).slice(-18);
  if (readableMessages.length === 0) {
    return null;
  }

  return [
    "PREVIOUSLY_ON_PREWARM_REQUEST",
    `Build a short local continuity brief for this ${input.scope} chat before the user continues.`,
    `Source: ${input.displayName}.`,
    "Separate known facts from inferred tone. Use facts only for events directly supported by recent messages.",
    "Keep it practical: 2-5 fact bullets, optional unresolved threads, one inferred tone line, and one suggested opening frame.",
    "Return update_previously_on_brief or update_group_previously_on_brief when recent context supports a useful recap. Return no non-Previously-On actions.",
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
