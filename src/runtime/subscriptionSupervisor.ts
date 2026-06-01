export type MonitorStopReason = "disabled" | "manual" | "removed" | "shutdown";

export interface SubscriptionStatus<TResource> {
  resource: TResource;
  enabled: boolean;
  running: boolean;
}

export type RefreshState =
  | { ok: true; refreshedAtIso: string; count: number }
  | { ok: false; refreshedAtIso: string; error: string }
  | null;

export interface SubscriptionSupervisorOptions<TResource> {
  refreshMs?: number;
  pageSize?: number;
  disabledIds: Set<string>;
  listResources: () => Promise<TResource[]>;
  getId: (resource: TResource) => string;
  getName: (resource: TResource) => string;
  createFallbackResource?: (id: string) => TResource;
  saveDisabledIds: (disabledIds: Set<string>) => void;
  startResource: (resource: TResource, options: { pageSize: number; signal: AbortSignal }) => Promise<void>;
  onResourcesUpdated?: (statuses: SubscriptionStatus<TResource>[]) => void;
  onRefreshError?: (error: string) => void;
  onMonitorStarted?: (resource: TResource) => void;
  onMonitorStopped?: (resourceId: string, reason: MonitorStopReason) => void;
  onMonitorExited?: (resourceId: string, aborted: boolean) => void;
  onMonitorError?: (resource: TResource, error: string) => void;
}

interface ActiveMonitor<TResource> {
  controller: AbortController;
  resource: TResource;
}

const defaultRefreshMs = 5 * 60 * 1000;
const defaultPageSize = 50;

export class SubscriptionSupervisor<TResource> {
  private readonly activeMonitors = new Map<string, ActiveMonitor<TResource>>();
  private knownResources = new Map<string, TResource>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInFlight = false;
  private lastRefresh: RefreshState = null;

  constructor(private readonly options: SubscriptionSupervisorOptions<TResource>) {}

  start(): void {
    if (this.refreshTimer) {
      return;
    }

    void this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.options.refreshMs ?? defaultRefreshMs);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.stopAll("shutdown");
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      return;
    }

    this.refreshInFlight = true;
    try {
      const resources = await this.options.listResources();
      const nextKnownResources = new Map(resources.map((resource) => [this.options.getId(resource), resource]));
      const availableIds = new Set(nextKnownResources.keys());

      this.knownResources = nextKnownResources;
      for (const resourceId of this.activeMonitors.keys()) {
        if (!availableIds.has(resourceId) || this.options.disabledIds.has(resourceId)) {
          this.stopResource(resourceId, availableIds.has(resourceId) ? "disabled" : "removed");
        }
      }

      for (const resource of resources) {
        if (!this.options.disabledIds.has(this.options.getId(resource))) {
          this.startResourceMonitor(resource, this.options.pageSize ?? defaultPageSize);
        }
      }

      this.lastRefresh = { ok: true, refreshedAtIso: new Date().toISOString(), count: resources.length };
      this.emitResourcesUpdated();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastRefresh = {
        ok: false,
        refreshedAtIso: new Date().toISOString(),
        error: message
      };
      this.options.onRefreshError?.(message);
      this.emitResourcesUpdated();
    } finally {
      this.refreshInFlight = false;
    }
  }

  startKnownResource(resourceId: string, pageSize = this.options.pageSize ?? defaultPageSize): void {
    this.options.disabledIds.delete(resourceId);
    this.options.saveDisabledIds(this.options.disabledIds);
    const resource = this.knownResources.get(resourceId) ?? this.options.createFallbackResource?.(resourceId);
    if (!resource) {
      throw new Error(`Cannot start unknown resource ${resourceId}.`);
    }

    this.knownResources.set(this.options.getId(resource), resource);
    this.startResourceMonitor(resource, pageSize);
    this.emitResourcesUpdated();
  }

  async setEnabled(resourceId: string, enabled: boolean): Promise<void> {
    if (!resourceId) {
      throw new Error("Missing resource id.");
    }

    if (enabled) {
      this.options.disabledIds.delete(resourceId);
      const resource = this.knownResources.get(resourceId);
      if (resource) {
        this.startResourceMonitor(resource, this.options.pageSize ?? defaultPageSize);
      } else {
        await this.refresh();
      }
    } else {
      this.options.disabledIds.add(resourceId);
      this.stopResource(resourceId, "disabled");
    }

    this.options.saveDisabledIds(this.options.disabledIds);
    this.emitResourcesUpdated();
  }

  stopAll(reason: MonitorStopReason = "manual"): void {
    for (const resourceId of this.activeMonitors.keys()) {
      this.stopResource(resourceId, reason);
    }
  }

  statuses(): SubscriptionStatus<TResource>[] {
    return [...this.knownResources.values()]
      .sort(
        (left, right) =>
          this.options.getName(left).localeCompare(this.options.getName(right)) ||
          this.options.getId(left).localeCompare(this.options.getId(right))
      )
      .map((resource) => {
        const resourceId = this.options.getId(resource);
        return {
          resource,
          enabled: !this.options.disabledIds.has(resourceId),
          running: this.activeMonitors.has(resourceId)
        };
      });
  }

  runningCount(): number {
    return this.activeMonitors.size;
  }

  refreshState(): RefreshState {
    return this.lastRefresh;
  }

  private startResourceMonitor(resource: TResource, pageSize: number): void {
    const resourceId = this.options.getId(resource);
    if (this.activeMonitors.has(resourceId)) {
      return;
    }

    const controller = new AbortController();
    this.activeMonitors.set(resourceId, { controller, resource });

    void this.options
      .startResource(resource, { pageSize, signal: controller.signal })
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.options.onMonitorError?.(resource, error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        const activeMonitor = this.activeMonitors.get(resourceId);
        if (activeMonitor?.controller === controller) {
          this.activeMonitors.delete(resourceId);
        }
        this.options.onMonitorExited?.(resourceId, controller.signal.aborted);
        this.emitResourcesUpdated();
      });

    this.options.onMonitorStarted?.(resource);
    this.emitResourcesUpdated();
  }

  private stopResource(resourceId: string, reason: MonitorStopReason): void {
    const activeMonitor = this.activeMonitors.get(resourceId);
    if (!activeMonitor) {
      return;
    }

    activeMonitor.controller.abort();
    this.activeMonitors.delete(resourceId);
    this.options.onMonitorStopped?.(resourceId, reason);
    this.emitResourcesUpdated();
  }

  private emitResourcesUpdated(): void {
    this.options.onResourcesUpdated?.(this.statuses());
  }
}
