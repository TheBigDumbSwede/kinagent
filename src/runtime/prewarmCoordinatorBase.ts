import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { KindroidGroup, KindroidKin } from "../kindroid/client/index.js";
import { loadRecentKindroidChatHistoryWindow } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";
import {
  PrewarmStateStore,
  prewarmSourceKey,
  type PrewarmKind,
  type PrewarmSourceKey,
  type PrewarmSourceState,
  type PrewarmTrigger
} from "./prewarmStateStore.js";

export type { PrewarmTrigger } from "./prewarmStateStore.js";

export interface PrewarmCoordinatorBaseOptions {
  config: AppConfig;
  logger: Logger;
  prewarmState: PrewarmStateStore;
  onPrewarmStateChanged?: (state: PrewarmSourceState) => void;
}

interface PrewarmCoordinatorBaseSettings {
  kind: PrewarmKind;
  deferLabel: string;
  isRuntimeEnabled?: () => boolean;
}

const recentChatHistoryPageBudget = 2;
const catchupRetryDelayMs = process.env.NODE_ENV === "test" ? 1_000 : 45_000;

export abstract class PrewarmCoordinatorBase {
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly readySources = new Set<string>();
  private readonly catchupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  protected constructor(
    protected readonly baseOptions: PrewarmCoordinatorBaseOptions,
    private readonly settings: PrewarmCoordinatorBaseSettings
  ) {}

  abstract prewarmKin(
    kin: KindroidKin,
    reason: string,
    input?: { trigger?: PrewarmTrigger; force?: boolean }
  ): Promise<void>;

  abstract prewarmGroup(
    group: KindroidGroup,
    notification: KindroidChatNotification | null,
    reason: string,
    input?: { trigger?: PrewarmTrigger; force?: boolean }
  ): Promise<void>;

  resumeKinCatchup(kin: KindroidKin): void {
    this.scheduleKinCatchup(kin);
  }

  resumeGroupCatchup(group: KindroidGroup): void {
    this.scheduleGroupCatchup(group);
  }

  protected markReadySource(source: PrewarmSourceKey, trigger?: PrewarmTrigger): void {
    const key = prewarmSourceKey(source);
    this.readySources.add(key);
    this.attempts.delete(key);
    this.baseOptions.prewarmState.markReady(this.settings.kind, source, trigger);
  }

  protected begin(
    source: PrewarmSourceKey,
    input: { trigger?: PrewarmTrigger; force?: boolean },
    enabled = true
  ): boolean {
    if (!enabled || this.settings.isRuntimeEnabled?.() === false) {
      return false;
    }

    const key = prewarmSourceKey(source);
    if (this.inFlight.has(key)) {
      return false;
    }

    if (!this.baseOptions.prewarmState.shouldPrewarm(this.settings.kind, source, input)) {
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

  protected finish(source: PrewarmSourceKey): void {
    this.inFlight.delete(prewarmSourceKey(source));
  }

  protected clearRuntimeState(source: PrewarmSourceKey): void {
    const key = prewarmSourceKey(source);
    this.inFlight.delete(key);
    this.readySources.delete(key);
    this.attempts.delete(key);
  }

  protected resetAttempts(source: PrewarmSourceKey): void {
    this.attempts.delete(prewarmSourceKey(source));
  }

  protected markAttempt(source: PrewarmSourceKey, trigger?: PrewarmTrigger): void {
    this.baseOptions.prewarmState.markAttempt(this.settings.kind, source, trigger);
  }

  protected async loadRecentMessages(
    source: PrewarmSourceKey,
    limit: number
  ): Promise<NormalizedKindroidMessage[] | null> {
    const result = await loadRecentKindroidChatHistoryWindow(this.baseOptions.config, this.baseOptions.logger, {
      ...source,
      limit,
      maxPages: recentChatHistoryPageBudget,
      startAfterTimestamp: this.baseOptions.prewarmState.chatHistoryStartAfter(this.settings.kind, source)
    });
    if (!result.complete) {
      if (typeof result.nextStartAfterTimestamp === "number") {
        const state = this.baseOptions.prewarmState.markChatHistoryCursor(
          this.settings.kind,
          source,
          result.nextStartAfterTimestamp
        );
        this.baseOptions.onPrewarmStateChanged?.(state);
      }
      this.baseOptions.logger.info(
        `Deferred ${this.settings.deferLabel} prewarm while recent chat history catches up.`,
        {
          scope: source.scope,
          id: source.id,
          pageCount: result.pageCount,
          nextStartAfterTimestamp: result.nextStartAfterTimestamp,
          status: result.status
        }
      );
      return null;
    }

    const state = this.baseOptions.prewarmState.clearChatHistoryCursor(this.settings.kind, source);
    this.baseOptions.onPrewarmStateChanged?.(state);
    return sortChronological(result.messages.filter((message) => isReadablePrewarmMessage(message)));
  }

  protected scheduleKinCatchup(kin: KindroidKin): void {
    this.scheduleCatchup({ scope: "kin", id: kin.aiId }, () =>
      this.prewarmKin(kin, "chat-history-catchup", { force: true })
    );
  }

  protected scheduleGroupCatchup(group: KindroidGroup): void {
    this.scheduleCatchup({ scope: "group", id: group.groupId }, () =>
      this.prewarmGroup(group, null, "chat-history-catchup", { force: true })
    );
  }

  private scheduleCatchup(source: PrewarmSourceKey, run: () => Promise<void>): void {
    const key = prewarmSourceKey(source);
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

export function isReadablePrewarmMessage(message: NormalizedKindroidMessage): boolean {
  return Boolean(message.text?.trim()) && !(message.textEncrypted && !message.textDecrypted);
}

export function mostRecentKinId(messages: NormalizedKindroidMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.kinId) {
      return message.kinId;
    }
  }
  return null;
}

export function mostRecentMessage(messages: NormalizedKindroidMessage[]): PrewarmTrigger | undefined {
  const message = messages[messages.length - 1];
  return message ? { documentId: message.id, timestamp: message.timestamp } : undefined;
}

export function prewarmMessagePrefix(message: NormalizedKindroidMessage): string {
  const timestamp = message.timestamp ? message.timestamp : "unknown-time";
  const speaker = message.sender || message.role || message.kinId || "unknown";
  return `[${timestamp}] ${speaker}:`;
}

export function truncatePrewarmText(value: string): string {
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

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
