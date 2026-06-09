import type { AppConfig } from "../config/types.js";
import type { KindroidGroup } from "../kindroid/client/index.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { SendKindroidGroupMessageResult, UpdateKindroidGroupCurrentSceneResult } from "../kindroid/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import { newRequestId } from "../util/ids.js";
import type { Logger } from "../util/logger.js";
import type { CampaignStateStore, GroupCampaignState } from "./campaignStateStore.js";

export type GameKindroidClient = Pick<KindroidClient, "sendGroupMessage" | "updateGroupCurrentScene">;

export interface GameKeeperMessageSentEvent {
  groupId: string;
  groupName: string;
  text: string;
  requestId: string;
  idempotencyKey: string;
  sourceDocumentId: string;
  result: SendKindroidGroupMessageResult;
}

export interface KeeperMessengerOptions {
  config: AppConfig;
  logger: Logger;
  campaignStates: CampaignStateStore;
  dedupeStore: DedupeStore;
  kindroidClient?: GameKindroidClient;
  onStateUpdated?: (state: GroupCampaignState) => void;
  onKeeperMessageSent?: (event: GameKeeperMessageSentEvent) => void;
}

export type KeeperMessageSource = "autonomous" | "approved-suggestion" | "roll-result";

export class KeeperMessenger {
  private readonly kindroidClient: GameKindroidClient;

  constructor(private readonly options: KeeperMessengerOptions) {
    this.kindroidClient = options.kindroidClient ?? new KindroidClient(options.config, options.logger);
  }

  async send(
    group: KindroidGroup,
    sourceDocumentId: string,
    message: string,
    input: {
      source: KeeperMessageSource;
      triggerAiResponse?: boolean;
      recordCampaignState?: boolean;
      syncCurrentScene?: boolean;
    }
  ): Promise<SendKindroidGroupMessageResult> {
    const requestId = newRequestId();
    const idempotencyKey = newRequestId();
    const triggerAiResponse = input.triggerAiResponse ?? false;
    const recordCampaignState = input.recordCampaignState ?? true;
    const syncCurrentScene = input.syncCurrentScene ?? input.source !== "roll-result";
    const result = await this.sendGroupMessage({
      groupId: group.groupId,
      message,
      requestId,
      idempotencyKey,
      triggerAiResponse
    });
    this.options.logger.info("Group Gaming Keeper message sent.", {
      groupId: group.groupId,
      groupName: group.name,
      sourceDocumentId,
      source: input.source,
      triggerAiResponse,
      ok: result.ok,
      status: result.status,
      requestId
    });

    if (result.ok) {
      await this.options.dedupeStore.recordOutbound({
        kinId: group.groupId,
        text: message,
        requestId,
        idempotencyKey
      });
      if (recordCampaignState) {
        const updated = this.options.campaignStates.markKeeperMessageSent({
          groupId: group.groupId,
          text: message,
          requestId,
          idempotencyKey,
          sourceDocumentId
        });
        if (updated) {
          this.options.onStateUpdated?.(updated);
        }
      }
      if (syncCurrentScene) {
        await this.syncCurrentScene(group, sourceDocumentId, message);
      }
    }

    this.options.onKeeperMessageSent?.({
      groupId: group.groupId,
      groupName: group.name,
      text: message,
      requestId,
      idempotencyKey,
      sourceDocumentId,
      result
    });

    return result;
  }

  private async sendGroupMessage(input: {
    groupId: string;
    message: string;
    requestId: string;
    idempotencyKey: string;
    triggerAiResponse: boolean;
  }): Promise<SendKindroidGroupMessageResult> {
    try {
      return await this.kindroidClient.sendGroupMessage({
        ...input,
        triggerAiResponse: input.triggerAiResponse
      });
    } catch (error) {
      return {
        status: 0,
        ok: false,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        responseText: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async syncCurrentScene(group: KindroidGroup, sourceDocumentId: string, message: string): Promise<void> {
    if (!this.options.config.hermes.currentSceneUpdates.enabled) {
      return;
    }

    const currentScene = keeperMessageCurrentScene(message, this.options.config.hermes.currentSceneUpdates.maxLength);
    if (!currentScene) {
      return;
    }

    const result = await this.kindroidClient.updateGroupCurrentScene({
      groupId: group.groupId,
      currentScene
    });
    logKeeperCurrentSceneSync(this.options.logger, group, sourceDocumentId, result);
  }
}

export function keeperMessageCurrentScene(message: string, maxLength: number): string {
  return message
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => trimOuterAsterisks(line.trim()))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, Math.max(1, maxLength))
    .trim();
}

function logKeeperCurrentSceneSync(
  logger: Logger,
  group: KindroidGroup,
  sourceDocumentId: string,
  result: UpdateKindroidGroupCurrentSceneResult
): void {
  const meta = {
    groupId: group.groupId,
    groupName: group.name,
    sourceDocumentId,
    ok: result.ok,
    status: result.status,
    responseText: result.responseText
  };
  if (result.ok) {
    logger.info("Group Gaming Keeper current scene sync completed.", meta);
  } else {
    logger.warn("Group Gaming Keeper current scene sync failed.", meta);
  }
}

function trimOuterAsterisks(value: string): string {
  return value.replace(/^\*+/, "").replace(/\*+$/, "").trim();
}
