import type { AppConfig } from "../config/types.js";
import { KindroidApiClient, type KindroidKin } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import { loadKinSubscriptionPreferences, saveKinSubscriptionPreferences } from "./kinSubscriptionPreferences.js";
import { type MonitorStopReason, SubscriptionSupervisor, type SubscriptionStatus } from "./subscriptionSupervisor.js";

export type KinMonitorStopReason = MonitorStopReason;

export interface KinSubscriptionStatus {
  kin: KindroidKin;
  enabled: boolean;
  running: boolean;
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

  constructor(options: KinSubscriptionSupervisorOptions) {
    const preferences = loadKinSubscriptionPreferences(options.config);
    this.inner = new SubscriptionSupervisor({
      refreshMs: options.refreshMs,
      pageSize: options.pageSize,
      disabledIds: preferences.disabledKinIds,
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
        current: false
      }),
      saveDisabledIds: (disabledKinIds) => {
        saveKinSubscriptionPreferences(options.config, { disabledKinIds });
      },
      startResource: options.startKin,
      onResourcesUpdated: (statuses) => options.onKinsUpdated?.(toKinStatuses(statuses)),
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

  stopAll(reason: KinMonitorStopReason = "manual"): void {
    this.inner.stopAll(reason);
  }

  statuses(): KinSubscriptionStatus[] {
    return toKinStatuses(this.inner.statuses());
  }

  runningCount(): number {
    return this.inner.runningCount();
  }

  refreshState(): KinRefreshState {
    return this.inner.refreshState() as KinRefreshState;
  }
}

function toKinStatuses(statuses: SubscriptionStatus<KindroidKin>[]): KinSubscriptionStatus[] {
  return statuses.map((status) => ({
    kin: status.resource,
    enabled: status.enabled,
    running: status.running
  }));
}
