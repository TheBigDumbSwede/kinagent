import type { AppConfig } from "../config/types.js";
import { FirestoreRestClient, type FirestoreKinDocument } from "../firestore/firestoreRestClient.js";
import type { Logger } from "../util/logger.js";
import { loadKinSubscriptionPreferences, saveKinSubscriptionPreferences } from "./kinSubscriptionPreferences.js";

export type KinMonitorStopReason = "disabled" | "manual" | "removed" | "shutdown";

export interface KinSubscriptionStatus {
  kin: FirestoreKinDocument;
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
  startKin: (kin: FirestoreKinDocument, options: { pageSize: number; signal: AbortSignal }) => Promise<void>;
  onKinsUpdated?: (statuses: KinSubscriptionStatus[]) => void;
  onRefreshError?: (error: string) => void;
  onMonitorStarted?: (kin: FirestoreKinDocument) => void;
  onMonitorStopped?: (kinId: string, reason: KinMonitorStopReason) => void;
  onMonitorExited?: (kinId: string, aborted: boolean) => void;
  onMonitorError?: (kin: FirestoreKinDocument, error: string) => void;
}

interface ActiveKinMonitor {
  controller: AbortController;
  kin: FirestoreKinDocument;
}

const defaultRefreshMs = 5 * 60 * 1000;
const defaultPageSize = 50;

export class KinSubscriptionSupervisor {
  private readonly disabledKinIds: Set<string>;
  private readonly activeKinMonitors = new Map<string, ActiveKinMonitor>();
  private knownKins = new Map<string, FirestoreKinDocument>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInFlight = false;
  private lastRefresh: KinRefreshState = null;

  constructor(private readonly options: KinSubscriptionSupervisorOptions) {
    this.disabledKinIds = loadKinSubscriptionPreferences(options.config).disabledKinIds;
  }

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
      const client = new FirestoreRestClient(this.options.config, this.options.logger);
      const kins = await client.listUserKins();
      const nextKnownKins = new Map(kins.map((kin) => [kin.aiId, kin]));
      const availableKinIds = new Set(nextKnownKins.keys());

      this.knownKins = nextKnownKins;
      for (const kinId of this.activeKinMonitors.keys()) {
        if (!availableKinIds.has(kinId) || this.disabledKinIds.has(kinId)) {
          this.stopKin(kinId, availableKinIds.has(kinId) ? "disabled" : "removed");
        }
      }

      for (const kin of kins) {
        if (!this.disabledKinIds.has(kin.aiId)) {
          this.startKinMonitor(kin, this.options.pageSize ?? defaultPageSize);
        }
      }

      this.lastRefresh = { ok: true, refreshedAtIso: new Date().toISOString(), count: kins.length };
      this.emitKinsUpdated();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastRefresh = {
        ok: false,
        refreshedAtIso: new Date().toISOString(),
        error: message
      };
      this.options.onRefreshError?.(message);
      this.emitKinsUpdated();
    } finally {
      this.refreshInFlight = false;
    }
  }

  startKnownKin(kinId: string, pageSize = this.options.pageSize ?? defaultPageSize): void {
    this.disabledKinIds.delete(kinId);
    this.savePreferences();
    const kin =
      this.knownKins.get(kinId) ??
      ({
        aiId: kinId,
        documentId: kinId,
        name: kinId,
        current: false
      } satisfies FirestoreKinDocument);
    this.knownKins.set(kin.aiId, kin);
    this.startKinMonitor(kin, pageSize);
    this.emitKinsUpdated();
  }

  async setKinEnabled(kinId: string, enabled: boolean): Promise<void> {
    if (!kinId) {
      throw new Error("Missing Kin id.");
    }

    if (enabled) {
      this.disabledKinIds.delete(kinId);
      const kin = this.knownKins.get(kinId);
      if (kin) {
        this.startKinMonitor(kin, this.options.pageSize ?? defaultPageSize);
      } else {
        await this.refresh();
      }
    } else {
      this.disabledKinIds.add(kinId);
      this.stopKin(kinId, "disabled");
    }

    this.savePreferences();
    this.emitKinsUpdated();
  }

  stopAll(reason: KinMonitorStopReason = "manual"): void {
    for (const kinId of this.activeKinMonitors.keys()) {
      this.stopKin(kinId, reason);
    }
  }

  statuses(): KinSubscriptionStatus[] {
    return [...this.knownKins.values()]
      .sort((left, right) => left.name.localeCompare(right.name) || left.aiId.localeCompare(right.aiId))
      .map((kin) => ({
        kin,
        enabled: !this.disabledKinIds.has(kin.aiId),
        running: this.activeKinMonitors.has(kin.aiId)
      }));
  }

  runningCount(): number {
    return this.activeKinMonitors.size;
  }

  refreshState(): KinRefreshState {
    return this.lastRefresh;
  }

  private startKinMonitor(kin: FirestoreKinDocument, pageSize: number): void {
    if (this.activeKinMonitors.has(kin.aiId)) {
      return;
    }

    const controller = new AbortController();
    this.activeKinMonitors.set(kin.aiId, { controller, kin });

    void this.options
      .startKin(kin, { pageSize, signal: controller.signal })
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.options.onMonitorError?.(kin, error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        const activeMonitor = this.activeKinMonitors.get(kin.aiId);
        if (activeMonitor?.controller === controller) {
          this.activeKinMonitors.delete(kin.aiId);
        }
        this.options.onMonitorExited?.(kin.aiId, controller.signal.aborted);
        this.emitKinsUpdated();
      });

    this.options.onMonitorStarted?.(kin);
    this.emitKinsUpdated();
  }

  private stopKin(kinId: string, reason: KinMonitorStopReason): void {
    const activeMonitor = this.activeKinMonitors.get(kinId);
    if (!activeMonitor) {
      return;
    }

    activeMonitor.controller.abort();
    this.activeKinMonitors.delete(kinId);
    this.options.onMonitorStopped?.(kinId, reason);
    this.emitKinsUpdated();
  }

  private savePreferences(): void {
    saveKinSubscriptionPreferences(this.options.config, { disabledKinIds: this.disabledKinIds });
  }

  private emitKinsUpdated(): void {
    this.options.onKinsUpdated?.(this.statuses());
  }
}
