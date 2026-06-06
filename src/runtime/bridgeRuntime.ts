import { extractFirebaseAppCheckState, loadBrowserSession, summarizeSessionAuth } from "../auth/firebaseSession.js";
import { captureDocument } from "../capture/capturedValue.js";
import { captureKindroidState, type CaptureKindroidStateResult } from "../capture/kinStateCapture.js";
import {
  ChatDynamismSuggestionStore,
  type ChatDynamismSuggestion
} from "../chatDynamism/chatDynamismSuggestionStore.js";
import type { AppConfig } from "../config/types.js";
import { FirestoreRestClient } from "../firestore/firestoreRestClient.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { isRecentOutboundEcho } from "../firestore/messageDedupe.js";
import { mapKindroidMessage } from "../firestore/messageMapper.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { createHermesAdapter } from "../hermes/hermesAdapter.js";
import type { ScopedSoundscapeUpdate } from "../hermes/soundscapeActionHandler.js";
import type { HermesAdapter } from "../hermes/types.js";
import {
  defaultChatDynamismBounds,
  noticeableChatDynamismDelta,
  practicalChatDynamismBounds,
  recommendedChatDynamismStartingValue
} from "../kindroid/chatDynamism.js";
import { JournalSuggestionStore, type JournalSuggestion } from "../journal/journalSuggestionStore.js";
import { KindroidApiClient, type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import { groupChatMessagesPath, kinChatMessagesPath } from "../kindroid/client/firestorePaths.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import type { Logger } from "../util/logger.js";
import { GroupSubscriptionSupervisor, type GroupSubscriptionStatus } from "./groupSubscriptionSupervisor.js";
import { KindroidSessionKeepAlive, type KindroidSessionKeepAliveEvent } from "./kindroidSessionKeepAlive.js";
import {
  KinSubscriptionSupervisor,
  type KinMonitorStopReason,
  type KinSubscriptionStatus
} from "./kinSubscriptionSupervisor.js";
import { SoundscapePrewarmCoordinator } from "./soundscapePrewarmCoordinator.js";
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
  | { channel: "soundscape-updated"; payload: ScopedSoundscapeUpdate }
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
  private readonly soundscapePrewarm: SoundscapePrewarmCoordinator;
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
      onSoundscapeUpdated: (update) => {
        this.soundscapePrewarm.markReady(update);
        this.emit({ channel: "soundscape-updated", payload: update });
      },
      isSoundscapeEnabled: (notification) => this.soundscapePrewarm.isEnabled(notification),
      isChatDynamismEnabled: (aiId) => this.kinSubscriptionSupervisor.kinChatDynamismPreference(aiId).enabled,
      chatDynamismRange: (aiId) => {
        const preference = this.kinSubscriptionSupervisor.kinChatDynamismPreference(aiId);
        return { min: preference.min, max: preference.max };
      },
      chatDynamismContextProvider: async (notification) => this.chatDynamismContext(notification),
      soundscapeContextProvider: async (notification) => this.soundscapePrewarm.context(notification)
    });
    this.soundscapePrewarm = new SoundscapePrewarmCoordinator({
      config: options.config,
      logger: options.logger,
      hermes: this.hermes,
      isKinSoundscapeEnabled: (kinId) => this.kinSubscriptionSupervisor.kinSoundscapePreference(kinId).enabled,
      isGroupSoundscapeEnabled: (groupId) =>
        this.groupSubscriptionSupervisor.groupSoundscapePreference(groupId).enabled,
      isKnownKin: (kinId) =>
        this.kinSubscriptionSupervisor.statuses().some((subscription) => subscription.kin.aiId === kinId)
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
        void this.soundscapePrewarm.prewarmKin(kin, "monitor-started");
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

  setKinSoundscapePreference(kinId: string, preference: Partial<KinSoundscapePreference>): KinSoundscapePreference {
    const saved = this.kinSubscriptionSupervisor.setKinSoundscapePreference(kinId, preference);
    const status = this.kinSubscriptionSupervisor.statuses().find((subscription) => subscription.kin.aiId === kinId);
    this.soundscapePrewarm.onKinPreferenceChanged(status?.kin ?? null, saved.enabled);
    return saved;
  }

  getKinSoundscapePreference(kinId: string): KinSoundscapePreference {
    if (!kinId) {
      throw new Error("Select a Kin before editing soundscape.");
    }

    return this.kinSubscriptionSupervisor.kinSoundscapePreference(kinId);
  }

  async setGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
    await this.groupSubscriptionSupervisor.setGroupEnabled(groupId, enabled);
  }

  setGroupSoundscapePreference(
    groupId: string,
    preference: Partial<GroupSoundscapePreference>
  ): GroupSoundscapePreference {
    const saved = this.groupSubscriptionSupervisor.setGroupSoundscapePreference(groupId, preference);
    const status = this.groupSubscriptionSupervisor
      .statuses()
      .find((subscription) => subscription.group.groupId === groupId);
    this.soundscapePrewarm.onGroupPreferenceChanged(status?.group ?? null, saved.enabled);
    return saved;
  }

  getGroupSoundscapePreference(groupId: string): GroupSoundscapePreference {
    if (!groupId) {
      throw new Error("Select a Group before editing soundscape.");
    }

    return this.groupSubscriptionSupervisor.groupSoundscapePreference(groupId);
  }

  pendingJournalSuggestions(): JournalSuggestion[] {
    return this.journalSuggestions.listReviewable();
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

    await this.ensureJournalSuggestionSourceExists(suggestion);

    const mutationStartedAt = new Date().toISOString();
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
    const createdJournalEntry =
      action === "create" ? await this.resolveCreatedJournalEntry(suggestion, mutationStartedAt) : null;
    const accepted = this.journalSuggestions.markAccepted(
      id,
      {
        ok: result.ok,
        status: result.status,
        responseText: result.responseText,
        captureCommitHash: capture.commitHash,
        captureCreatedCommit: capture.createdCommit
      },
      createdJournalEntry
    );
    this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    this.emit({ channel: "identity-capture-completed", payload: capture });
    return accepted;
  }

  async deleteInvalidatedJournalSuggestion(id: string): Promise<JournalSuggestion> {
    const suggestion = this.journalSuggestions.get(id);
    if (!suggestion) {
      throw new Error("Journal suggestion not found.");
    }
    if (suggestion.status !== "source_invalidated") {
      throw new Error("Journal suggestion is not awaiting source-invalidation review.");
    }
    if ((suggestion.action ?? "create") !== "create") {
      throw new Error("Only accepted journal-create suggestions can delete a created journal entry.");
    }
    if (!suggestion.createdJournalEntryId) {
      throw new Error("Cannot delete invalidated journal entry because no created journal entry id was resolved.");
    }

    const client = new KindroidClient(this.options.config, this.options.logger);
    const result = await client.deleteJournalEntry({
      aiId: suggestion.aiId,
      id: suggestion.createdJournalEntryId
    });
    if (!result.ok) {
      throw new Error(`Kindroid journal-delete failed with HTTP ${result.status}.`);
    }

    const capture = await captureKindroidState(this.options.config, this.options.logger, {
      message: `Capture Kindroid invalidated journal deletion ${suggestion.aiId}`
    });
    const remediated = this.journalSuggestions.markRemediated(id, "delete_created_journal_entry", {
      ok: result.ok,
      status: result.status,
      responseText: result.responseText,
      captureCommitHash: capture.commitHash,
      captureCreatedCommit: capture.createdCommit
    });
    this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    this.emit({ channel: "identity-capture-completed", payload: capture });
    return remediated;
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
        void this.soundscapePrewarm.prewarmKin(kin, "activity");
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
      },
      onMessageDeleted: async (message) => {
        this.handleDirectMessageDeleted(kin, message.id, message.timestamp ?? null);
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
        void this.soundscapePrewarm.prewarmGroup(group, notification, "activity");
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
      },
      onDocumentDeleted: async (document) => {
        this.handleGroupMessageDeleted(group, document.id, document.readTime ?? null);
      }
    });
  }

  private handleDirectMessageDeleted(kin: KindroidKin, documentId: string, timestamp: string | null): void {
    this.emit({
      channel: "monitor-line",
      payload: {
        type: "kindroid.chat.deleted",
        id: documentId,
        kinId: kin.aiId,
        kinName: kin.name,
        timestamp,
        source: "firestore"
      }
    });

    const changedJournalSuggestions = this.journalSuggestions.markSourceDeleted({
      documentId,
      aiId: kin.aiId
    });
    const staleChatDynamismSuggestions = this.chatDynamismSuggestions.markSourceDeleted({
      documentId,
      aiId: kin.aiId
    });
    if (changedJournalSuggestions.length > 0) {
      this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    }
    if (changedJournalSuggestions.length > 0 || staleChatDynamismSuggestions.length > 0) {
      this.options.logger.info("Marked source-backed suggestions after source message deletion.", {
        scope: "direct",
        aiId: kin.aiId,
        documentId,
        staleJournalSuggestions: changedJournalSuggestions.filter((suggestion) => suggestion.status === "stale").length,
        invalidatedJournalSuggestions: changedJournalSuggestions.filter(
          (suggestion) => suggestion.status === "source_invalidated"
        ).length,
        chatDynamismSuggestions: staleChatDynamismSuggestions.length
      });
    }
  }

  private handleGroupMessageDeleted(group: KindroidGroup, documentId: string, timestamp: string | null): void {
    this.emit({
      channel: "monitor-line",
      payload: {
        type: "kindroid.chat.deleted",
        id: documentId,
        groupId: group.groupId,
        groupName: group.name,
        timestamp,
        source: "firestore"
      }
    });

    const changedJournalSuggestions = this.journalSuggestions.markSourceDeleted({
      documentId,
      groupId: group.groupId
    });
    if (changedJournalSuggestions.length > 0) {
      this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
      this.options.logger.info("Marked source-backed journal suggestions after source message deletion.", {
        scope: "group",
        groupId: group.groupId,
        documentId,
        staleJournalSuggestions: changedJournalSuggestions.filter((suggestion) => suggestion.status === "stale").length,
        invalidatedJournalSuggestions: changedJournalSuggestions.filter(
          (suggestion) => suggestion.status === "source_invalidated"
        ).length
      });
    }
  }

  private async ensureJournalSuggestionSourceExists(suggestion: JournalSuggestion): Promise<void> {
    const restClient = new FirestoreRestClient(this.options.config, this.options.logger);
    const documentPath = await this.journalSuggestionSourcePath(restClient, suggestion);
    if (!documentPath) {
      return;
    }

    const document = await restClient.getDocument(documentPath);
    if (document) {
      return;
    }

    this.journalSuggestions.markSourceDeleted({
      documentId: suggestion.documentId,
      aiId: suggestion.source === "direct" ? suggestion.aiId : undefined,
      groupId: suggestion.source === "group" ? suggestion.groupId : undefined
    });
    this.emit({ channel: "journal-suggestions-updated", payload: this.pendingJournalSuggestions() });
    throw new Error("Journal suggestion source message has been deleted or rewound; suggestion was marked stale.");
  }

  private async journalSuggestionSourcePath(
    restClient: FirestoreRestClient,
    suggestion: JournalSuggestion
  ): Promise<string | null> {
    if (!suggestion.documentId) {
      return null;
    }

    const uid = await restClient.resolveUid();
    if (suggestion.source === "group") {
      return suggestion.groupId ? `${groupChatMessagesPath(uid, suggestion.groupId)}/${suggestion.documentId}` : null;
    }

    return `${kinChatMessagesPath(uid, suggestion.aiId)}/${suggestion.documentId}`;
  }

  private async resolveCreatedJournalEntry(
    suggestion: JournalSuggestion,
    mutationStartedAt: string
  ): Promise<{ id: string; created?: string; resolvedAt: string } | null> {
    const restClient = new FirestoreRestClient(this.options.config, this.options.logger);
    const uid = await restClient.resolveUid();
    const documents = await restClient.listDocuments({
      collectionPath: `Users/${uid}/AIs/${suggestion.aiId}/JournalV3`,
      pageSize: 25,
      maxDocuments: 25,
      orderBy: "created desc",
      logLabel: "journal.resolveCreatedEntry"
    });
    const matches = documents
      .map((document) => captureDocument(document, uid, ["id", "entry", "keyphrases", "created", "is_global"]))
      .filter((entry) => {
        const entryText = fieldString(entry.fields.entry?.value);
        const keyphrases = fieldStringArray(entry.fields.keyphrases?.value);
        return (
          normalizedText(entryText) === normalizedText(suggestion.entry) &&
          sameStringSet(keyphrases, suggestion.keyphrases)
        );
      })
      .map((entry) => ({
        id: entry.id,
        created: fieldString(entry.fields.created?.value) || entry.createTime || entry.updateTime
      }));
    if (matches.length === 1) {
      return { ...matches[0], resolvedAt: new Date().toISOString() };
    }

    const mutationStartedMs = Date.parse(mutationStartedAt);
    const recentMatches = Number.isFinite(mutationStartedMs)
      ? matches.filter((entry) => {
          const createdMs = entry.created ? Date.parse(entry.created) : NaN;
          return Number.isFinite(createdMs) && createdMs >= mutationStartedMs - 5 * 60 * 1000;
        })
      : [];
    if (recentMatches.length === 1) {
      return { ...recentMatches[0], resolvedAt: new Date().toISOString() };
    }

    this.options.logger.warn("Accepted journal entry id could not be resolved unambiguously.", {
      aiId: suggestion.aiId,
      suggestionId: suggestion.id,
      matchCount: matches.length,
      recentMatchCount: recentMatches.length
    });
    return null;
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

export interface KinSoundscapePreference {
  enabled: boolean;
}

export interface GroupSoundscapePreference {
  enabled: boolean;
}

export type BridgeSessionSummary =
  | (ReturnType<typeof summarizeSessionAuth> & { available: true })
  | { available: false; error: string };

function fieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fieldStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left.map(normalizedText).filter(Boolean));
  const rightSet = new Set(right.map(normalizedText).filter(Boolean));
  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false;
    }
  }
  return true;
}
