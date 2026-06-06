import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";

export type PreviouslyOnScope = "kin" | "group";

export interface PreviouslyOnBriefInput {
  facts?: string[];
  inferredTone?: string;
  unresolvedThreads?: string[];
  suggestedOpeningFrame?: string;
  recap?: string;
  confidence?: "low" | "medium" | "high";
}

export interface PreviouslyOnBrief extends PreviouslyOnBriefInput {
  scope: PreviouslyOnScope;
  kinId?: string;
  groupId?: string;
  latestSpeakerKinId?: string | null;
  updatedAt: string;
  sourceDocumentId: string;
  sourceTimestamp: string | null;
}

interface PreviouslyOnBriefFile {
  briefs?: Record<string, PreviouslyOnBrief>;
}

export class PreviouslyOnStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): PreviouslyOnStore {
    return new PreviouslyOnStore(previouslyOnPath(config));
  }

  list(): PreviouslyOnBrief[] {
    return Object.values(this.read().briefs ?? {}).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getForKin(kinId: string): PreviouslyOnBrief | null {
    return this.read().briefs?.[previouslyOnKey("kin", kinId)] ?? null;
  }

  getForGroup(groupId: string): PreviouslyOnBrief | null {
    return this.read().briefs?.[previouslyOnKey("group", groupId)] ?? null;
  }

  update(notification: KindroidChatNotification, input: PreviouslyOnBriefInput): PreviouslyOnBrief | null {
    const target = previouslyOnTarget(notification);
    if (!target) {
      return null;
    }

    const normalized = compactPreviouslyOnInput(normalizePreviouslyOnInput(input));
    if (!hasPreviouslyOnPayload(normalized)) {
      return null;
    }

    const file = this.read();
    const briefs = file.briefs ?? {};
    const key = previouslyOnKey(target.scope, target.id);
    const now = new Date().toISOString();
    const next: PreviouslyOnBrief = {
      ...normalized,
      scope: target.scope,
      kinId: target.scope === "kin" ? target.id : undefined,
      groupId: target.scope === "group" ? target.id : undefined,
      latestSpeakerKinId: notification.type === "kindroid.group_chat.changed" ? notification.aiId : undefined,
      updatedAt: now,
      sourceDocumentId: notification.documentId,
      sourceTimestamp: notification.timestamp
    };

    briefs[key] = next;
    this.write({ ...file, briefs });
    return next;
  }

  private read(): PreviouslyOnBriefFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PreviouslyOnBriefFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: PreviouslyOnBriefFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function previouslyOnPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "previously-on-state.json");
}

export function normalizePreviouslyOnInput(input: PreviouslyOnBriefInput): PreviouslyOnBriefInput {
  return {
    facts: normalizeStringArray(input.facts, 5, 180),
    inferredTone: optionalText(input.inferredTone, 160),
    unresolvedThreads: normalizeStringArray(input.unresolvedThreads, 4, 180),
    suggestedOpeningFrame: optionalText(input.suggestedOpeningFrame, 220),
    recap: optionalText(input.recap, 500),
    confidence: normalizeConfidence(input.confidence)
  };
}

function compactPreviouslyOnInput(input: PreviouslyOnBriefInput): PreviouslyOnBriefInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as PreviouslyOnBriefInput;
}

function previouslyOnTarget(notification: KindroidChatNotification): { scope: PreviouslyOnScope; id: string } | null {
  if (notification.type === "kindroid.chat.changed") {
    return notification.kinId ? { scope: "kin", id: notification.kinId } : null;
  }

  return notification.groupId ? { scope: "group", id: notification.groupId } : null;
}

function previouslyOnKey(scope: PreviouslyOnScope, id: string): string {
  return `${scope}:${id}`;
}

function hasPreviouslyOnPayload(input: PreviouslyOnBriefInput): boolean {
  return Boolean(
    input.recap ||
    input.inferredTone ||
    input.suggestedOpeningFrame ||
    (input.facts && input.facts.length > 0) ||
    (input.unresolvedThreads && input.unresolvedThreads.length > 0)
  );
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeStringArray(values: string[] | undefined, maxCount: number, maxLength: number): string[] | undefined {
  const normalized = [...new Set((values ?? []).map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean))]
    .slice(0, maxCount)
    .map((value) => value.slice(0, maxLength));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeConfidence(value: PreviouslyOnBriefInput["confidence"]): PreviouslyOnBriefInput["confidence"] {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
