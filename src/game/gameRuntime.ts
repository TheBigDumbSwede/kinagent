import type { AppConfig } from "../config/types.js";
import type { KindroidGroup } from "../kindroid/client/index.js";
import type { KindroidChatNotification, KindroidGroupChatChangeNotification } from "../firestore/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { Logger } from "../util/logger.js";
import { loadCampaignPacks, type LoadedCampaignPack } from "./campaignPack.js";
import { CampaignStateStore, type GameKeeperDecision, type GroupCampaignState } from "./campaignStateStore.js";
import { parseGameCommand, type GameCommand } from "./gameCommands.js";
import { parseGameDecisionContent, normalizeGameDecision } from "./gameDecision.js";
import { genericMysteryMoves, randomDiceRoller, resolvePbtARoll, type DiceRoller } from "./gameMoves.js";
import { GroupGamingPreferenceStore, type GamingAutomationMode } from "./groupGamingPreferences.js";
import { KeeperMessenger, type GameKeeperMessageSentEvent, type GameKindroidClient } from "./keeperMessenger.js";
import { formatRollResultMessage, rollOutcomeSummary } from "./rollFormatting.js";
import { spoilerFreeMysteryBrief, type SpoilerFreeMysteryBrief } from "./spoilerFreeBrief.js";
import { TurnBuffer, type GameTurnParcel } from "./turnBuffer.js";

export type { GameKeeperMessageSentEvent, GameKindroidClient } from "./keeperMessenger.js";

interface HermesChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface GameMysteryIntro {
  keeperMessage: string;
  reason?: string;
}

interface PostRollKeeperNarration {
  keeperMessage: string;
  reason?: string;
}

export interface GameRuntimeOptions {
  config: AppConfig;
  logger: Logger;
  preferences: GroupGamingPreferenceStore;
  campaignStates: CampaignStateStore;
  dedupeStore: DedupeStore;
  kindroidClient?: GameKindroidClient;
  diceRoller?: DiceRoller;
  onStateUpdated?: (state: GroupCampaignState) => void;
  onKeeperMessageSent?: (event: GameKeeperMessageSentEvent) => void;
  onPendingDecision?: (state: GroupCampaignState) => void;
}

export interface GameGroupChatResult {
  gameHandled: boolean;
  keeperMessageAttempted: boolean;
  keeperMessageSent: boolean;
  keeperMessageSuppressed: boolean;
}

export interface GameEventPolicy {
  gameHandled: boolean;
  canMutateState: boolean;
  canCreateKeeperDecision: boolean;
}

interface KeeperSpeechPacing {
  canSpeak: boolean;
  reason: "not-autonomous" | "player-turn" | "non-player-turn" | "cooldown";
  cooldownSeconds: number;
  lastKeeperMessageAt?: string;
}

interface RollResolutionResult {
  state: GroupCampaignState;
  keeperMessageAttempted: boolean;
  keeperMessageSent: boolean;
}

const autonomousKeeperCooldownMs = 30 * 1000;

export class GameRuntime {
  private readonly diceRoller: DiceRoller;
  private readonly turnBuffer = new TurnBuffer();
  private readonly keeperMessenger: KeeperMessenger;

  constructor(private readonly options: GameRuntimeOptions) {
    this.diceRoller = options.diceRoller ?? randomDiceRoller;
    this.keeperMessenger = new KeeperMessenger({
      config: options.config,
      logger: options.logger,
      campaignStates: options.campaignStates,
      dedupeStore: options.dedupeStore,
      kindroidClient: options.kindroidClient,
      onStateUpdated: options.onStateUpdated,
      onKeeperMessageSent: options.onKeeperMessageSent
    });
  }

  async handleGroupChatChanged(
    group: KindroidGroup,
    notification: KindroidChatNotification
  ): Promise<GameGroupChatResult> {
    if (notification.type !== "kindroid.group_chat.changed") {
      return emptyGameGroupChatResult();
    }

    const preference = this.options.preferences.get(group.groupId);
    if (!preference.enabled) {
      return emptyGameGroupChatResult();
    }

    if (!notification.text || (notification.textEncrypted && !notification.textDecrypted)) {
      this.options.logger.debug("Skipping game runtime event without readable group chat text.", {
        groupId: group.groupId,
        documentId: notification.documentId
      });
      return emptyGameGroupChatResult();
    }

    const campaign = this.resolveCampaign(preference.campaignId);
    if (!campaign) {
      this.options.logger.warn("Group Gaming is enabled but no campaign pack is available.", {
        groupId: group.groupId,
        campaignId: preference.campaignId
      });
      return emptyGameGroupChatResult();
    }

    const command = notification.sender === "user" ? parseGameCommand(notification.text) : null;
    if (command) {
      return this.handleGameCommand({
        group,
        notification,
        command,
        campaign,
        mysteryId: preference.mysteryId,
        automationMode: preference.automationMode
      });
    }

    const currentState = this.options.campaignStates.ensureInitialized({
      groupId: group.groupId,
      campaign,
      mysteryId: preference.mysteryId
    });
    if (currentState.status === "completed") {
      this.options.logger.info("Skipping Group Gaming event because the mystery is completed.", {
        groupId: group.groupId,
        documentId: notification.documentId,
        campaignId: campaign.id,
        mysteryId: currentState.mysteryId
      });
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: true
      };
    }

