import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { LocalSceneState } from "../localScene/localSceneStore.js";
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

interface LocalScenePrewarmCoordinatorOptions extends PrewarmCoordinatorBaseOptions {
  config: AppConfig;
  hermes: HermesAdapter;
}

export class LocalScenePrewarmCoordinator extends PrewarmCoordinatorBase {
  constructor(private readonly options: LocalScenePrewarmCoordinatorOptions) {
    super(options, {
      kind: "localScene",
      deferLabel: "local scene",
      isRuntimeEnabled: () => options.config.hermes.enabled && Boolean(options.config.hermes.apiKey)
    });
  }

  markReady(state: LocalSceneState): void {
    if (state.scope === "kin" && state.kinId) {
      this.markReadySource(
        { scope: "kin", id: state.kinId },
        {
          documentId: state.sourceDocumentId,
          timestamp: state.sourceTimestamp
        }
      );
      return;
    }
    if (state.scope === "group" && state.groupId) {
      this.markReadySource(
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
    const source = { scope: "kin" as const, id: kin.aiId };
    if (!this.begin(source, input)) {
      return;
    }

    try {
      const messages = await this.loadRecentMessages(source, 18);
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
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes local scene prewarm setup failed.", {
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
    if (!this.begin(source, input)) {
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
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes group local scene prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.finish(source);
    }
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
