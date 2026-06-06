import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";

export type PrewarmKind = "localScene" | "soundscape" | "previouslyOn";
export type PrewarmScope = "kin" | "group";

export interface PrewarmSourceKey {
  scope: PrewarmScope;
  id: string;
}

export interface PrewarmTrigger {
  documentId: string;
  timestamp: string | null;
}

export interface PrewarmSourceState {
  sourceKey: string;
  lastPrewarmMessageId?: string;
  lastPrewarmTimestamp?: string | null;
  localSceneReady?: boolean;
  soundscapeReady?: boolean;
  previouslyOnReady?: boolean;
  lastLocalScenePrewarmAt?: string;
  lastSoundscapePrewarmAt?: string;
  lastPreviouslyOnPrewarmAt?: string;
  failureCount?: number;
  updatedAt: string;
}

interface PrewarmStateFile {
  states?: Record<string, PrewarmSourceState>;
}

export class PrewarmStateStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): PrewarmStateStore {
    return new PrewarmStateStore(prewarmStatePath(config));
  }

  list(): PrewarmSourceState[] {
    return Object.values(this.read().states ?? {}).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(source: PrewarmSourceKey): PrewarmSourceState | null {
    return this.read().states?.[prewarmSourceKey(source)] ?? null;
  }

  shouldPrewarm(
    kind: PrewarmKind,
    source: PrewarmSourceKey,
    input: { trigger?: PrewarmTrigger; force?: boolean }
  ): boolean {
    if (input.force) {
      return true;
    }

    const state = this.get(source);
    if (!input.trigger) {
      return !readyForKind(state, kind);
    }

    if (!state) {
      return true;
    }

    if (!readyForKind(state, kind)) {
      return true;
    }

    return isTriggerNewer(input.trigger, state);
  }

  markAttempt(kind: PrewarmKind, source: PrewarmSourceKey, trigger?: PrewarmTrigger): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      ...watermarkFields(trigger, previous),
      [lastPrewarmField(kind)]: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  markReady(kind: PrewarmKind, source: PrewarmSourceKey, trigger?: PrewarmTrigger): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      ...watermarkFields(trigger, previous),
      [readyField(kind)]: true,
      failureCount: 0,
      updatedAt: new Date().toISOString()
    }));
  }

  clearReady(kind: PrewarmKind, source: PrewarmSourceKey): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      [readyField(kind)]: false,
      updatedAt: new Date().toISOString()
    }));
  }

  private update(
    source: PrewarmSourceKey,
    apply: (previous: PrewarmSourceState) => PrewarmSourceState
  ): PrewarmSourceState {
    const file = this.read();
    const states = file.states ?? {};
    const key = prewarmSourceKey(source);
    const previous = states[key] ?? { sourceKey: key, updatedAt: new Date().toISOString() };
    const next = { ...apply(previous), sourceKey: key };
    states[key] = next;
    this.write({ ...file, states });
    return next;
  }

  private read(): PrewarmStateFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PrewarmStateFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: PrewarmStateFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function prewarmStatePath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "prewarm-state.json");
}

export function prewarmSourceKey(source: PrewarmSourceKey): string {
  return `${source.scope}:${source.id}`;
}

export function prewarmSourceFromNotification(notification: KindroidChatNotification): PrewarmSourceKey {
  if (notification.type === "kindroid.group_chat.changed") {
    return { scope: "group", id: notification.groupId };
  }
  return { scope: "kin", id: notification.kinId };
}

export function prewarmTriggerFromNotification(notification: KindroidChatNotification): PrewarmTrigger {
  return {
    documentId: notification.documentId,
    timestamp: notification.timestamp
  };
}

function readyForKind(state: PrewarmSourceState | null, kind: PrewarmKind): boolean {
  if (kind === "localScene") {
    return Boolean(state?.localSceneReady);
  }
  return kind === "soundscape" ? Boolean(state?.soundscapeReady) : Boolean(state?.previouslyOnReady);
}

function readyField(kind: PrewarmKind): "localSceneReady" | "soundscapeReady" | "previouslyOnReady" {
  if (kind === "localScene") {
    return "localSceneReady";
  }
  return kind === "soundscape" ? "soundscapeReady" : "previouslyOnReady";
}

function lastPrewarmField(
  kind: PrewarmKind
): "lastLocalScenePrewarmAt" | "lastSoundscapePrewarmAt" | "lastPreviouslyOnPrewarmAt" {
  if (kind === "localScene") {
    return "lastLocalScenePrewarmAt";
  }
  return kind === "soundscape" ? "lastSoundscapePrewarmAt" : "lastPreviouslyOnPrewarmAt";
}

function watermarkFields(
  trigger: PrewarmTrigger | undefined,
  previous: PrewarmSourceState
): Pick<PrewarmSourceState, "lastPrewarmMessageId" | "lastPrewarmTimestamp"> {
  return {
    lastPrewarmMessageId: trigger?.documentId ?? previous.lastPrewarmMessageId,
    lastPrewarmTimestamp: trigger?.timestamp ?? previous.lastPrewarmTimestamp
  };
}

function isTriggerNewer(trigger: PrewarmTrigger, state: PrewarmSourceState): boolean {
  if (trigger.timestamp && state.lastPrewarmTimestamp) {
    const triggerMs = Date.parse(trigger.timestamp);
    const stateMs = Date.parse(state.lastPrewarmTimestamp);
    if (Number.isFinite(triggerMs) && Number.isFinite(stateMs)) {
      return triggerMs > stateMs;
    }
  }

  return Boolean(trigger.documentId && trigger.documentId !== state.lastPrewarmMessageId);
}
