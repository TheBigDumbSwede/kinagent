import type { AppConfig } from "../config/types.js";
import { KindroidApiClient, type KindroidGroup } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import { loadGroupSubscriptionPreferences, saveGroupSubscriptionPreferences } from "./groupSubscriptionPreferences.js";
import { type MonitorStopReason, SubscriptionSupervisor, type SubscriptionStatus } from "./subscriptionSupervisor.js";

export type GroupMonitorStopReason = MonitorStopReason;

export interface GroupSubscriptionStatus {
  group: KindroidGroup;
  enabled: boolean;
  running: boolean;
}

export type GroupRefreshState =
  | { ok: true; refreshedAtIso: string; count: number }
  | { ok: false; refreshedAtIso: string; error: string }
  | null;

export interface GroupSubscriptionSupervisorOptions {
  config: AppConfig;
  logger: Logger;
  refreshMs?: number;
  pageSize?: number;
  startGroup: (group: KindroidGroup, options: { pageSize: number; signal: AbortSignal }) => Promise<void>;
  onGroupsUpdated?: (statuses: GroupSubscriptionStatus[]) => void;
  onRefreshError?: (error: string) => void;
  onMonitorStarted?: (group: KindroidGroup) => void;
  onMonitorStopped?: (groupId: string, reason: GroupMonitorStopReason) => void;
  onMonitorExited?: (groupId: string, aborted: boolean) => void;
  onMonitorError?: (group: KindroidGroup, error: string) => void;
}

export class GroupSubscriptionSupervisor {
  private readonly inner: SubscriptionSupervisor<KindroidGroup>;

  constructor(options: GroupSubscriptionSupervisorOptions) {
    const preferences = loadGroupSubscriptionPreferences(options.config);
    this.inner = new SubscriptionSupervisor({
      refreshMs: options.refreshMs,
      pageSize: options.pageSize,
      disabledIds: preferences.disabledGroupIds,
      listResources: async () => {
        const client = new KindroidApiClient(options.config, options.logger);
        return client.groups.list();
      },
      getId: (group) => group.groupId,
      getName: (group) => group.name,
      createFallbackResource: (groupId) => ({
        groupId,
        documentId: groupId,
        name: groupId,
        aiIds: []
      }),
      saveDisabledIds: (disabledGroupIds) => {
        saveGroupSubscriptionPreferences(options.config, { disabledGroupIds });
      },
      startResource: options.startGroup,
      onResourcesUpdated: (statuses) => options.onGroupsUpdated?.(toGroupStatuses(statuses)),
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

  startKnownGroup(groupId: string, pageSize?: number): void {
    this.inner.startKnownResource(groupId, pageSize);
  }

  async setGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
    await this.inner.setEnabled(groupId, enabled);
  }

  stopAll(reason: GroupMonitorStopReason = "manual"): void {
    this.inner.stopAll(reason);
  }

  statuses(): GroupSubscriptionStatus[] {
    return toGroupStatuses(this.inner.statuses());
  }

  runningCount(): number {
    return this.inner.runningCount();
  }

  refreshState(): GroupRefreshState {
    return this.inner.refreshState() as GroupRefreshState;
  }
}

function toGroupStatuses(statuses: SubscriptionStatus<KindroidGroup>[]): GroupSubscriptionStatus[] {
  return statuses.map((status) => ({
    group: status.resource,
    enabled: status.enabled,
    running: status.running
  }));
}
