import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";

export type LocalSceneScope = "kin" | "group";

export interface LocalSceneStateInput {
  location?: string;
  timeOfDay?: string;
  mood?: string;
  activity?: string;
  tension?: number;
  privacy?: string;
  soundscape?: Record<string, string | number | boolean>;
  visualPalette?: Record<string, string | number | boolean>;
  suggestedUiAccent?: string;
  evidence?: string[];
  reason?: string;
}

export interface LocalSceneState extends LocalSceneStateInput {
  scope: LocalSceneScope;
  kinId?: string;
  groupId?: string;
  latestSpeakerKinId?: string | null;
  updatedAt: string;
  sourceDocumentId: string;
  sourceTimestamp: string | null;
}

interface LocalSceneStateFile {
  states?: Record<string, LocalSceneState>;
}

export class LocalSceneStateStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): LocalSceneStateStore {
    return new LocalSceneStateStore(localSceneStatePath(config));
  }

  list(): LocalSceneState[] {
    const states = this.read().states ?? {};
    return Object.values(states).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getForKin(kinId: string): LocalSceneState | null {
    return this.read().states?.[localSceneKey("kin", kinId)] ?? null;
  }

  getForGroup(groupId: string): LocalSceneState | null {
    return this.read().states?.[localSceneKey("group", groupId)] ?? null;
  }

  update(notification: KindroidChatNotification, input: LocalSceneStateInput): LocalSceneState | null {
    const target = localSceneTarget(notification);
    if (!target) {
      return null;
    }

    const normalized = compactLocalSceneStateInput(normalizeLocalSceneStateInput(input));
    if (!hasScenePayload(normalized)) {
      return null;
    }

    const file = this.read();
    const states = file.states ?? {};
    const key = localSceneKey(target.scope, target.id);
    const previous = states[key];
    const now = new Date().toISOString();
    const next: LocalSceneState = {
      ...previous,
      ...normalized,
      scope: target.scope,
      kinId: target.scope === "kin" ? target.id : undefined,
      groupId: target.scope === "group" ? target.id : undefined,
      latestSpeakerKinId: notification.type === "kindroid.group_chat.changed" ? notification.aiId : undefined,
      updatedAt: now,
      sourceDocumentId: notification.documentId,
      sourceTimestamp: notification.timestamp
    };

    states[key] = next;
    this.write({ ...file, states });
    return next;
  }

  private read(): LocalSceneStateFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as LocalSceneStateFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: LocalSceneStateFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function localSceneStatePath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "local-scene-state.json");
}

export function normalizeLocalSceneStateInput(input: LocalSceneStateInput): LocalSceneStateInput {
  return {
    location: optionalText(input.location, 120),
    timeOfDay: optionalText(input.timeOfDay, 80),
    mood: optionalText(input.mood, 120),
    activity: optionalText(input.activity, 160),
    tension: normalizeTension(input.tension),
    privacy: optionalText(input.privacy, 60),
    soundscape: normalizeMetadata(input.soundscape),
    visualPalette: normalizeMetadata(input.visualPalette),
    suggestedUiAccent: optionalText(input.suggestedUiAccent, 120),
    evidence: normalizeStringArray(input.evidence, 6, 220),
    reason: optionalText(input.reason, 220)
  };
}

function compactLocalSceneStateInput(input: LocalSceneStateInput): LocalSceneStateInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as LocalSceneStateInput;
}

function localSceneTarget(notification: KindroidChatNotification): { scope: LocalSceneScope; id: string } | null {
  if (notification.type === "kindroid.chat.changed") {
    return notification.kinId ? { scope: "kin", id: notification.kinId } : null;
  }

  return notification.groupId ? { scope: "group", id: notification.groupId } : null;
}

function localSceneKey(scope: LocalSceneScope, id: string): string {
  return `${scope}:${id}`;
}

function hasScenePayload(input: LocalSceneStateInput): boolean {
  return Boolean(
    input.location ||
    input.timeOfDay ||
    input.mood ||
    input.activity ||
    input.tension !== undefined ||
    input.privacy ||
    input.soundscape ||
    input.visualPalette ||
    input.suggestedUiAccent ||
    input.reason ||
    (input.evidence && input.evidence.length > 0)
  );
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeTension(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeMetadata(
  value: Record<string, string | number | boolean> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter((entry): entry is [string, string | number | boolean] => {
      const [key, item] = entry;
      return Boolean(key.trim()) && (typeof item === "string" || typeof item === "number" || typeof item === "boolean");
    })
    .slice(0, 12)
    .map(([key, item]) => [key.trim().slice(0, 60), typeof item === "string" ? item.trim().slice(0, 120) : item]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeStringArray(values: string[] | undefined, maxCount: number, maxLength: number): string[] | undefined {
  const normalized = [...new Set((values ?? []).map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean))]
    .slice(0, maxCount)
    .map((value) => value.slice(0, maxLength));
  return normalized.length > 0 ? normalized : undefined;
}
