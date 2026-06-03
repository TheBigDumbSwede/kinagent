import { extractFirebaseAppCheckState, loadBrowserSession, summarizeSessionAuth } from "../auth/firebaseSession.js";
import { captureKindroidState, type CaptureKindroidStateResult } from "../capture/kinStateCapture.js";
import {
  ChatDynamismSuggestionStore,
  type ChatDynamismSuggestion
} from "../chatDynamism/chatDynamismSuggestionStore.js";
import type { AppConfig } from "../config/types.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { isRecentOutboundEcho } from "../firestore/messageDedupe.js";
import { mapKindroidMessage } from "../firestore/messageMapper.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { createHermesAdapter } from "../hermes/hermesAdapter.js";
import type { HermesAdapter } from "../hermes/types.js";
import {
  defaultChatDynamismBounds,
  noticeableChatDynamismDelta,
  practicalChatDynamismBounds,
  recommendedChatDynamismStartingValue
} from "../kindroid/chatDynamism.js";
import { JournalSuggestionStore, type JournalSuggestion } from "../journal/journalSuggestionStore.js";
import { KindroidApiClient, type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { Logger } from "../util/logger.js";
import { GroupSubscriptionSupervisor, type GroupSubscriptionStatus } from "./groupSubscriptionSupervisor.js";
import { KindroidSessionKeepAlive, type KindroidSessionKeepAliveEvent } from "./kindroidSessionKeepAlive.js";
import {
  KinSubscriptionSupervisor,
  type KinMonitorStopReason,
  type KinSubscriptionStatus
} from "./kinSubscriptionSupervisor.js";
import { VoiceRuntime, voiceProviderConfigured } from "../voice/voiceRuntime.js";
import type { VoicePlaybackChunk } from "../voice/types.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import { createDedupeStore } from "../state/sqliteStore.js";

export type BridgeRuntimeEvent =
  | { channel: "session-keepalive"; payload: KindroidSessionKeepAliveEvent }
  | { channel: "kins-updated"; payload: KinSubscriptionStatus[] }
  | { channel: "kins-refresh-error"; payload: string }
  | { channel: "monitor-started"; payload: { kinId: string; kinName: string } }
  | { channel: "monitor-stopped"; payload: { kinId: string; reason: string } }
  | { channel: "monitor-exit"; payload: { kinId: string; aborted: boolean } }
  | { channel: "monitor-error"; payload: { kinId: string; kinName: string; error: string } }
  | { channel: "groups-updated"; payload: GroupSubscriptionStatus[] }
  | { channel: "groups-refresh-error"; payload: string }
  | { channel: "group-monitor-started"; payload: { groupId: string; groupName: string } }
  | { channel: "group-monitor-stopped"; payload: { groupId: string; reason: string } }
  | { channel: "group-monitor-exit"; payload: { groupId: string; aborted: boolean } }
  | { channel: "group-monitor-error"; payload: { groupId: string; groupName: string; error: string } }
  | { channel: "monitor-line"; payload: Record<string, unknown> }
  | { channel: "journal-suggestion-created"; payload: JournalSuggestion }
  | { channel: "journal-suggestions-updated"; payload: JournalSuggestion[] }
  | { channel: "chat-dynamism-suggestion-created"; payload: ChatDynamismSuggestion }
  | { channel: "identity-capture-completed"; payload: CaptureKindroidStateResult }
  | { channel: "identity-capture-failed"; payload: { error: string } };

export interface BridgeRuntimeOptions {
  config: AppConfig;
  logger: Logger;
  shouldSkipSessionWarm?: () => boolean;
  onVoicePlayback?: (chunk: VoicePlaybackChunk) => void;
  onEvent?: (event: BridgeRuntimeEvent) => void;
}

export class BridgeRuntime {
  readonly hermes: HermesAdapter;
  readonly voice: VoiceRuntime;
  readonly journalSuggestions: JournalSuggestionStore;
  readonly chatDynamismSuggestions: ChatDynamismSuggestionStore;
  private readonly sessionKeepAlive: KindroidSessionKeepAlive;
  private readonly kinSubscriptionSupervisor: KinSubscriptionSupervisor;
  private readonly groupSubscriptionSupervisor: GroupSubscriptionSupervisor;
  private started = false;
  private startupCaptureStarted = false;

  private constructor(
    private readonly options: BridgeRuntimeOptions,
    private readonly dedupeStore: DedupeStore
  ) {
    this.journalSuggestions = JournalSuggestionStore.fromConfig(options.config);
    this.chatDynamismSuggestions = ChatDynamismSuggestionStore.fromConfig(options.config);
    this.hermes = createHermesAdapter(options.config, options.logger, {
      dedupeStore,
      isAmbientContextEnabled: (aiId) => this.kinSubscriptionSupervisor.isKinAmbientContextEnabled(aiId),
      onAmbientContextSent: (event) => {
        this.emit({
          channel: "monitor-line",
          payload: {
            type: "kindroid.hermes_context",
            id: `hermes-${event.requestId}`,
            kinId: event.aiId,
            kinName: this.resolveKinName(event.aiId),
            timestamp: event.timestamp,
            sender: "hermes",
            senderLabel: "Hermes",
            role: null,
            text: event.internetResponse,
            textDecrypted: true,
            textEncrypted: false,
            visibleMessage: event.visibleMessage,
            source: event.source || "hermes",
            reason: event.reason,
            requestId: event.requestId,
            idempotencyKey: event.idempotencyKey
          }
        });
      },
      journalSuggestions: options.config.hermes.journalSuggestions.enabled ? this.journalSuggestions : undefined,
      onJournalSuggestionCreated: (suggestion) => {
        this.emit({ channel: "journal-suggestion-created", payload: suggestion });
        this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
      },
      chatDynamismSuggestions: options.config.hermes.chatDynamism.suggestions.enabled
        ? this.chatDynamismSuggestions
        : undefined,
      onChatDynamismSuggestionCreated: (suggestion) => {
        this.emit({ channel: "chat-dynamism-suggestion-created", payload: suggestion });
      },
      isChatDynamismEnabled: (aiId) => this.kinSubscriptionSupervisor.kinChatDynamismPreference(aiId).enabled,
      chatDynamismRange: (aiId) => {
        const preference = this.kinSubscriptionSupervisor.kinChatDynamismPreference(aiId);
        return { min: preference.min, max: preference.max };
      },
      chatDynamismContextProvider: async (notification) => this.chatDynamismContext(notification)
    });
    this.voice = new VoiceRuntime({
      config: options.config,
      logger: options.logger,
      desktopPlayback: options.onVoicePlayback
    });
    this.sessionKeepAlive = new KindroidSessionKeepAlive({
      config: options.config,
      logger: options.logger,
      shouldSkipWarm: options.shouldSkipSessionWarm,
      onKeepAlive: (event) => {
        this.logKeepAlive(event);
        this.emit({ channel: "session-keepalive", payload: event });
      }
    });
    this.kinSubscriptionSupervisor = new KinSubscriptionSupervisor({
      config: options.config,
      logger: options.logger,
      startKin: async (kin, monitorOptions) => this.startKinMonitor(kin, monitorOptions),
      onKinsUpdated: (statuses) => {
        this.options.logger.info("Kin subscriptions reconciled.", {
          total: statuses.length,
          running: statuses.filter((status) => status.running).length,
          disabled: statuses.filter((status) => !status.enabled).length
        });
        this.emit({ channel: "kins-updated", payload: statuses });
      },
      onRefreshError: (error) => {
        this.options.logger.warn("Kin subscription refresh failed.", { error });
        this.emit({ channel: "kins-refresh-error", payload: error });
      },
      onMonitorStarted: (kin) => {
        this.emit({ channel: "monitor-started", payload: { kinId: kin.aiId, kinName: kin.name } });
      },
      onMonitorStopped: (kinId, reason) => {
        this.emit({ channel: "monitor-stopped", payload: { kinId, reason } });
      },
      onMonitorExited: (kinId, aborted) => {
        this.emit({ channel: "monitor-exit", payload: { kinId, aborted } });
      },
      onMonitorError: (kin, error) => {
        this.options.logger.error("Kin listener failed.", { name: kin.name, aiId: kin.aiId, error });
        this.emit({ channel: "monitor-error", payload: { kinId: kin.aiId, kinName: kin.name, error } });
      }
    });
    this.groupSubscriptionSupervisor = new GroupSubscriptionSupervisor({
      config: options.config,
      logger: options.logger,
      startGroup: async (group, monitorOptions) => this.startGroupMonitor(group, monitorOptions),
      onGroupsUpdated: (statuses) => {
        this.options.logger.info("Group subscriptions reconciled.", {
          total: statuses.length,
          running: statuses.filter((status) => status.running).length,
          disabled: statuses.filter((status) => !status.enabled).length
        });
        this.emit({ channel: "groups-updated", payload: statuses });
      },
      onRefreshError: (error) => {
        this.options.logger.warn("Group subscription refresh failed.", { error });
        this.emit({ channel: "groups-refresh-error", payload: error });
      },
      onMonitorStarted: (group) => {
        this.emit({ channel: "group-monitor-started", payload: { groupId: group.groupId, groupName: group.name } });
      },
      onMonitorStopped: (groupId, reason) => {
        this.emit({ channel: "group-monitor-stopped", payload: { groupId, reason } });
      },
      onMonitorExited: (groupId, aborted) => {
        this.emit({ channel: "group-monitor-exit", payload: { groupId, aborted } });
      },
      onMonitorError: (group, error) => {
        this.options.logger.error("Group chat listener failed.", { name: group.name, groupId: group.groupId, error });
        this.emit({
          channel: "group-monitor-error",
          payload: { groupId: group.groupId, groupName: group.name, error }
        });
      }
    });
  }

  static async create(options: BridgeRuntimeOptions): Promise<BridgeRuntime> {
    const dedupeStore = await createDedupeStore(
      options.config.bridge.sqlitePath,
      options.config.bridge.dedupeWindowSeconds
    );
    return new BridgeRuntime(options, dedupeStore);
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.sessionKeepAlive.start();
    this.kinSubscriptionSupervisor.start();
    this.groupSubscriptionSupervisor.start();
    this.startIdentityCapture();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.kinSubscriptionSupervisor.stop();
    this.groupSubscriptionSupervisor.stop();
    this.sessionKeepAlive.stop();
  }

  async refreshKins(): Promise<void> {
    await this.kinSubscriptionSupervisor.refresh();
  }

  async refreshGroups(): Promise<void> {
    await this.groupSubscriptionSupervisor.refresh();
  }

  startKnownKin(kinId: string, pageSize?: number): void {
    this.kinSubscriptionSupervisor.startKnownKin(kinId, pageSize);
  }

  stopAllKins(reason: KinMonitorStopReason = "manual"): void {
    this.kinSubscriptionSupervisor.stopAll(reason);
  }

  async setKinEnabled(kinId: string, enabled: boolean): Promise<void> {
    await this.kinSubscriptionSupervisor.setKinEnabled(kinId, enabled);
  }

  setKinAmbientContextEnabled(kinId: string, enabled: boolean): KinAmbientContextPreference {
    this.kinSubscriptionSupervisor.setKinAmbientContextEnabled(kinId, enabled);
    return this.getKinAmbientContextPreference(kinId);
  }

  getKinAmbientContextPreference(kinId: string): KinAmbientContextPreference {
    if (!kinId) {
      throw new Error("Select a Kin before editing ambient context.");
    }

    return {
      ok: true,
      enabled: this.kinSubscriptionSupervisor.isKinAmbientContextEnabled(kinId)
    };
  }

  setKinChatDynamismPreference(
    kinId: string,
    preference: Partial<KinChatDynamismPreference>
  ): KinChatDynamismPreference {
    return this.kinSubscriptionSupervisor.setKinChatDynamismPreference(kinId, preference);
  }

  getKinChatDynamismPreference(kinId: string): KinChatDynamismPreference {
    if (!kinId) {
      throw new Error("Select a Kin before editing Chat Dynamism.");
    }

    return this.kinSubscriptionSupervisor.kinChatDynamismPreference(kinId);
  }

  async setGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
    await this.groupSubscriptionSupervisor.setGroupEnabled(groupId, enabled);
  }

  pendingJournalSuggestions(): JournalSuggestion[] {
    return this.journalSuggestions.list("pending");
  }

  dismissJournalSuggestion(id: string): JournalSuggestion {
    const suggestion = this.journalSuggestions.markDismissed(id);
    this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    return suggestion;
  }

  async acceptJournalSuggestion(id: string): Promise<JournalSuggestion> {
    const suggestion = this.journalSuggestions.get(id);
    if (!suggestion) {
      throw new Error("Journal suggestion not found.");
    }
    if (suggestion.status !== "pending") {
      throw new Error("Journal suggestion has already been handled.");
    }

    const client = new KindroidClient(this.options.config, this.options.logger);
    const action = suggestion.action ?? "create";
    const result =
      action === "delete"
        ? await client.deleteJournalEntry({
            aiId: suggestion.aiId,
            id: suggestion.targetJournalEntryId ?? ""
          })
        : await client.createJournalEntry({
            aiId: suggestion.aiId,
            entry: suggestion.entry,
            keyphrases: suggestion.keyphrases
          });
    if (!result.ok) {
      throw new Error(
        `Kindroid journal-${action === "delete" ? "delete" : "create"} failed with HTTP ${result.status}.`
      );
    }

    const capture = await captureKindroidState(this.options.config, this.options.logger, {
      message:
        action === "delete"
          ? `Capture Kindroid journal deletion ${suggestion.aiId}`
          : `Capture Kindroid journal entry ${suggestion.aiId}`
    });
    const accepted = this.journalSuggestions.markAccepted(id, {
      ok: result.ok,
      status: result.status,
      responseText: result.responseText,
      captureCommitHash: capture.commitHash,
      captureCreatedCommit: capture.createdCommit
    });
    this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    this.emit({ channel: "identity-capture-completed", payload: capture });
    return accepted;
  }

  status(): BridgeRuntimeStatus {
    const session = this.loadSessionSummary();
    const appCheck = session.available
      ? extractFirebaseAppCheckState(loadBrowserSession(this.options.config.bridge.sessionDir).storageState)
      : null;
    const kinStatuses = this.kinSubscriptionSupervisor.statuses();
    const groupStatuses = this.groupSubscriptionSupervisor.statuses();

    return {
      monitorRunning:
        this.kinSubscriptionSupervisor.runningCount() + this.groupSubscriptionSupervisor.runningCount() > 0,
      config: {
        firebaseProjectId: this.options.config.kindroid.firebaseProjectId,
        sessionDir: this.options.config.bridge.sessionDir,
        configuredKins: this.options.config.kindroid.kins
      },
      session,
      appCheckPresent: Boolean(appCheck?.token),
      kins: kinStatuses.map((subscription) => subscription.kin),
      subscriptions: kinStatuses,
      kinRefresh: this.kinSubscriptionSupervisor.refreshState(),
      groups: groupStatuses.map((subscription) => subscription.group),
      groupSubscriptions: groupStatuses,
      groupRefresh: this.groupSubscriptionSupervisor.refreshState(),
      voice: {
        ...voiceProviderConfigured(this.options.config),
        desktopPlayback: Boolean(this.options.onVoicePlayback)
      },
      journalSuggestions: this.pendingJournalSuggestions()
    };
  }

  private async startKinMonitor(kin: KindroidKin, monitorOptions: { pageSize: number; signal: AbortSignal }) {
    this.options.logger.info("Starting discovered Kin listener.", { name: kin.name, aiId: kin.aiId });
    const monitor = new KindroidLiveMonitor(this.options.config, this.options.logger);
    await monitor.start({
      kinId: kin.aiId,
      pageSize: monitorOptions.pageSize,
      signal: monitorOptions.signal,
      onMessage: async (message) => {
        if (
          await isRecentOutboundEcho({
            dedupeStore: this.dedupeStore,
            logger: this.options.logger,
            message,
            scope: "direct"
          })
        ) {
          return;
        }

        this.emit({ channel: "monitor-line", payload: { ...message, kinName: kin.name } });
        this.voice.enqueue({
          id: message.id,
          kinId: kin.aiId,
          kinName: kin.name,
          sender: message.sender,
          role: message.role,
          text: message.text,
          textEncrypted: message.textEncrypted,
          textDecrypted: message.textDecrypted,
          textDecryptionError: message.textDecryptionError
        });
        await this.hermes.handleChatChanged({
          type: "kindroid.chat.changed",
          kinId: kin.aiId,
          documentId: message.id,
          timestamp: message.timestamp,
          text: message.text,
          textEncrypted: message.textEncrypted,
          textDecrypted: message.textDecrypted,
          textDecryptionError: message.textDecryptionError,
          sender: message.sender,
          role: message.role,
          source: "firestore"
        });
      }
    });
  }

  private async startGroupMonitor(group: KindroidGroup, monitorOptions: { pageSize: number; signal: AbortSignal }) {
    this.options.logger.info("Starting discovered group chat listener.", { name: group.name, groupId: group.groupId });
    const client = new KindroidApiClient(this.options.config, this.options.logger);
    const decryptionKey = this.resolveDecryptionKey();
    await client.groupChats.listenMessages({
      groupId: group.groupId,
      pageSize: monitorOptions.pageSize,
      signal: monitorOptions.signal,
      onDocument: async (document) => {
        const data = document.data();
        const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
        const aiId = typeof record.ai_id === "string" && record.ai_id.length > 0 ? record.ai_id : group.groupId;
        const kinName = this.resolveKinName(aiId);
        const message = mapKindroidMessage(document, aiId, { decryptionKey });
        if (
          await isRecentOutboundEcho({
            dedupeStore: this.dedupeStore,
            logger: this.options.logger,
            message,
            scope: "group"
          })
        ) {
          return;
        }

        const notification: KindroidChatNotification = {
          type: "kindroid.group_chat.changed",
          groupId: group.groupId,
          aiId,
          documentId: message.id,
          timestamp: message.timestamp,
          text: message.text,
          textEncrypted: message.textEncrypted,
          textDecrypted: message.textDecrypted,
          textDecryptionError: message.textDecryptionError,
          sender: message.sender,
          role: message.role,
          source: "firestore"
        };

        this.emit({
          channel: "monitor-line",
          payload: {
            type: "kindroid.chat.message",
            id: message.id,
            kinId: message.kinId,
            kinName,
            groupId: group.groupId,
            groupName: group.name,
            timestamp: message.timestamp,
            sender: message.sender,
            role: message.role,
            text: message.text,
            textEncrypted: message.textEncrypted,
            textDecrypted: message.textDecrypted,
            textDecryptionError: message.textDecryptionError,
            source: "firestore"
          }
        });
        this.voice.enqueue({
          id: message.id,
          kinId: aiId,
          kinName,
          groupId: group.groupId,
          groupName: group.name,
          sender: message.sender,
          role: message.role,
          text: message.text,
          textEncrypted: message.textEncrypted,
          textDecrypted: message.textDecrypted,
          textDecryptionError: message.textDecryptionError
        });
        await this.hermes.handleChatChanged(notification);
      }
    });
  }

  private resolveKinName(aiId: string): string {
    return this.kinSubscriptionSupervisor.statuses().find((status) => status.kin.aiId === aiId)?.kin.name || aiId;
  }

  private async chatDynamismContext(notification: KindroidChatNotification): Promise<unknown> {
    if (notification.type !== "kindroid.chat.changed") {
      return undefined;
    }

    const status = this.kinSubscriptionSupervisor
      .statuses()
      .find((subscription) => subscription.kin.aiId === notification.kinId);
    const preference = this.kinSubscriptionSupervisor.kinChatDynamismPreference(notification.kinId);
    return {
      displayName: "Chat Dynamism",
      fieldName: "user_set_temperature",
      enabledForKin: preference.enabled,
      allowedRange: {
        min: preference.min,
        max: preference.max
      },
      hardLimits: {
        min: defaultChatDynamismBounds.min,
        max: defaultChatDynamismBounds.max,
        step: defaultChatDynamismBounds.step
      },
      practicalRange: {
        min: practicalChatDynamismBounds.min,
        max: practicalChatDynamismBounds.max
      },
      recommendedStartingValue: recommendedChatDynamismStartingValue,
      deltaGuidance: {
        noticeableBase: noticeableChatDynamismDelta,
        slight: noticeableChatDynamismDelta,
        moderate: Number((noticeableChatDynamismDelta * 2).toFixed(2)),
        strong: Number((noticeableChatDynamismDelta * 3).toFixed(2)),
        severe: Number((noticeableChatDynamismDelta * 4).toFixed(2)),
        rule: "A 0.05 move either way is the recommended noticeable base adjustment. Choose the smallest delta that fits the repeated pattern; larger moves require stronger, repeated evidence."
      },
      currentValue: status?.kin.chatDynamism,
      reasoningEffort: status?.kin.reasoningEffort,
      llmFlair: status?.kin.llmFlair,
      mutation: "reviewed-suggestion-only"
    };
  }

  private resolveDecryptionKey(): string {
    if (this.options.config.kindroid.uid) {
      return this.options.config.kindroid.uid;
    }

    const session = loadBrowserSession(this.options.config.bridge.sessionDir);
    const uid = session.firebaseAuth?.uid;
    if (!uid) {
      throw new Error(
        "Cannot decrypt live messages without a Firebase UID. Run npm run session-info to verify the saved session."
      );
    }

    return uid;
  }

  private loadSessionSummary(): BridgeSessionSummary {
    try {
      const session = loadBrowserSession(this.options.config.bridge.sessionDir);
      return {
        available: true as const,
        ...summarizeSessionAuth(session.storageState)
      };
    } catch (error) {
      return {
        available: false as const,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private logKeepAlive(event: KindroidSessionKeepAliveEvent): void {
    if (event.ok) {
      this.options.logger.info("Kindroid session keepalive completed.", {
        warmed: event.warmed,
        method: event.method,
        uidPresent: event.uidPresent,
        expirationIso: event.expirationIso
      });
      return;
    }

    this.options.logger.warn("Kindroid session keepalive failed.", { error: event.error });
  }

  private startIdentityCapture(): void {
    if (this.startupCaptureStarted || process.env.KINAGENT_DESKTOP_SMOKE === "1") {
      return;
    }

    this.startupCaptureStarted = true;
    void captureKindroidState(this.options.config, this.options.logger)
      .then((result) => {
        this.options.logger.info("Kindroid identity capture completed.", {
          outputDir: result.outputDir,
          committed: result.committed,
          createdCommit: result.createdCommit,
          commitHash: result.commitHash,
          kinCount: result.kinCount,
          groupCount: result.groupCount,
          kinJournalEntryCount: result.kinJournalEntryCount,
          globalJournalEntryCount: result.globalJournalEntryCount
        });
        this.emit({ channel: "identity-capture-completed", payload: result });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.options.logger.warn("Kindroid identity capture failed.", { error: message });
        this.emit({ channel: "identity-capture-failed", payload: { error: message } });
      });
  }

  private emit(event: BridgeRuntimeEvent): void {
    this.options.onEvent?.(event);
  }
}

export interface BridgeRuntimeStatus {
  monitorRunning: boolean;
  config: {
    firebaseProjectId: string;
    sessionDir: string;
    configuredKins: AppConfig["kindroid"]["kins"];
  };
  session: BridgeSessionSummary;
  appCheckPresent: boolean;
  kins: KindroidKin[];
  subscriptions: KinSubscriptionStatus[];
  kinRefresh: ReturnType<KinSubscriptionSupervisor["refreshState"]>;
  groups: KindroidGroup[];
  groupSubscriptions: GroupSubscriptionStatus[];
  groupRefresh: ReturnType<GroupSubscriptionSupervisor["refreshState"]>;
  voice: ReturnType<typeof voiceProviderConfigured> & { desktopPlayback: boolean };
  journalSuggestions: JournalSuggestion[];
}

export interface KinAmbientContextPreference {
  ok: true;
  enabled: boolean;
}

export interface KinChatDynamismPreference {
  enabled: boolean;
  min: number;
  max: number;
}

export type BridgeSessionSummary =
  | (ReturnType<typeof summarizeSessionAuth> & { available: true })
  | { available: false; error: string };
