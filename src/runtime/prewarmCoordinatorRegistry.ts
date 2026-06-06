import type { KindroidChatNotification } from "../firestore/types.js";
import type { KindroidGroup, KindroidKin } from "../kindroid/client/index.js";
import type { Logger } from "../util/logger.js";
import type { PrewarmCoordinatorBase } from "./prewarmCoordinatorBase.js";
import {
  PrewarmStateStore,
  prewarmChatHistoryCursorTimestamp,
  prewarmKindsWithChatHistoryCursor,
  type PrewarmKind
} from "./prewarmStateStore.js";

interface PrewarmCoordinatorRegistryOptions {
  logger: Logger;
  prewarmState: PrewarmStateStore;
  resolveKin: (kinId: string) => KindroidKin | null;
  resolveGroup: (groupId: string) => KindroidGroup | null;
}

export class PrewarmCoordinatorRegistry {
  private readonly coordinators: Array<{ kind: PrewarmKind; coordinator: PrewarmCoordinatorBase }> = [];
  private readonly resumed = new Set<string>();

  constructor(private readonly options: PrewarmCoordinatorRegistryOptions) {}

  register(kind: PrewarmKind, coordinator: PrewarmCoordinatorBase): void {
    this.coordinators.push({ kind, coordinator });
  }

  prewarmKinActivity(kin: KindroidKin, trigger: { documentId: string; timestamp: string | null }): void {
    for (const entry of this.coordinators) {
      void entry.coordinator.prewarmKin(kin, "activity", { trigger });
    }
  }

  prewarmGroupActivity(
    group: KindroidGroup,
    notification: KindroidChatNotification,
    trigger: { documentId: string; timestamp: string | null }
  ): void {
    for (const entry of this.coordinators) {
      void entry.coordinator.prewarmGroup(group, notification, "activity", { trigger });
    }
  }

  async forceKin(kind: PrewarmKind, kin: KindroidKin): Promise<void> {
    await this.coordinatorFor(kind).prewarmKin(kin, "manual-force", { force: true });
  }

  async forceGroup(kind: PrewarmKind, group: KindroidGroup): Promise<void> {
    await this.coordinatorFor(kind).prewarmGroup(group, null, "manual-force", { force: true });
  }

  resumePersisted(): void {
    for (const state of this.options.prewarmState.list()) {
      const kinds = prewarmKindsWithChatHistoryCursor(state);
      if (kinds.length === 0) {
        continue;
      }

      const [scope, id] = state.sourceKey.split(":", 2);
      if (scope === "kin") {
        const kin = this.options.resolveKin(id);
        if (kin) {
          for (const entry of this.coordinatorsFor(kinds)) {
            this.resumeKin(entry, state.sourceKey, kin, prewarmChatHistoryCursorTimestamp(entry.kind, state));
          }
        }
        continue;
      }

      if (scope === "group") {
        const group = this.options.resolveGroup(id);
        if (group) {
          for (const entry of this.coordinatorsFor(kinds)) {
            this.resumeGroup(entry, state.sourceKey, group, prewarmChatHistoryCursorTimestamp(entry.kind, state));
          }
        }
      }
    }
  }

  private coordinatorsFor(kinds: PrewarmKind[]): Array<{ kind: PrewarmKind; coordinator: PrewarmCoordinatorBase }> {
    return this.coordinators.filter((coordinator) => kinds.includes(coordinator.kind));
  }

  private coordinatorFor(kind: PrewarmKind): PrewarmCoordinatorBase {
    const entry = this.coordinators.find((coordinator) => coordinator.kind === kind);
    if (!entry) {
      throw new Error(`Prewarm coordinator is not registered for ${kind}.`);
    }
    return entry.coordinator;
  }

  private resumeKin(
    entry: { kind: PrewarmKind; coordinator: PrewarmCoordinatorBase },
    sourceKey: string,
    kin: KindroidKin,
    nextStartAfterTimestamp: number | undefined
  ): void {
    const resumeKey = `${entry.kind}:${sourceKey}`;
    if (this.resumed.has(resumeKey)) {
      return;
    }

    this.resumed.add(resumeKey);
    this.options.logger.info("Scheduling persisted chat history catch-up.", {
      kind: entry.kind,
      scope: "kin",
      id: kin.aiId,
      nextStartAfterTimestamp
    });
    entry.coordinator.resumeKinCatchup(kin);
  }

  private resumeGroup(
    entry: { kind: PrewarmKind; coordinator: PrewarmCoordinatorBase },
    sourceKey: string,
    group: KindroidGroup,
    nextStartAfterTimestamp: number | undefined
  ): void {
    const resumeKey = `${entry.kind}:${sourceKey}`;
    if (this.resumed.has(resumeKey)) {
      return;
    }

    this.resumed.add(resumeKey);
    this.options.logger.info("Scheduling persisted group chat history catch-up.", {
      kind: entry.kind,
      scope: "group",
      id: group.groupId,
      nextStartAfterTimestamp
    });
    entry.coordinator.resumeGroupCatchup(group);
  }
}
