import { extractFirebaseAppCheckState, loadBrowserSession, summarizeSessionAuth } from "../auth/firebaseSession.js";
import type { AppConfig } from "../config/types.js";
import { KindroidLiveMonitor } from "../firestore/liveMonitor.js";
import { mapKindroidMessage } from "../firestore/messageMapper.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { createHermesAdapter } from "../hermes/hermesAdapter.js";
import type { HermesAdapter } from "../hermes/types.js";
import { KindroidApiClient, type KindroidGroup, type KindroidKin } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import { GroupSubscriptionSupervisor, type GroupSubscriptionStatus } from "./groupSubscriptionSupervisor.js";
import { KindroidSessionKeepAlive, type KindroidSessionKeepAliveEvent } from "./kindroidSessionKeepAlive.js";
import {
  KinSubscriptionSupervisor,
  type KinMonitorStopReason,
  type KinSubscriptionStatus
} from "./kinSubscriptionSupervisor.js";

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
  | { channel: "monitor-line"; payload: Record<string, unknown> };

export interface BridgeRuntimeOptions {
  config: AppConfig;
  logger: Logger;
  shouldSkipSessionWarm?: () => boolean;
  onEvent?: (event: BridgeRuntimeEvent) => void;
}

export class BridgeRuntime {
  readonly hermes: HermesAdapter;
  private readonly sessionKeepAlive: KindroidSessionKeepAlive;
  private readonly kinSubscriptionSupervisor: KinSubscriptionSupervisor;
  private readonly groupSubscriptionSupervisor: GroupSubscriptionSupervisor;
  private started = false;

  private constructor(private readonly options: BridgeRuntimeOptions) {
    this.hermes = createHermesAdapter(options.config, options.logger);
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
    return new BridgeRuntime(options);
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.sessionKeepAlive.start();
    this.kinSubscriptionSupervisor.start();
    this.groupSubscriptionSupervisor.start();
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

  async setGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
    await this.groupSubscriptionSupervisor.setGroupEnabled(groupId, enabled);
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
      groupRefresh: this.groupSubscriptionSupervisor.refreshState()
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
        this.emit({ channel: "monitor-line", payload: { ...message, kinName: kin.name } });
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
        const message = mapKindroidMessage(document, aiId, { decryptionKey });
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
        await this.hermes.handleChatChanged(notification);
      }
    });
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
}

export type BridgeSessionSummary =
  | (ReturnType<typeof summarizeSessionAuth> & { available: true })
  | { available: false; error: string };
