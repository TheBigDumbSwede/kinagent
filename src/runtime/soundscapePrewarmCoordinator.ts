import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { ScopedSoundscapeUpdate } from "../hermes/soundscapeActionHandler.js";
import type { HermesAdapter } from "../hermes/types.js";
import { type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import {
  isReadablePrewarmMessage,
  mostRecentKinId,
  mostRecentMessage,
  PrewarmCoordinatorBase,
  type PrewarmCoordinatorBaseOptions,
  prewarmMessagePrefix,
  truncatePrewarmText,
  type PrewarmTrigger
} from "./prewarmCoordinatorBase.js";

interface SoundscapePrewarmCoordinatorOptions extends PrewarmCoordinatorBaseOptions {
  config: AppConfig;
  hermes: HermesAdapter;
  isKinSoundscapeEnabled: (kinId: string) => boolean;
  isGroupSoundscapeEnabled: (groupId: string) => boolean;
  isKnownKin: (kinId: string) => boolean;
}

export class SoundscapePrewarmCoordinator extends PrewarmCoordinatorBase {
  constructor(private readonly options: SoundscapePrewarmCoordinatorOptions) {
    super(options, {
      kind: "soundscape",
      deferLabel: "soundscape"
    });
  }

  onKinPreferenceChanged(kin: KindroidKin | null, enabled: boolean): void {
    if (!kin) {
      return;
    }

    const source = { scope: "kin" as const, id: kin.aiId };
    this.resetAttempts(source);
    if (!enabled) {
      this.clearRuntimeState(source);
      return;
    }

    void this.prewarmKin(kin, "preference-enabled");
  }

  onGroupPreferenceChanged(group: KindroidGroup | null, enabled: boolean): void {
    if (!group) {
      return;
    }

    const source = { scope: "group" as const, id: group.groupId };
    this.resetAttempts(source);
    if (!enabled) {
      this.clearRuntimeState(source);
      return;
    }

    void this.prewarmGroup(group, null, "preference-enabled");
  }

  markReady(update: ScopedSoundscapeUpdate): void {
    if (update.scope === "kin" && update.kinId) {
      this.markReadySource(
        { scope: "kin", id: update.kinId },
        { documentId: update.documentId, timestamp: update.sourceTimestamp ?? null }
      );
      return;
    }
    if (update.scope === "group" && update.groupId) {
      this.markReadySource(
        { scope: "group", id: update.groupId },
        { documentId: update.documentId, timestamp: update.sourceTimestamp ?? null }
      );
    }
  }

  isEnabled(notification: KindroidChatNotification): boolean {
    if (notification.type === "kindroid.group_chat.changed") {
      return this.options.isGroupSoundscapeEnabled(notification.groupId);
    }

    const sourceKinId = this.sourceKinId(notification);
    return sourceKinId ? this.options.isKinSoundscapeEnabled(sourceKinId) : false;
  }

  context(notification: KindroidChatNotification): unknown {
    const sourceKinId = this.sourceKinId(notification);
    const groupId = notification.type === "kindroid.group_chat.changed" ? notification.groupId : undefined;
    return {
      enabledForSource: groupId
        ? this.options.isGroupSoundscapeEnabled(groupId)
        : Boolean(sourceKinId && this.options.isKinSoundscapeEnabled(sourceKinId)),
      sourceScope: notification.type === "kindroid.chat.changed" ? "direct" : "group",
      sourceKinId: notification.type === "kindroid.chat.changed" ? sourceKinId : undefined,
      latestSpeakerKinId: notification.type === "kindroid.group_chat.changed" ? sourceKinId : undefined,
      groupId,
      mutation: "local-renderer-only"
    };
  }

  async prewarmKin(
    kin: KindroidKin,
    reason: string,
    input: { trigger?: PrewarmTrigger; force?: boolean } = {}
  ): Promise<void> {
    const source = { scope: "kin" as const, id: kin.aiId };
    if (!this.begin(source, input, this.options.isKinSoundscapeEnabled(kin.aiId))) {
      return;
    }

    try {
      const messages = await this.loadRecentMessages(source, 18);
      if (!messages) {
        this.scheduleKinCatchup(kin);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
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
        documentId:
          latestMessage?.documentId ?? input.trigger?.documentId ?? `soundscape-prewarm:${kin.aiId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        soundscapeContext: {
          enabledForSource: true,
          prewarm: true,
          sourceScope: "direct",
          sourceKinId: kin.aiId,
          mutation: "local-renderer-only"
        }
      });
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes soundscape prewarm setup failed.", {
        scope: "kin",
        kinId: kin.aiId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.finish(source);
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

    const source = { scope: "group" as const, id: group.groupId };
    if (!this.begin(source, input, this.options.isGroupSoundscapeEnabled(group.groupId))) {
      return;
    }

    try {
      const messages = await this.loadRecentMessages(source, 18);
      if (!messages) {
        this.scheduleGroupCatchup(group);
        return;
      }
      const latestMessage = mostRecentMessage(messages);
      const latestSpeakerKinId = notification?.aiId || mostRecentKinId(messages);

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
        latestSpeakerKinId,
        reason,
        messageCount: messages.length
      });
      await this.options.hermes.prewarmSoundscape?.({
        scope: "group",
        groupId: group.groupId,
        aiId: latestSpeakerKinId,
        documentId:
          latestMessage?.documentId ?? input.trigger?.documentId ?? `soundscape-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: latestMessage?.timestamp ?? input.trigger?.timestamp ?? new Date().toISOString(),
        text,
        soundscapeContext: {
          enabledForSource: true,
          prewarm: true,
          sourceScope: "group",
          latestSpeakerKinId,
          groupId: group.groupId,
          mutation: "local-renderer-only"
        }
      });
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes group soundscape prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.finish(source);
    }
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
