import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { LocalSceneState } from "../localScene/localSceneStore.js";
import type { HermesAdapter } from "../hermes/types.js";
import { type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { loadRecentKindroidChatHistoryMessages } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";

interface LocalScenePrewarmCoordinatorOptions {
  config: AppConfig;
  logger: Logger;
  hermes: HermesAdapter;
}

export class LocalScenePrewarmCoordinator {
  private readonly attempts = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly readySources = new Set<string>();

  constructor(private readonly options: LocalScenePrewarmCoordinatorOptions) {}

  markReady(state: LocalSceneState): void {
    if (state.scope === "kin" && state.kinId) {
      this.readySources.add(`kin:${state.kinId}`);
      return;
    }
    if (state.scope === "group" && state.groupId) {
      this.readySources.add(`group:${state.groupId}`);
    }
  }

  async prewarmKin(kin: KindroidKin, reason: string): Promise<void> {
    const key = `kin:${kin.aiId}`;
    if (!this.begin(key)) {
      return;
    }

    try {
      const messages = await this.loadRecentKinMessages(kin.aiId, 18);
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
        documentId: `local-scene-prewarm:${kin.aiId}:${Date.now()}`,
        timestamp: new Date().toISOString(),
        text,
        localSceneContext: {
          prewarm: true,
          sourceScope: "direct",
          sourceKinId: kin.aiId,
          mutation: "local-kinagent-only"
        }
      });
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
    reason: string
  ): Promise<void> {
    if (notification && notification.type !== "kindroid.group_chat.changed") {
      return;
    }

    const key = `group:${group.groupId}`;
    if (!this.begin(key)) {
      return;
    }

    try {
      const messages = await this.loadRecentGroupMessages(group.groupId, 18);
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
        documentId: `local-scene-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: new Date().toISOString(),
        text,
        localSceneContext: {
          prewarm: true,
          sourceScope: "group",
          latestSpeakerKinId,
          groupId: group.groupId,
          mutation: "local-kinagent-only"
        }
      });
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

  private begin(key: string): boolean {
    if (!this.options.config.hermes.enabled || !this.options.config.hermes.apiKey) {
      return false;
    }

    if (this.readySources.has(key) || this.inFlight.has(key)) {
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
