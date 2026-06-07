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
  /** Legacy shared watermark retained for old persisted state and older renderer summaries. */
  lastPrewarmMessageId?: string;
  lastPrewarmTimestamp?: string | null;
  localScenePrewarmMessageId?: string;
  localScenePrewarmTimestamp?: string | null;
  soundscapePrewarmMessageId?: string;
  soundscapePrewarmTimestamp?: string | null;
  previouslyOnPrewarmMessageId?: string;
  previouslyOnPrewarmTimestamp?: string | null;
  localSceneReady?: boolean;
  soundscapeReady?: boolean;
  previouslyOnReady?: boolean;
  lastLocalScenePrewarmAt?: string;
  lastSoundscapePrewarmAt?: string;
  lastPreviouslyOnPrewarmAt?: string;
  localSceneChatHistoryCursorTimestamp?: number;
  soundscapeChatHistoryCursorTimestamp?: number;
  previouslyOnChatHistoryCursorTimestamp?: number;
  /** Legacy shared cursor retained so interrupted v0.3.1 catch-ups can resume once. */
  chatHistoryCursorTimestamp?: number;
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
    input: { trigger?: PrewarmTrigger; force?: boolean; minRefreshIntervalMs?: number }
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

    return (
      isTriggerNewer(input.trigger, state, kind) &&
      refreshIntervalElapsed(kind, state, input.trigger, input.minRefreshIntervalMs ?? defaultPrewarmRefreshIntervalMs)
    );
  }

  markAttempt(kind: PrewarmKind, source: PrewarmSourceKey, trigger?: PrewarmTrigger): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      ...legacyWatermarkFields(trigger, previous),
      ...kindWatermarkFields(kind, trigger, previous),
      [lastPrewarmField(kind)]: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  markReady(kind: PrewarmKind, source: PrewarmSourceKey, trigger?: PrewarmTrigger): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      ...legacyWatermarkFields(trigger, previous),
      ...kindWatermarkFields(kind, trigger, previous),
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

  chatHistoryStartAfter(kind: PrewarmKind, source: PrewarmSourceKey): number | undefined {
    const state = this.get(source);
    if (!state) {
      return undefined;
    }

    return (
      chatHistoryCursorForKind(kind, state) ??
      legacyCursorForReadyKind(kind, state) ??
      publicApiTimestampFromIso(prewarmTimestampForKind(kind, state) ?? legacyTimestampForReadyKind(kind, state))
    );
  }

  markChatHistoryCursor(kind: PrewarmKind, source: PrewarmSourceKey, cursor: number): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      [chatHistoryCursorField(kind)]: cursor,
      updatedAt: new Date().toISOString()
    }));
  }

  clearChatHistoryCursor(kind: PrewarmKind, source: PrewarmSourceKey): PrewarmSourceState {
    return this.update(source, (previous) => ({
      ...previous,
      [chatHistoryCursorField(kind)]: undefined,
      chatHistoryCursorTimestamp: undefined,
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

export function prewarmKindsWithChatHistoryCursor(state: PrewarmSourceState): PrewarmKind[] {
  const kinds: PrewarmKind[] = [];
  for (const kind of allPrewarmKinds) {
    if (typeof chatHistoryCursorForKind(kind, state) === "number") {
      kinds.push(kind);
    }
  }

  if (typeof state.chatHistoryCursorTimestamp === "number") {
    for (const kind of allPrewarmKinds) {
      if (!kinds.includes(kind)) {
        kinds.push(kind);
      }
    }
  }

  return kinds;
}

export function prewarmChatHistoryCursorTimestamp(kind: PrewarmKind, state: PrewarmSourceState): number | undefined {
  return chatHistoryCursorForKind(kind, state) ?? state.chatHistoryCursorTimestamp;
}

function legacyWatermarkFields(
  trigger: PrewarmTrigger | undefined,
  previous: PrewarmSourceState
): Pick<PrewarmSourceState, "lastPrewarmMessageId" | "lastPrewarmTimestamp"> {
  return {
    lastPrewarmMessageId: trigger?.documentId ?? previous.lastPrewarmMessageId,
    lastPrewarmTimestamp: trigger?.timestamp ?? previous.lastPrewarmTimestamp
  };
}

function kindWatermarkFields(
  kind: PrewarmKind,
  trigger: PrewarmTrigger | undefined,
  previous: PrewarmSourceState
): Partial<PrewarmSourceState> {
  return {
    [messageIdField(kind)]: trigger?.documentId ?? prewarmMessageIdForKind(kind, previous),
    [timestampField(kind)]: trigger?.timestamp ?? prewarmTimestampForKind(kind, previous)
  };
}

function isTriggerNewer(trigger: PrewarmTrigger, state: PrewarmSourceState, kind?: PrewarmKind): boolean {
  const stateTimestamp = kind ? prewarmTimestampForKind(kind, state) : state.lastPrewarmTimestamp;
  const stateMessageId = kind ? prewarmMessageIdForKind(kind, state) : state.lastPrewarmMessageId;

  if (trigger.timestamp && stateTimestamp) {
    const triggerMs = Date.parse(trigger.timestamp);
    const stateMs = Date.parse(stateTimestamp);
    if (Number.isFinite(triggerMs) && Number.isFinite(stateMs)) {
      return triggerMs > stateMs;
    }
  }

  return Boolean(trigger.documentId && trigger.documentId !== stateMessageId);
}

function refreshIntervalElapsed(
  kind: PrewarmKind,
  state: PrewarmSourceState,
  trigger: PrewarmTrigger,
  minRefreshIntervalMs: number
): boolean {
  if (minRefreshIntervalMs <= 0) {
    return true;
  }

  const triggerMs = trigger.timestamp ? Date.parse(trigger.timestamp) : NaN;
  const previousMs = latestPrewarmActivityMs(kind, state);
  return Number.isFinite(triggerMs) && Number.isFinite(previousMs) && triggerMs - previousMs >= minRefreshIntervalMs;
}

function latestPrewarmActivityMs(kind: PrewarmKind, state: PrewarmSourceState): number {
  const values = [prewarmTimestampForKind(kind, state), lastPrewarmAtForKind(kind, state)].flatMap((value) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  if (values.length > 0) {
    return Math.max(...values);
  }

  const updatedAtMs = Date.parse(state.updatedAt);
  return Number.isFinite(updatedAtMs) ? updatedAtMs : NaN;
}

function publicApiTimestampFromIso(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const defaultPrewarmRefreshIntervalMs = 15 * 60 * 1000;
const allPrewarmKinds: PrewarmKind[] = ["localScene", "soundscape", "previouslyOn"];

function prewarmMessageIdForKind(kind: PrewarmKind, state: PrewarmSourceState): string | undefined {
  if (kind === "localScene") {
    return state.localScenePrewarmMessageId ?? (state.localSceneReady ? state.lastPrewarmMessageId : undefined);
  }
  if (kind === "soundscape") {
    return state.soundscapePrewarmMessageId ?? (state.soundscapeReady ? state.lastPrewarmMessageId : undefined);
  }
  return state.previouslyOnPrewarmMessageId ?? (state.previouslyOnReady ? state.lastPrewarmMessageId : undefined);
}

function prewarmTimestampForKind(kind: PrewarmKind, state: PrewarmSourceState): string | null | undefined {
  if (kind === "localScene") {
    return state.localScenePrewarmTimestamp ?? (state.localSceneReady ? state.lastPrewarmTimestamp : undefined);
  }
  if (kind === "soundscape") {
    return state.soundscapePrewarmTimestamp ?? (state.soundscapeReady ? state.lastPrewarmTimestamp : undefined);
  }
  return state.previouslyOnPrewarmTimestamp ?? (state.previouslyOnReady ? state.lastPrewarmTimestamp : undefined);
}

function lastPrewarmAtForKind(kind: PrewarmKind, state: PrewarmSourceState): string | undefined {
  if (kind === "localScene") {
    return state.lastLocalScenePrewarmAt;
  }
  if (kind === "soundscape") {
    return state.lastSoundscapePrewarmAt;
  }
  return state.lastPreviouslyOnPrewarmAt;
}

function chatHistoryCursorForKind(kind: PrewarmKind, state: PrewarmSourceState): number | undefined {
  if (kind === "localScene") {
    return state.localSceneChatHistoryCursorTimestamp;
  }
  if (kind === "soundscape") {
    return state.soundscapeChatHistoryCursorTimestamp;
  }
  return state.previouslyOnChatHistoryCursorTimestamp;
}

function legacyCursorForReadyKind(kind: PrewarmKind, state: PrewarmSourceState): number | undefined {
  return readyForKind(state, kind) ? state.chatHistoryCursorTimestamp : undefined;
}

function legacyTimestampForReadyKind(kind: PrewarmKind, state: PrewarmSourceState): string | null | undefined {
  return readyForKind(state, kind) ? state.lastPrewarmTimestamp : undefined;
}

function messageIdField(
  kind: PrewarmKind
): "localScenePrewarmMessageId" | "soundscapePrewarmMessageId" | "previouslyOnPrewarmMessageId" {
  if (kind === "localScene") {
    return "localScenePrewarmMessageId";
  }
  return kind === "soundscape" ? "soundscapePrewarmMessageId" : "previouslyOnPrewarmMessageId";
}

function timestampField(
  kind: PrewarmKind
): "localScenePrewarmTimestamp" | "soundscapePrewarmTimestamp" | "previouslyOnPrewarmTimestamp" {
  if (kind === "localScene") {
    return "localScenePrewarmTimestamp";
  }
  return kind === "soundscape" ? "soundscapePrewarmTimestamp" : "previouslyOnPrewarmTimestamp";
}

function chatHistoryCursorField(
  kind: PrewarmKind
):
  | "localSceneChatHistoryCursorTimestamp"
  | "soundscapeChatHistoryCursorTimestamp"
  | "previouslyOnChatHistoryCursorTimestamp" {
  if (kind === "localScene") {
    return "localSceneChatHistoryCursorTimestamp";
  }
  return kind === "soundscape" ? "soundscapeChatHistoryCursorTimestamp" : "previouslyOnChatHistoryCursorTimestamp";
}
