import type { AppConfig } from "../config/types.js";
import { KindroidApiClient, type KindroidGroup } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import {
  loadGroupSubscriptionPreferences,
  normalizeGroupSoundscapePreference,
  saveGroupSubscriptionPreferences,
  type GroupSoundscapePreference
} from "./groupSubscriptionPreferences.js";
import { type MonitorStopReason, SubscriptionSupervisor, type SubscriptionStatus } from "./subscriptionSupervisor.js";

export type GroupMonitorStopReason = MonitorStopReason;

export interface GroupSubscriptionStatus {
  group: KindroidGroup;
  enabled: boolean;
  running: boolean;
  soundscape: GroupSoundscapePreference;
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
  private readonly disabledGroupIds: Set<string>;
  private readonly soundscapePreferences: Map<string, GroupSoundscapePreference>;
  private readonly config: AppConfig;

  constructor(options: GroupSubscriptionSupervisorOptions) {
    this.config = options.config;
    const preferences = loadGroupSubscriptionPreferences(options.config);
    this.disabledGroupIds = preferences.disabledGroupIds;
    this.soundscapePreferences = preferences.soundscape;
    this.inner = new SubscriptionSupervisor({
      refreshMs: options.refreshMs,
      pageSize: options.pageSize,
      disabledIds: this.disabledGroupIds,
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
        saveGroupSubscriptionPreferences(options.config, {
          disabledGroupIds,
          soundscape: this.soundscapePreferences
        });
      },
      startResource: options.startGroup,
      onResourcesUpdated: (statuses) => options.onGroupsUpdated?.(this.toGroupStatuses(statuses)),
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

  setGroupSoundscapePreference(
    groupId: string,
    preference: Partial<GroupSoundscapePreference>
  ): GroupSoundscapePreference {
    if (!groupId) {
      throw new Error("Missing Group id.");
    }

    const saved = normalizeGroupSoundscapePreference(preference);
    this.soundscapePreferences.set(groupId, saved);
    saveGroupSubscriptionPreferences(this.config, {
      disabledGroupIds: this.disabledGroupIds,
      soundscape: this.soundscapePreferences
    });
    return saved;
  }

  groupSoundscapePreference(groupId: string): GroupSoundscapePreference {
    return normalizeGroupSoundscapePreference(this.soundscapePreferences.get(groupId));
  }

  stopAll(reason: GroupMonitorStopReason = "manual"): void {
    this.inner.stopAll(reason);
  }

  statuses(): GroupSubscriptionStatus[] {
    return this.toGroupStatuses(this.inner.statuses());
  }

  runningCount(): number {
    return this.inner.runningCount();
  }

  refreshState(): GroupRefreshState {
    return this.inner.refreshState() as GroupRefreshState;
  }

  private toGroupStatuses(statuses: SubscriptionStatus<KindroidGroup>[]): GroupSubscriptionStatus[] {
    return statuses.map((status) => ({
      group: status.resource,
      enabled: status.enabled,
      running: status.running,
      soundscape: this.groupSoundscapePreference(status.resource.groupId)
    }));
  }
}
