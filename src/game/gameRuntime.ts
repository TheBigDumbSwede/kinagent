import type { AppConfig } from "../config/types.js";
import type { KindroidGroup } from "../kindroid/client/index.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { SendKindroidGroupMessageResult, UpdateKindroidGroupCurrentSceneResult } from "../kindroid/types.js";
import type { KindroidChatNotification, KindroidGroupChatChangeNotification } from "../firestore/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import { newRequestId } from "../util/ids.js";
import type { Logger } from "../util/logger.js";
import { loadCampaignPacks, type LoadedCampaignPack } from "./campaignPack.js";
import { CampaignStateStore, type GameKeeperDecision, type GroupCampaignState } from "./campaignStateStore.js";
import { parseGameDecisionContent, normalizeGameDecision } from "./gameDecision.js";
import { GroupGamingPreferenceStore, type GamingAutomationMode } from "./groupGamingPreferences.js";

interface HermesChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export interface GameRuntimeOptions {
  config: AppConfig;
  logger: Logger;
  preferences: GroupGamingPreferenceStore;
  campaignStates: CampaignStateStore;
  dedupeStore: DedupeStore;
  kindroidClient?: Pick<KindroidClient, "sendGroupMessage" | "updateGroupCurrentScene">;
  onStateUpdated?: (state: GroupCampaignState) => void;
  onKeeperMessageSent?: (event: GameKeeperMessageSentEvent) => void;
  onPendingDecision?: (state: GroupCampaignState) => void;
}

export interface GameKeeperMessageSentEvent {
  groupId: string;
  groupName: string;
  text: string;
  requestId: string;
  idempotencyKey: string;
  sourceDocumentId: string;
  result: SendKindroidGroupMessageResult;
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

const autonomousKeeperCooldownMs = 30 * 1000;

export class GameRuntime {
  private readonly kindroidClient: Pick<KindroidClient, "sendGroupMessage" | "updateGroupCurrentScene">;

  constructor(private readonly options: GameRuntimeOptions) {
    this.kindroidClient = options.kindroidClient ?? new KindroidClient(options.config, options.logger);
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

    if (!this.options.config.hermes.enabled || !this.options.config.hermes.apiKey) {
      this.options.logger.warn("Group Gaming event skipped because Hermes is not configured.", {
        groupId: group.groupId,
        documentId: notification.documentId
      });
      return emptyGameGroupChatResult();
    }

    const currentState = this.options.campaignStates.ensureInitialized({
      groupId: group.groupId,
      campaign,
      mysteryId: preference.mysteryId
    });
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
      this.options.logger.info("Group Gaming event handled without mutation by event policy.", {
        groupId: group.groupId,
        documentId: notification.documentId,
        sender: notification.sender,
        role: notification.role,
        automationMode: preference.automationMode
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
      role: notification.role
    });
    const decision = await this.requestGameDecision({
      group,
      notification,
      campaign,
      state: currentState,
      automationMode: preference.automationMode,
      keeperSpeechPacing
    });
    const eventFilteredDecision = applyGameEventPolicy(decision, eventPolicy);
    const policyDecision = formatDecisionForGroupTransport(
      decisionForPolicy(eventFilteredDecision, preference.automationMode)
    );
    const pacedDecision = applyKeeperSpeechPacing(policyDecision, preference.automationMode, keeperSpeechPacing);
    const updated = this.options.campaignStates.applyDecision({
      groupId: group.groupId,
      campaign,
      mysteryId: currentState.mysteryId,
      sourceDocumentId: notification.documentId,
      automationMode: preference.automationMode,
      decision: pacedDecision
    });
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
      pendingDecision: Boolean(updated.pendingDecision)
    });
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

    const sent = await this.sendKeeperMessage(
      group,
      state.pendingDecision.sourceDocumentId,
      state.pendingDecision.keeperMessage,
      {
        source: "approved-suggestion"
      }
    );
    if (!sent) {
      throw new Error("Keeper suggestion could not be sent to the Group.");
    }

    const updated = this.options.campaignStates.getForGroup(group.groupId);
    if (!updated) {
      throw new Error("Group campaign state was not available after sending the Keeper suggestion.");
    }
    return updated;
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

  private async sendKeeperMessage(
    group: KindroidGroup,
    sourceDocumentId: string,
    message: string,
    input: { source: "autonomous" | "approved-suggestion" }
  ): Promise<boolean> {
    const requestId = newRequestId();
    const idempotencyKey = newRequestId();
    const result = await this.sendKeeperGroupMessage({
      groupId: group.groupId,
      message,
      requestId,
      idempotencyKey
    });
    this.options.logger.info("Group Gaming Keeper message sent.", {
      groupId: group.groupId,
      groupName: group.name,
      sourceDocumentId,
      source: input.source,
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
      await this.syncKeeperMessageToGroupCurrentScene(group, sourceDocumentId, message);
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

    return result.ok;
  }

  private async sendKeeperGroupMessage(input: {
    groupId: string;
    message: string;
    requestId: string;
    idempotencyKey: string;
  }): Promise<SendKindroidGroupMessageResult> {
    try {
      return await this.kindroidClient.sendGroupMessage({
        ...input,
        triggerAiResponse: false
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

  private async syncKeeperMessageToGroupCurrentScene(
    group: KindroidGroup,
    sourceDocumentId: string,
    message: string
  ): Promise<void> {
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

function emptyGameGroupChatResult(): GameGroupChatResult {
  return {
    gameHandled: false,
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

function gamePromptPayload(input: {
  group: KindroidGroup;
  notification: KindroidGroupChatChangeNotification;
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
    mystery,
    state: input.state
  };
}

function decisionForPolicy(decision: GameKeeperDecision, mode: GamingAutomationMode): GameKeeperDecision {
  if (mode === "observe") {
    return {
      stateChanges: decision.stateChanges,
      confidence: decision.confidence,
      reason: decision.reason
    };
  }

  return decision;
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
    rollRequest: undefined,
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

function keeperMessageCurrentScene(message: string, maxLength: number): string {
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
