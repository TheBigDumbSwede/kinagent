import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification, NormalizedKindroidMessage } from "../firestore/types.js";
import type { HermesAdapter } from "../hermes/types.js";
import type { KindroidGroup, KindroidKin } from "../kindroid/client/index.js";
import type { PreviouslyOnBrief } from "../previouslyOn/previouslyOnStore.js";
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

interface PreviouslyOnPrewarmCoordinatorOptions extends PrewarmCoordinatorBaseOptions {
  config: AppConfig;
  hermes: HermesAdapter;
}

export class PreviouslyOnPrewarmCoordinator extends PrewarmCoordinatorBase {
  constructor(private readonly options: PreviouslyOnPrewarmCoordinatorOptions) {
    super(options, {
      kind: "previouslyOn",
      deferLabel: "Previously On",
      isRuntimeEnabled: () => options.config.hermes.enabled && Boolean(options.config.hermes.apiKey)
    });
  }

  markReady(brief: PreviouslyOnBrief): void {
    if (brief.scope === "kin" && brief.kinId) {
      this.markReadySource(
        { scope: "kin", id: brief.kinId },
        {
          documentId: brief.sourceDocumentId,
          timestamp: brief.sourceTimestamp
        }
      );
      return;
    }
    if (brief.scope === "group" && brief.groupId) {
      this.markReadySource(
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
    const source = { scope: "kin" as const, id: kin.aiId };
    if (!this.begin(source, input)) {
      return;
    }

    try {
      const messages = await this.loadRecentMessages(source, 24);
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
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes Previously On prewarm setup failed.", {
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
      const messages = await this.loadRecentMessages(source, 24);
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
      this.markAttempt(source, latestMessage ?? input.trigger);
    } catch (error) {
      this.options.logger.warn("Hermes group Previously On prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.finish(source);
    }
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
