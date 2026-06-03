import type { AppConfig } from "../config/types.js";
import { parseChatDynamismValue } from "../kindroid/chatDynamism.js";
import { KindroidApiClient, type KindroidKin } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import {
  loadKinSubscriptionPreferences,
  normalizeChatDynamismPreference,
  saveKinSubscriptionPreferences,
  type KinChatDynamismPreference
} from "./kinSubscriptionPreferences.js";
import { type MonitorStopReason, SubscriptionSupervisor, type SubscriptionStatus } from "./subscriptionSupervisor.js";

export type KinMonitorStopReason = MonitorStopReason;

export interface KinSubscriptionStatus {
  kin: KindroidKin;
  enabled: boolean;
  running: boolean;
  ambientContextEnabled: boolean;
  chatDynamism: KinChatDynamismPreference;
}

export type KinRefreshState =
  | { ok: true; refreshedAtIso: string; count: number }
  | { ok: false; refreshedAtIso: string; error: string }
  | null;

export interface KinSubscriptionSupervisorOptions {
  config: AppConfig;
  logger: Logger;
  refreshMs?: number;
  pageSize?: number;
  startKin: (kin: KindroidKin, options: { pageSize: number; signal: AbortSignal }) => Promise<void>;
  onKinsUpdated?: (statuses: KinSubscriptionStatus[]) => void;
  onRefreshError?: (error: string) => void;
  onMonitorStarted?: (kin: KindroidKin) => void;
  onMonitorStopped?: (kinId: string, reason: KinMonitorStopReason) => void;
  onMonitorExited?: (kinId: string, aborted: boolean) => void;
  onMonitorError?: (kin: KindroidKin, error: string) => void;
}

export class KinSubscriptionSupervisor {
  private readonly inner: SubscriptionSupervisor<KindroidKin>;
  private readonly disabledKinIds: Set<string>;
  private readonly ambientDisabledKinIds: Set<string>;
  private readonly chatDynamismPreferences: Map<string, KinChatDynamismPreference>;
  private readonly config: AppConfig;

  constructor(options: KinSubscriptionSupervisorOptions) {
    this.config = options.config;
    const preferences = loadKinSubscriptionPreferences(options.config);
    this.disabledKinIds = preferences.disabledKinIds;
    this.ambientDisabledKinIds = preferences.ambientDisabledKinIds;
    this.chatDynamismPreferences = preferences.chatDynamism;
    this.inner = new SubscriptionSupervisor({
      refreshMs: options.refreshMs,
      pageSize: options.pageSize,
      disabledIds: this.disabledKinIds,
      listResources: async () => {
        const client = new KindroidApiClient(options.config, options.logger);
        return client.kins.list();
      },
      getId: (kin) => kin.aiId,
      getName: (kin) => kin.name,
      createFallbackResource: (kinId) => ({
        aiId: kinId,
        documentId: kinId,
        name: kinId,
        current: false,
        chatDynamism: parseChatDynamismValue(undefined)
      }),
      saveDisabledIds: (disabledKinIds) => {
        saveKinSubscriptionPreferences(options.config, {
          disabledKinIds,
          ambientDisabledKinIds: this.ambientDisabledKinIds,
          chatDynamism: this.chatDynamismPreferences
        });
      },
      startResource: options.startKin,
      onResourcesUpdated: (statuses) => options.onKinsUpdated?.(this.toKinStatuses(statuses)),
      onRefreshError: options.onRefreshError,
      onMonitorStarted: options.onMonitorStarted,
      onMonitorStopped: options.onMonitorStopped,
      onMonitorExited: options.onMonitorExited,
      onMonitorError: options.onMonitorError
    });
  }

  start(): void {
    this.inner.start();
  }

  stop(): void {
    this.inner.stop();
  }

  async refresh(): Promise<void> {
    await this.inner.refresh();
  }

  startKnownKin(kinId: string, pageSize?: number): void {
    this.inner.startKnownResource(kinId, pageSize);
  }

  async setKinEnabled(kinId: string, enabled: boolean): Promise<void> {
    await this.inner.setEnabled(kinId, enabled);
  }

  setKinAmbientContextEnabled(kinId: string, enabled: boolean): void {
    if (!kinId) {
      throw new Error("Missing Kin id.");
    }

    if (enabled) {
      this.ambientDisabledKinIds.delete(kinId);
    } else {
      this.ambientDisabledKinIds.add(kinId);
    }

    saveKinSubscriptionPreferences(this.config, {
      disabledKinIds: this.disabledKinIds,
      ambientDisabledKinIds: this.ambientDisabledKinIds,
      chatDynamism: this.chatDynamismPreferences
    });
  }

  isKinAmbientContextEnabled(kinId: string): boolean {
    return !this.ambientDisabledKinIds.has(kinId);
  }

  setKinChatDynamismPreference(
    kinId: string,
    preference: Partial<KinChatDynamismPreference>
  ): KinChatDynamismPreference {
    if (!kinId) {
      throw new Error("Missing Kin id.");
    }

    const saved = normalizeChatDynamismPreference(preference);
    this.chatDynamismPreferences.set(kinId, saved);
    saveKinSubscriptionPreferences(this.config, {
      disabledKinIds: this.disabledKinIds,
      ambientDisabledKinIds: this.ambientDisabledKinIds,
      chatDynamism: this.chatDynamismPreferences
    });
    return saved;
  }

  kinChatDynamismPreference(kinId: string): KinChatDynamismPreference {
    return normalizeChatDynamismPreference(this.chatDynamismPreferences.get(kinId));
  }

  stopAll(reason: KinMonitorStopReason = "manual"): void {
    this.inner.stopAll(reason);
  }

  statuses(): KinSubscriptionStatus[] {
    return this.toKinStatuses(this.inner.statuses());
  }

  runningCount(): number {
    return this.inner.runningCount();
  }

  refreshState(): KinRefreshState {
    return this.inner.refreshState() as KinRefreshState;
  }

  private toKinStatuses(statuses: SubscriptionStatus<KindroidKin>[]): KinSubscriptionStatus[] {
    return statuses.map((status) => ({
      kin: status.resource,
      enabled: status.enabled,
      running: status.running,
      ambientContextEnabled: this.isKinAmbientContextEnabled(status.resource.aiId),
      chatDynamism: this.kinChatDynamismPreference(status.resource.aiId)
    }));
  }
}