    if (!this.options.config.hermes.enabled || !this.options.config.hermes.apiKey) {
      this.options.logger.warn("Group Gaming event skipped because Hermes is not configured.", {
        groupId: group.groupId,
        documentId: notification.documentId
      });
      return emptyGameGroupChatResult();
    }

    const eventPolicy = gameEventPolicy(notification, preference.automationMode);
    if (currentState.processedSourceDocumentIds.includes(notification.documentId)) {
      this.options.logger.info("Skipping duplicate Group Gaming source document.", {
        groupId: group.groupId,
        documentId: notification.documentId,
        campaignId: campaign.id,
        mysteryId: currentState.mysteryId
      });
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: false
      };
    }
    if (!eventPolicy.canMutateState && !eventPolicy.canCreateKeeperDecision) {
      const buffered = this.turnBuffer.bufferContext(group.groupId, notification);
      this.options.logger.info("Group Gaming event buffered as non-mutating turn context.", {
        groupId: group.groupId,
        documentId: notification.documentId,
        sender: notification.sender,
        role: notification.role,
        automationMode: preference.automationMode,
        buffered
      });
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: false
      };
    }
    const keeperSpeechPacing = evaluateKeeperSpeechPacing({
      state: currentState,
      notification,
      automationMode: preference.automationMode
    });
    this.options.logger.info("Requesting Group Gaming decision from Hermes.", {
      groupId: group.groupId,
      groupName: group.name,
      documentId: notification.documentId,
      campaignId: campaign.id,
      mysteryId: currentState.mysteryId,
      automationMode: preference.automationMode,
      sender: notification.sender,
      role: notification.role,
      bufferedContextMessages: this.turnBuffer.context(group.groupId, notification.timestamp).length
    });
    const turnParcel = this.turnBuffer.buildParcel(group.groupId, notification);
    const decision = await this.requestGameDecision({
      group,
      notification,
      turnParcel,
      campaign,
      state: currentState,
      automationMode: preference.automationMode,
      keeperSpeechPacing
    });
    const eventFilteredDecision = applyGameEventPolicy(decision, eventPolicy);
    const policyDecision = formatDecisionForGroupTransport(
      surfaceAutonomousUserDecision({
        decision: decisionForPolicy(eventFilteredDecision, preference.automationMode),
        notification,
        automationMode: preference.automationMode,
        state: currentState
      })
    );
    const pacedDecision = applyKeeperSpeechPacing(policyDecision, preference.automationMode, keeperSpeechPacing);
    const applied = this.options.campaignStates.applyDecision({
      groupId: group.groupId,
      campaign,
      mysteryId: currentState.mysteryId,
      sourceDocumentId: notification.documentId,
      automationMode: preference.automationMode,
      decision: pacedDecision
    });
    const rollResolution = await this.resolveRollFromStateIfPending({
      group,
      state: applied,
      automationMode: preference.automationMode
    });
    const updated = rollResolution?.state ?? applied;
    const keeperMessageSuppressed = Boolean(policyDecision.keeperMessage && !pacedDecision.keeperMessage);
    this.options.logger.info("Group Gaming decision applied.", {
      groupId: group.groupId,
      documentId: notification.documentId,
      campaignId: campaign.id,
      mysteryId: currentState.mysteryId,
      automationMode: preference.automationMode,
      stateChangeCount: pacedDecision.stateChanges.length,
      keeperMessagePresent: Boolean(pacedDecision.keeperMessage),
      keeperMessageSuppressed,
      keeperSpeechPacingReason: keeperMessageSuppressed ? keeperSpeechPacing.reason : undefined,
      rollResolved: Boolean(rollResolution),
      pendingDecision: Boolean(updated.pendingDecision)
    });
    this.turnBuffer.checkpoint(group.groupId, turnParcel);
    if (keeperMessageSuppressed) {
      this.options.logger.info("Group Gaming autonomous Keeper message suppressed by pacing.", {
        groupId: group.groupId,
        documentId: notification.documentId,
        sender: notification.sender,
        role: notification.role,
        reason: keeperSpeechPacing.reason,
        cooldownSeconds: keeperSpeechPacing.cooldownSeconds,
        lastKeeperMessageAt: keeperSpeechPacing.lastKeeperMessageAt
      });
    }
    this.options.onStateUpdated?.(updated);

    if (updated.pendingDecision) {
      this.options.onPendingDecision?.(updated);
    }

    if (rollResolution) {
      return {
        gameHandled: true,
        keeperMessageAttempted: rollResolution.keeperMessageAttempted,
        keeperMessageSent: rollResolution.keeperMessageSent,
        keeperMessageSuppressed
      };
    }

    if (preference.automationMode === "autonomous" && pacedDecision.keeperMessage) {
      const keeperMessageAttempted = true;
      const keeperMessageSent = await this.sendKeeperMessage(
        group,
        notification.documentId,
        pacedDecision.keeperMessage,
        {
          source: "autonomous"
        }
      );
      return {
        gameHandled: true,
        keeperMessageAttempted,
        keeperMessageSent,
        keeperMessageSuppressed
      };
    }

    return {
      gameHandled: true,
      keeperMessageAttempted: false,
      keeperMessageSent: false,
      keeperMessageSuppressed
    };
  }

  async approvePendingKeeperMessage(group: KindroidGroup): Promise<GroupCampaignState> {
    const state = this.options.campaignStates.getForGroup(group.groupId);
    if (!state?.pendingDecision) {
      throw new Error("No pending Keeper suggestion is available for this Group.");
    }
    if (!state.pendingDecision.keeperMessage) {
      throw new Error("The pending game decision has no Keeper message to send.");
    }

    const sendResult = await this.keeperMessenger.send(
      group,
      state.pendingDecision.sourceDocumentId,
      state.pendingDecision.keeperMessage,
      {
        source: "approved-suggestion"
      }
    );
    if (!sendResult.ok) {
      throw new Error("Keeper suggestion could not be sent to the Group.");
    }
    if (state.rollHistory.some((entry) => entry.sourceDocumentId === state.pendingDecision?.sourceDocumentId)) {
      this.options.campaignStates.markRollResultSent({
        groupId: group.groupId,
        sourceDocumentId: state.pendingDecision.sourceDocumentId,
        message: state.pendingDecision.keeperMessage,
        sent: {
          ok: sendResult.ok,
          status: sendResult.status,
          requestId: sendResult.requestId,
          idempotencyKey: sendResult.idempotencyKey,
          ...(sendResult.responseText ? { responseText: sendResult.responseText } : {})
        }
      });
    }

    const updated = this.options.campaignStates.getForGroup(group.groupId);
    if (!updated) {
      throw new Error("Group campaign state was not available after sending the Keeper suggestion.");
    }
    return updated;
  }

  private async resolveRollFromStateIfPending(input: {
    group: KindroidGroup;
    state: GroupCampaignState;
    automationMode: GamingAutomationMode;
  }): Promise<RollResolutionResult | null> {
    const pending = input.state.pendingRollRequest;
    if (!pending) {
      return null;
    }

    const result = resolvePbtARoll(pending.request, { roller: this.diceRoller });
    const recorded = this.options.campaignStates.recordRollResult({
      groupId: input.group.groupId,
      sourceDocumentId: pending.sourceDocumentId,
      automationMode: pending.automationMode,
      request: pending.request,
      result,
      message: formatRollResultMessage(result)
    });
    if (!recorded) {
      throw new Error("Group campaign state was not available after resolving the roll.");
    }
    this.options.onStateUpdated?.(recorded);

    if (input.automationMode === "observe") {
      return {
        state: recorded,
        keeperMessageAttempted: false,
        keeperMessageSent: false
      };
    }

    const narration =
      (await this.requestPostRollKeeperNarration({
        group: input.group,
        state: recorded,
        pending,
        result
      })) ?? fallbackPostRollNarration(result);
    const message = formatKeeperMessageForGroupChat(`${rollResultPrefix(result)} ${narration.keeperMessage}`);

    if (input.automationMode === "suggest") {
      const pendingDecision =
        this.options.campaignStates.storePendingKeeperDecision({
          groupId: input.group.groupId,
          sourceDocumentId: pending.sourceDocumentId,
          automationMode: input.automationMode,
          keeperMessage: message,
          confidence: pending.confidence,
          reason: narration.reason ?? pending.reason
        }) ?? recorded;
      this.options.onStateUpdated?.(pendingDecision);
      return {
        state: pendingDecision,
        keeperMessageAttempted: false,
        keeperMessageSent: false
      };
    }

    const sendResult = await this.keeperMessenger.send(input.group, pending.sourceDocumentId, message, {
      source: "roll-result",
      triggerAiResponse: false
    });
    if (!sendResult.ok) {
      this.options.logger.warn("Group Gaming post-roll Keeper message send failed.", {
        groupId: input.group.groupId,
        sourceDocumentId: pending.sourceDocumentId,
        status: sendResult.status,
        responseText: sendResult.responseText
      });
    }

    const updated =
      this.options.campaignStates.markRollResultSent({
        groupId: input.group.groupId,
        sourceDocumentId: pending.sourceDocumentId,
        message,
        sent: {
          ok: sendResult.ok,
          status: sendResult.status,
          requestId: sendResult.requestId,
          idempotencyKey: sendResult.idempotencyKey,
          ...(sendResult.responseText ? { responseText: sendResult.responseText } : {})
        }
      }) ?? recorded;
    this.options.onStateUpdated?.(updated);
    return {
      state: updated,
      keeperMessageAttempted: true,
      keeperMessageSent: sendResult.ok
    };
  }

  private async handleGameCommand(input: {
    group: KindroidGroup;
    notification: KindroidGroupChatChangeNotification;
    command: GameCommand;
    campaign: LoadedCampaignPack;
    mysteryId?: string;
    automationMode: GamingAutomationMode;
  }): Promise<GameGroupChatResult> {
    const currentState = this.options.campaignStates.ensureInitialized({
      groupId: input.group.groupId,
      campaign: input.campaign,
      mysteryId: input.mysteryId
    });
    if (currentState.processedSourceDocumentIds.includes(input.notification.documentId)) {
      this.options.logger.info("Skipping duplicate Group Gaming command source document.", {
        groupId: input.group.groupId,
        documentId: input.notification.documentId,
        command: input.command.type,
        campaignId: input.campaign.id,
        mysteryId: currentState.mysteryId
      });
      return handledGameGroupChatResult();
    }
    const updated = this.applyGameCommandState(input);
    if (input.command.type === "reset_mystery" || input.command.type === "end_mystery") {
      this.turnBuffer.clear(input.group.groupId);
    }
    this.options.onStateUpdated?.(updated);
    this.options.logger.info("Group Gaming command applied.", {
      groupId: input.group.groupId,
      documentId: input.notification.documentId,
      command: input.command.type,
      campaignId: input.campaign.id,
      mysteryId: updated.mysteryId,
      automationMode: input.automationMode,
      status: updated.status
    });

    if (input.automationMode === "observe") {
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: true
      };
    }

    if (input.command.type === "end_mystery") {
      return this.handleEndMysteryKeeperMessage(input, updated);
    }

    if (!this.options.config.hermes.enabled || !this.options.config.hermes.apiKey) {
      this.options.logger.warn("Group Gaming command applied without Keeper intro because Hermes is not configured.", {
        groupId: input.group.groupId,
        documentId: input.notification.documentId,
        command: input.command.type,
        campaignId: input.campaign.id,
        mysteryId: updated.mysteryId,
        automationMode: input.automationMode
      });
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: true
      };
    }

    const intro = await this.requestMysteryIntro(input, updated.mysteryId);
    if (!intro) {
      return {
        gameHandled: true,
        keeperMessageAttempted: false,
        keeperMessageSent: false,
        keeperMessageSuppressed: false
      };
    }

    if (input.automationMode === "suggest") {
      const pending = this.options.campaignStates.storePendingKeeperDecision({
        groupId: input.group.groupId,
        sourceDocumentId: input.notification.documentId,
        automationMode: input.automationMode,
        keeperMessage: intro.keeperMessage,
        confidence: "high",
        reason: intro.reason
      });
      if (pending) {
        this.options.onStateUpdated?.(pending);
        this.options.onPendingDecision?.(pending);
      }
      return {
        gameHandled: true,
        keeperMessageAttempted: true,
        keeperMessageSent: false,
        keeperMessageSuppressed: true
      };
    }

    const pending = this.options.campaignStates.storePendingKeeperDecision({
      groupId: input.group.groupId,
      sourceDocumentId: input.notification.documentId,
      automationMode: input.automationMode,
      keeperMessage: intro.keeperMessage,
      confidence: "high",
      reason: intro.reason
    });
    if (pending) {
      this.options.onStateUpdated?.(pending);
    }
    const keeperMessageSent = await this.sendKeeperMessage(
      input.group,
      input.notification.documentId,
      intro.keeperMessage,
      {
        source: "autonomous",
        triggerAiResponse: false
      }
    );
    return {
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent,
      keeperMessageSuppressed: !keeperMessageSent
    };
  }

  private applyGameCommandState(input: {
    group: KindroidGroup;
    notification: KindroidGroupChatChangeNotification;
    command: GameCommand;
    campaign: LoadedCampaignPack;
    mysteryId?: string;
  }): GroupCampaignState {
    if (input.command.type === "reset_mystery") {
      return this.options.campaignStates.resetInitialized({
        groupId: input.group.groupId,
        campaign: input.campaign,
        mysteryId: input.mysteryId,
        sourceDocumentId: input.notification.documentId
      });
    }
    if (input.command.type === "end_mystery") {
      return this.options.campaignStates.complete({
        groupId: input.group.groupId,
        campaign: input.campaign,
        mysteryId: input.mysteryId,
        sourceDocumentId: input.notification.documentId
      });
    }
    return this.options.campaignStates.activate({
      groupId: input.group.groupId,
      campaign: input.campaign,
      mysteryId: input.mysteryId,
      sourceDocumentId: input.notification.documentId
    });
  }

  private async handleEndMysteryKeeperMessage(
    input: {
      group: KindroidGroup;
      notification: KindroidGroupChatChangeNotification;
      automationMode: GamingAutomationMode;
    },
    state: GroupCampaignState
  ): Promise<GameGroupChatResult> {
    const keeperMessage = completionKeeperMessage(state);
    if (input.automationMode === "suggest") {
      const pending = this.options.campaignStates.storePendingKeeperDecision({
        groupId: input.group.groupId,
        sourceDocumentId: input.notification.documentId,
        automationMode: input.automationMode,
        keeperMessage,
        confidence: "high",
        reason: "User completed the selected mystery."
      });
      if (pending) {
        this.options.onStateUpdated?.(pending);
        this.options.onPendingDecision?.(pending);
      }
      return {
        gameHandled: true,
        keeperMessageAttempted: true,
        keeperMessageSent: false,
        keeperMessageSuppressed: true
      };
    }

    const pending = this.options.campaignStates.storePendingKeeperDecision({
      groupId: input.group.groupId,
      sourceDocumentId: input.notification.documentId,
      automationMode: input.automationMode,
      keeperMessage,
      confidence: "high",
      reason: "User completed the selected mystery."
    });
    if (pending) {
      this.options.onStateUpdated?.(pending);
    }
    const keeperMessageSent = await this.sendKeeperMessage(input.group, input.notification.documentId, keeperMessage, {
      source: "autonomous",
      triggerAiResponse: false
    });
    return {
      gameHandled: true,
      keeperMessageAttempted: true,
      keeperMessageSent,
      keeperMessageSuppressed: !keeperMessageSent
    };
  }

  private resolveCampaign(campaignId: string | undefined): LoadedCampaignPack | null {
    const campaigns = loadCampaignPacks(this.options.config);
    return (
      (campaignId ? campaigns.find((campaign) => campaign.id === campaignId) : campaigns[0]) ?? campaigns[0] ?? null
    );
  }

  private async requestGameDecision(input: {
    group: KindroidGroup;
    notification: KindroidGroupChatChangeNotification;
    turnParcel: GameTurnParcel;
    campaign: LoadedCampaignPack;
    state: GroupCampaignState;
    automationMode: GamingAutomationMode;
    keeperSpeechPacing: KeeperSpeechPacing;
  }): Promise<GameKeeperDecision> {
    const response = await fetch(`${normalizeBaseUrl(this.options.config.hermes.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.config.hermes.apiKey}`
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [
          {
            role: "system",
            content: gameSystemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify(gamePromptPayload(input))
          }
        ]
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Hermes game request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const result = JSON.parse(responseText) as HermesChatCompletionResult;
    const content = result.choices?.[0]?.message?.content ?? "";
    return normalizeGameDecision(parseGameDecisionContent(content), input.campaign, input.state.mysteryId);
  }

  private async requestMysteryIntro(
    input: {
      group: KindroidGroup;
      notification: KindroidGroupChatChangeNotification;
      command: GameCommand;
      campaign: LoadedCampaignPack;
      automationMode: GamingAutomationMode;
    },
    mysteryId: string
  ): Promise<GameMysteryIntro | null> {
    const brief = spoilerFreeMysteryBrief(input.campaign, mysteryId);
    try {
      const response = await fetch(`${normalizeBaseUrl(this.options.config.hermes.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.config.hermes.apiKey}`
        },
        body: JSON.stringify({
          model: "hermes-agent",
          messages: [
            {
              role: "system",
              content: mysteryIntroSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify(mysteryIntroPromptPayload(input, brief))
            }
          ]
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        this.options.logger.warn("Hermes Group Gaming intro request failed.", {
          groupId: input.group.groupId,
          documentId: input.notification.documentId,
          command: input.command.type,
          status: response.status,
          responseText: responseText.slice(0, 500)
        });
        return null;
      }

      const result = JSON.parse(responseText) as HermesChatCompletionResult;
      const content = result.choices?.[0]?.message?.content ?? "";
      const intro = normalizeMysteryIntro(parseGameDecisionContent(content));
      if (!intro) {
        this.options.logger.warn("Hermes Group Gaming intro response did not include a Keeper message.", {
          groupId: input.group.groupId,
          documentId: input.notification.documentId,
          command: input.command.type
        });
        return null;
      }
      return {
        ...intro,
        keeperMessage: formatKeeperMessageForGroupChat(intro.keeperMessage)
      };
    } catch (error) {
      this.options.logger.warn("Hermes Group Gaming intro request failed.", {
        groupId: input.group.groupId,
        documentId: input.notification.documentId,
        command: input.command.type,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async requestPostRollKeeperNarration(input: {
    group: KindroidGroup;
    state: GroupCampaignState;
    pending: NonNullable<GroupCampaignState["pendingRollRequest"]>;
    result: ReturnType<typeof resolvePbtARoll>;
  }): Promise<PostRollKeeperNarration | null> {
    try {
      const response = await fetch(`${normalizeBaseUrl(this.options.config.hermes.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.config.hermes.apiKey}`
        },
        body: JSON.stringify({
          model: "hermes-agent",
          messages: [
            {
              role: "system",
              content: postRollKeeperSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify(postRollKeeperPromptPayload(input))
            }
          ]
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        this.options.logger.warn("Hermes Group Gaming post-roll request failed.", {
          groupId: input.group.groupId,
          sourceDocumentId: input.pending.sourceDocumentId,
          status: response.status,
          responseText: responseText.slice(0, 500)
        });
        return null;
      }

      const result = JSON.parse(responseText) as HermesChatCompletionResult;
      const content = result.choices?.[0]?.message?.content ?? "";
      const narration = normalizePostRollKeeperNarration(parseGameDecisionContent(content));
      if (!narration) {
        this.options.logger.warn("Hermes Group Gaming post-roll response did not include Keeper narration.", {
          groupId: input.group.groupId,
          sourceDocumentId: input.pending.sourceDocumentId
        });
        return null;
      }
      return narration;
    } catch (error) {
      this.options.logger.warn("Hermes Group Gaming post-roll request failed.", {
        groupId: input.group.groupId,
        sourceDocumentId: input.pending.sourceDocumentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async sendKeeperMessage(
    group: KindroidGroup,
    sourceDocumentId: string,
    message: string,
    input: { source: "autonomous" | "approved-suggestion"; triggerAiResponse?: boolean }
  ): Promise<boolean> {
    const result = await this.keeperMessenger.send(group, sourceDocumentId, message, input);
    return result.ok;
  }
}

function emptyGameGroupChatResult(): GameGroupChatResult {
  return {
    gameHandled: false,
    keeperMessageAttempted: false,
    keeperMessageSent: false,
    keeperMessageSuppressed: false
  };
}

function handledGameGroupChatResult(): GameGroupChatResult {
  return {
    gameHandled: true,
    keeperMessageAttempted: false,
    keeperMessageSent: false,
    keeperMessageSuppressed: false
  };
}

export function gameEventPolicy(
  notification: KindroidChatNotification,
  _automationMode: GamingAutomationMode
): GameEventPolicy {
  const isUserTurn = notification.type === "kindroid.group_chat.changed" && notification.sender === "user";
  return {
    gameHandled: notification.type === "kindroid.group_chat.changed",
    canMutateState: isUserTurn,
    canCreateKeeperDecision: isUserTurn
  };
}

export function applyGameEventPolicy(decision: GameKeeperDecision, policy: GameEventPolicy): GameKeeperDecision {
  return {
    ...decision,
    stateChanges: policy.canMutateState ? decision.stateChanges : [],
    ...(policy.canCreateKeeperDecision
      ? {}
      : {
          keeperMessage: undefined,
          moveCall: undefined,
          rollRequest: undefined,
          pressureCategory: undefined
        })
  };
}

function gameSystemPrompt(): string {
  return [
    "You are Hermes acting as a contained Keeper engine for an original mystery-horror group game.",
    "Kinagent is the authoritative campaign ledger. You may propose state changes, but only Kinagent stores truth.",
    'Return only compact JSON with this shape: {"keeperMessage":"","stateChanges":[],"moveCall":null,"rollRequest":null,"confidence":"low|medium|high","reason":""}.',
    'If a player-facing move roll is needed, set rollRequest as {"moveId":"<known move id>","actor":"","modifier":0,"prompt":"","reason":""}.',
    "Kinagent resolves dice rolls. Never invent dice totals or roll outcomes.",
    "Allowed stateChanges are:",
    '{"type":"advance_countdown","by":1,"reason":""}',
    '{"type":"set_status","status":"initialized|active|paused|completed","reason":""}',
    '{"type":"add_discovered_clue","clueId":"<known clue id>","reason":""}',
    '{"type":"reveal_threat","threatId":"<known threat id>","reason":""}',
    '{"type":"reveal_npc","npcId":"<known npc id>","reason":""}',
    '{"type":"visit_location","locationId":"<known location id>","reason":""}',
    '{"type":"append_note","text":"<short factual note>"}',
    "Optional pressureCategory values are: foreshadow, offscreen_pressure, direct_danger, investigation_prompt, resource_pressure, consequence_choice, opportunity_with_cost, loss_or_complication, bystander_trouble, threat_action, scene_question.",
    "Do not invent ids. Do not resolve player choices without a recent group message supporting it.",
    "Keeper messages should be concise, playable group-chat text, not rules explanation.",
    "Keeper messages are posted through the user's group-send transport, so never write bare first-person speech as if from the user.",
    'Format keeperMessage as narrated text: wrap narration in asterisks, and put any spoken words inside double quotes within that narration, such as *The radio crackles: "Do not touch the water."*.'
  ].join("\n");
}

function mysteryIntroSystemPrompt(): string {
  return [
    "You are Hermes acting as a contained Keeper intro writer for an original mystery-horror group game.",
    "Write a spoiler-free opening Keeper message for the group.",
    "Use only the public briefing supplied.",
    "Do not reveal the mystery truth, monster identity, countdown, hidden clues, weaknesses, or future events.",
    'Return only compact JSON: {"keeperMessage":"","reason":""}.'
  ].join("\n");
}

function postRollKeeperSystemPrompt(): string {
  return [
    "You are Hermes writing only the Keeper narration for an already resolved original mystery-horror group game roll.",
    "Kinagent is the dice authority. The roll result in the payload is final and read-only.",
    "Do not alter, reinterpret, reroll, omit, or contradict the supplied roll outcome.",
    "Do not include dice, totals, move names, or an outcome summary in your Keeper message; Kinagent prepends that.",
    "Do not return state changes, roll requests, dice, totals, or outcomes.",
    'Return only compact JSON: {"keeperMessage":"","reason":""}.',
    "Keeper messages should be concise, playable group-chat narration."
  ].join("\n");
}

function gamePromptPayload(input: {
  group: KindroidGroup;
  notification: KindroidGroupChatChangeNotification;
  turnParcel: GameTurnParcel;
  campaign: LoadedCampaignPack;
  state: GroupCampaignState;
  automationMode: GamingAutomationMode;
  keeperSpeechPacing: KeeperSpeechPacing;
}) {
  const mystery = input.campaign.mysteries.find((item) => item.id === input.state.mysteryId);
  return {
    type: "kinagent.game.group_event",
    automationMode: input.automationMode,
    keeperSpeechPacing: input.keeperSpeechPacing,
    group: {
      groupId: input.group.groupId,
      name: input.group.name,
      aiIds: input.group.aiIds
    },
    event: {
      documentId: input.notification.documentId,
      timestamp: input.notification.timestamp,
      aiId: input.notification.aiId,
      sender: input.notification.sender,
      role: input.notification.role,
      text: input.notification.text
    },
    turn: input.turnParcel,
    campaign: {
      id: input.campaign.id,
      title: input.campaign.title,
      genre: input.campaign.genre,
      tone: input.campaign.tone,
      rulesetStyle: input.campaign.rulesetStyle,
      contentWarnings: input.campaign.contentWarnings,
      threats: input.campaign.threats,
      locations: input.campaign.locations,
      npcs: input.campaign.npcs,
      hooks: input.campaign.hooks,
      hermes: input.campaign.hermes
    },
    moves: genericMysteryMoves,
    mystery,
    state: input.state
  };
}

function mysteryIntroPromptPayload(
  input: {
    group: KindroidGroup;
    command: GameCommand;
    automationMode: GamingAutomationMode;
  },
  brief: SpoilerFreeMysteryBrief
) {
  return {
    type: "kinagent.game.mystery_intro",
    command: input.command.type,
    automationMode: input.automationMode,
    group: {
      groupId: input.group.groupId,
      name: input.group.name,
      aiIds: input.group.aiIds
    },
    brief
  };
}

function postRollKeeperPromptPayload(input: {
  group: KindroidGroup;
  state: GroupCampaignState;
  pending: NonNullable<GroupCampaignState["pendingRollRequest"]>;
  result: ReturnType<typeof resolvePbtARoll>;
}) {
  const rollSummary = rollOutcomeSummary(input.result);
  return {
    type: "kinagent.game.post_roll_narration",
    instruction:
      "Write only the immediate Keeper narration caused by this fixed roll result. The roll result is authoritative.",
    group: {
      groupId: input.group.groupId,
      name: input.group.name,
      aiIds: input.group.aiIds
    },
    roll: {
      summary: rollSummary,
      outcome: input.result.outcome,
      total: input.result.total,
      dice: input.result.dice,
      modifier: input.result.modifier,
      actor: input.result.actor ?? null,
      requestPrompt: input.pending.request.prompt ?? null,
      requestReason: input.pending.request.reason ?? null
    },
    state: input.state
  };
}

function normalizeMysteryIntro(input: unknown): GameMysteryIntro | null {
  const record =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const keeperMessage = optionalIntroText(record?.keeperMessage, 1400);
  if (!keeperMessage) {
    return null;
  }
  return {
    keeperMessage,
    ...(optionalIntroText(record?.reason, 300) ? { reason: optionalIntroText(record?.reason, 300) } : {})
  };
}

function normalizePostRollKeeperNarration(input: unknown): PostRollKeeperNarration | null {
  const record =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const keeperMessage = stripRollSummaryPrefix(optionalIntroText(record?.keeperMessage, 1400));
  if (!keeperMessage) {
    return null;
  }
  return {
    keeperMessage,
    ...(optionalIntroText(record?.reason, 300) ? { reason: optionalIntroText(record?.reason, 300) } : {})
  };
}

function stripRollSummaryPrefix(value: string | undefined): string | undefined {
  const normalized = value?.replace(/^\(?\s*(?:roll|outcome|result)\s*:\s*[^.)]+[.)]\s*/i, "").trim();
  return normalized || undefined;
}

function optionalIntroText(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function decisionForPolicy(decision: GameKeeperDecision, mode: GamingAutomationMode): GameKeeperDecision {
  if (mode === "observe") {
    return {
      stateChanges: decision.stateChanges,
      ...(decision.rollRequest ? { rollRequest: decision.rollRequest } : {}),
      confidence: decision.confidence,
      reason: decision.reason
    };
  }

  return decision;
}

function surfaceAutonomousUserDecision(input: {
  decision: GameKeeperDecision;
  notification: KindroidChatNotification;
  automationMode: GamingAutomationMode;
  state: GroupCampaignState;
}): GameKeeperDecision {
  if (input.automationMode !== "autonomous" || input.notification.sender !== "user" || input.decision.keeperMessage) {
    return input.decision;
  }

  return {
    ...input.decision,
    keeperMessage:
      input.decision.rollRequest || input.state.pendingRollRequest
        ? undefined
        : "The moment hangs unresolved. What do you do next?"
  };
}

function applyKeeperSpeechPacing(
  decision: GameKeeperDecision,
  mode: GamingAutomationMode,
  pacing: KeeperSpeechPacing
): GameKeeperDecision {
  if (mode !== "autonomous" || pacing.canSpeak || !decision.keeperMessage) {
    return decision;
  }

  return {
    ...decision,
    keeperMessage: undefined,
    moveCall: undefined,
    pressureCategory: undefined
  };
}

function evaluateKeeperSpeechPacing(input: {
  state: GroupCampaignState;
  notification: KindroidChatNotification;
  automationMode: GamingAutomationMode;
}): KeeperSpeechPacing {
  const cooldownSeconds = Math.trunc(autonomousKeeperCooldownMs / 1000);
  if (input.automationMode !== "autonomous") {
    return { canSpeak: true, reason: "not-autonomous", cooldownSeconds };
  }

  if (input.notification.sender !== "user") {
    return {
      canSpeak: false,
      reason: "non-player-turn",
      cooldownSeconds,
      lastKeeperMessageAt: input.state.lastKeeperMessage?.sentAt
    };
  }

  const lastKeeperMessageAt = input.state.lastKeeperMessage?.sentAt;
  if (!lastKeeperMessageAt) {
    return { canSpeak: true, reason: "player-turn", cooldownSeconds };
  }

  const eventMs = timestampMs(input.notification.timestamp);
  const lastKeeperMs = timestampMs(lastKeeperMessageAt);
  if (
    Number.isFinite(eventMs) &&
    Number.isFinite(lastKeeperMs) &&
    eventMs - lastKeeperMs < autonomousKeeperCooldownMs
  ) {
    return {
      canSpeak: false,
      reason: "cooldown",
      cooldownSeconds,
      lastKeeperMessageAt
    };
  }

  return {
    canSpeak: true,
    reason: "player-turn",
    cooldownSeconds,
    lastKeeperMessageAt
  };
}

function formatDecisionForGroupTransport(decision: GameKeeperDecision): GameKeeperDecision {
  if (!decision.keeperMessage) {
    return decision;
  }

  return {
    ...decision,
    keeperMessage: formatKeeperMessageForGroupChat(decision.keeperMessage)
  };
}

function rollResultPrefix(result: ReturnType<typeof resolvePbtARoll>): string {
  return `(Outcome: ${rollOutcomeSummary(result)}.)`;
}

function fallbackPostRollNarration(result: ReturnType<typeof resolvePbtARoll>): PostRollKeeperNarration {
  const summary = rollOutcomeSummary(result);
  return {
    keeperMessage:
      summary === "success" || summary === "perfect success"
        ? "The action lands cleanly, and the scene opens a little wider."
        : "The consequence lands immediately, and the situation turns worse."
  };
}

function completionKeeperMessage(state: GroupCampaignState): string {
  const clueCount = state.discoveredClueIds.length;
  const noteCount = state.notes.length;
  const detail =
    clueCount > 0 || noteCount > 0 ? ` ${clueCount} clue(s) and ${noteCount} note(s) remain in the case log.` : "";
  return formatKeeperMessageForGroupChat(`The mystery is marked complete.${detail}`);
}

export function formatKeeperMessageForGroupChat(value: string): string {
  const paragraphs = value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean)
    .map(formatKeeperParagraph);

  return paragraphs.join("\n\n").slice(0, 1400);
}

function formatKeeperParagraph(paragraph: string): string {
  if (isAsteriskDelimited(paragraph)) {
    return paragraph;
  }

  return `*${trimOuterAsterisks(paragraph)}*`;
}

function isAsteriskDelimited(value: string): boolean {
  return value.length > 1 && value.startsWith("*") && value.endsWith("*");
}

function trimOuterAsterisks(value: string): string {
  return value.replace(/^\*+/, "").replace(/\*+$/, "").trim();
}

function timestampMs(value: string | null | undefined): number {
  if (!value) {
    return NaN;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
