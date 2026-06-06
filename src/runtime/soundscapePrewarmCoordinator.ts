import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { ScopedSoundscapeUpdate } from "../hermes/soundscapeActionHandler.js";
import type { HermesAdapter } from "../hermes/types.js";
import { type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { loadRecentKindroidChatHistoryMessages } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";

interface SoundscapePrewarmCoordinatorOptions {
  config: AppConfig;
  logger: Logger;
  hermes: HermesAdapter;
  isKinSoundscapeEnabled: (kinId: string) => boolean;
  isKnownKin: (kinId: string) => boolean;
}

export class SoundscapePrewarmCoordinator {
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly readySources = new Set<string>();

  constructor(private readonly options: SoundscapePrewarmCoordinatorOptions) {}

  onKinPreferenceChanged(kin: KindroidKin | null, enabled: boolean): void {
    if (!kin) {
      return;
    }

    const key = `kin:${kin.aiId}`;
    this.attempts.delete(key);
    if (!enabled) {
      this.inFlight.delete(key);
      this.readySources.delete(key);
      return;
    }

    void this.prewarmKin(kin, "preference-enabled");
  }

  markReady(update: ScopedSoundscapeUpdate): void {
    if (update.scope === "kin" && update.kinId) {
      this.readySources.add(`kin:${update.kinId}`);
      return;
    }
    if (update.scope === "group" && update.groupId) {
      this.readySources.add(`group:${update.groupId}`);
    }
  }

  isEnabled(notification: KindroidChatNotification): boolean {
    const sourceKinId = this.sourceKinId(notification);
    return sourceKinId ? this.options.isKinSoundscapeEnabled(sourceKinId) : false;
  }

  context(notification: KindroidChatNotification): unknown {
    const sourceKinId = this.sourceKinId(notification);
    return {
      enabledForSource: Boolean(sourceKinId && this.options.isKinSoundscapeEnabled(sourceKinId)),
      sourceScope: notification.type === "kindroid.chat.changed" ? "direct" : "group",
      sourceKinId,
      groupId: notification.type === "kindroid.group_chat.changed" ? notification.groupId : undefined,
      mutation: "local-renderer-only"
    };
  }

  async prewarmKin(kin: KindroidKin, reason: string): Promise<void> {
    const key = `kin:${kin.aiId}`;
    if (!this.begin(key, this.options.isKinSoundscapeEnabled(kin.aiId))) {
      return;
    }

    try {
      const messages = await this.loadRecentKinMessages(kin.aiId, 18);
      const text = buildSoundscapePrewarmText({
        scope: "direct",
        displayName: kin.name,
        messages
      });
      if (!text) {
        this.options.logger.debug("Skipping soundscape prewarm because no readable recent messages were found.", {
          scope: "kin",
          kinId: kin.aiId,
          reason
        });
        return;
      }

      this.options.logger.info("Starting Hermes soundscape prewarm.", {
        scope: "kin",
        kinId: kin.aiId,
        kinName: kin.name,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmSoundscape?.({
        scope: "kin",
        kinId: kin.aiId,
        documentId: `soundscape-prewarm:${kin.aiId}:${Date.now()}`,
        timestamp: new Date().toISOString(),
        text,
        soundscapeContext: {
          enabledForSource: true,
          prewarm: true,
          sourceScope: "direct",
          sourceKinId: kin.aiId,
          mutation: "local-renderer-only"
        }
      });
    } catch (error) {
      this.options.logger.warn("Hermes soundscape prewarm setup failed.", {
        scope: "kin",
        kinId: kin.aiId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  async prewarmGroup(group: KindroidGroup, notification: KindroidChatNotification, reason: string): Promise<void> {
    if (notification.type !== "kindroid.group_chat.changed") {
      return;
    }

    const key = `group:${group.groupId}`;
    if (!this.begin(key, true)) {
      return;
    }

    try {
      const messages = await this.loadRecentGroupMessages(group.groupId, 18);
      const sourceKinId = mostRecentSoundscapeEnabledKinId(messages, this.options.isKinSoundscapeEnabled);
      if (!sourceKinId) {
        this.options.logger.debug(
          "Skipping group soundscape prewarm because no recent source Kin has soundscape enabled.",
          {
            groupId: group.groupId,
            reason
          }
        );
        return;
      }

      const text = buildSoundscapePrewarmText({
        scope: "group",
        displayName: group.name,
        messages
      });
      if (!text) {
        this.options.logger.debug("Skipping group soundscape prewarm because no readable recent messages were found.", {
          groupId: group.groupId,
          reason
        });
        return;
      }

      this.options.logger.info("Starting Hermes group soundscape prewarm.", {
        groupId: group.groupId,
        groupName: group.name,
        sourceKinId,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmSoundscape?.({
        scope: "group",
        groupId: group.groupId,
        aiId: sourceKinId,
        documentId: `soundscape-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: new Date().toISOString(),
        text,
        soundscapeContext: {
          enabledForSource: true,
          prewarm: true,
          sourceScope: "group",
          sourceKinId,
          groupId: group.groupId,
          mutation: "local-renderer-only"
        }
      });
    } catch (error) {
      this.options.logger.warn("Hermes group soundscape prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  private begin(key: string, enabled: boolean): boolean {
    if (!enabled || this.readySources.has(key) || this.inFlight.has(key)) {
      return false;
    }

    const attempts = this.attempts.get(key) ?? 0;
    if (attempts >= 2) {
      return false;
    }

    this.attempts.set(key, attempts + 1);
    this.inFlight.add(key);
    return true;
  }

  private async loadRecentKinMessages(kinId: string, limit: number): Promise<NormalizedKindroidMessage[]> {
    const messages = await loadRecentKindroidChatHistoryMessages(this.options.config, this.options.logger, {
      scope: "kin",
      id: kinId,
      limit
    });
    return sortChronological(messages.filter((message) => isReadablePrewarmMessage(message)));
  }

  private async loadRecentGroupMessages(groupId: string, limit: number): Promise<NormalizedKindroidMessage[]> {
    const messages = await loadRecentKindroidChatHistoryMessages(this.options.config, this.options.logger, {
      scope: "group",
      id: groupId,
      limit
    });
    return sortChronological(messages.filter((message) => isReadablePrewarmMessage(message)));
  }

  private sourceKinId(notification: KindroidChatNotification): string | null {
    if (notification.type === "kindroid.chat.changed") {
      return notification.kinId;
    }

    return notification.aiId && this.options.isKnownKin(notification.aiId) ? notification.aiId : null;
  }
}

export function buildSoundscapePrewarmText(input: {
  scope: "direct" | "group";
  displayName: string;
  messages: NormalizedKindroidMessage[];
}): string | null {
  const readableMessages = input.messages.filter((message) => isReadablePrewarmMessage(message)).slice(-14);
  if (readableMessages.length === 0) {
    return null;
  }

  return [
    "SOUNDSCAPE_PREWARM_REQUEST",
    `Build an initial local soundscape for this ${input.scope} chat before waiting for a future scene-change turn.`,
    `Source: ${input.displayName}.`,
    "Infer the current venue, room tone, weather, machinery, crowd, vehicle, outdoor texture, and tension from recent context.",
    "Return update_soundscape or update_group_soundscape when a plausible ambience can be inferred. Use audible cached-sample mixer volumes: primary beds usually 0.35-0.55, weather 0.4-0.65, and hum/drone/static usually 0.15-0.3. Return no non-soundscape actions.",
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

function mostRecentSoundscapeEnabledKinId(
  messages: NormalizedKindroidMessage[],
  isEnabled: (kinId: string) => boolean
): string | null {
  for (const message of [...messages].reverse()) {
    if (message.kinId && isEnabled(message.kinId)) {
      return message.kinId;
    }
  }
  return null;
}
