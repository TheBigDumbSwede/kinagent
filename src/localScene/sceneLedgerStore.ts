import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import {
  type CanonConfidence,
  type CanonLifecycleStatus,
  type CanonProvenance,
  type CanonProvenanceInput,
  normalizeCanonProvenance
} from "../state/canonLayers.js";

export type SceneLedgerScope = "kin" | "group";

export const sceneLedgerFactKinds = [
  "location",
  "time_of_day",
  "activity",
  "participant",
  "object",
  "tone",
  "unresolved_thread",
  "privacy"
] as const;

export type SceneLedgerFactKind = (typeof sceneLedgerFactKinds)[number];
export type SceneLedgerReviewStatus = "unreviewed" | "reviewed" | "rejected";

export interface SceneLedgerSource {
  scope: SceneLedgerScope;
  kinId?: string;
  groupId?: string;
}

export interface SceneLedgerFactInput {
  id?: unknown;
  kind?: unknown;
  value?: unknown;
  confidence?: unknown;
  status?: unknown;
  reviewStatus?: unknown;
  provenance?: CanonProvenanceInput;
  reason?: unknown;
}

export interface SceneLedgerFact {
  id: string;
  layer: "scene_state";
  kind: SceneLedgerFactKind;
  value: string;
  confidence: CanonConfidence;
  status: Extract<CanonLifecycleStatus, "candidate" | "active" | "dismissed" | "stale" | "expired" | "superseded">;
  reviewStatus: SceneLedgerReviewStatus;
  createdAt: string;
  updatedAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  provenance?: CanonProvenance;
  reason?: string;
}

export interface SceneLedgerRecord {
  sourceKey: string;
  scope: SceneLedgerScope;
  kinId?: string;
  groupId?: string;
  sceneStartedAt: string;
  updatedAt: string;
  facts: SceneLedgerFact[];
}

interface SceneLedgerFile {
  ledgers?: Record<string, SceneLedgerRecord>;
}

export class SceneLedgerStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): SceneLedgerStore {
    return new SceneLedgerStore(sceneLedgerPath(config));
  }

  list(): SceneLedgerRecord[] {
    return Object.values(this.read().ledgers ?? {}).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  getForKin(kinId: string): SceneLedgerRecord | null {
    return this.get({ scope: "kin", kinId });
  }

  getForGroup(groupId: string): SceneLedgerRecord | null {
    return this.get({ scope: "group", groupId });
  }

  get(source: SceneLedgerSource): SceneLedgerRecord | null {
    const key = sceneLedgerSourceKey(source);
    return key ? (this.read().ledgers?.[key] ?? null) : null;
  }

  replaceFacts(
    source: SceneLedgerSource,
    facts: SceneLedgerFactInput[],
    options: { now?: string } = {}
  ): SceneLedgerRecord {
    const target = normalizeSource(source);
    const now = normalizeTimestamp(options.now) ?? new Date().toISOString();
    const previous = this.get(target);
    const normalizedFacts = facts
      .map((fact) =>
        normalizeSceneLedgerFactInput(fact, {
          sourceKey: target.sourceKey,
          previous: undefined,
          now
        })
      )
      .filter((fact): fact is SceneLedgerFact => Boolean(fact));
    const next = sceneLedgerRecord(target, {
      previous,
      facts: normalizedFacts,
      now
    });
    this.save(next);
    return next;
  }

  upsertFact(
    source: SceneLedgerSource,
    fact: SceneLedgerFactInput,
    options: { now?: string } = {}
  ): SceneLedgerFact | null {
    const target = normalizeSource(source);
    const now = normalizeTimestamp(options.now) ?? new Date().toISOString();
    const previousRecord = this.get(target);
    const seed = normalizeSceneLedgerFactInput(fact, {
      sourceKey: target.sourceKey,
      previous: undefined,
      now
    });
    if (!seed) {
      return null;
    }

    const previousFact = previousRecord?.facts.find((item) => item.id === seed.id);
    const nextFact = normalizeSceneLedgerFactInput(fact, {
      sourceKey: target.sourceKey,
      previous: previousFact,
      now
    });
    if (!nextFact) {
      return null;
    }

    const facts = previousRecord
      ? [nextFact, ...previousRecord.facts.filter((item) => item.id !== nextFact.id)]
      : [nextFact];
    const next = sceneLedgerRecord(target, {
      previous: previousRecord,
      facts,
      now
    });
    this.save(next);
    return nextFact;
  }

  markFactStale(
    source: SceneLedgerSource,
    factId: string,
    input: { reason?: string; now?: string } = {}
  ): SceneLedgerFact | null {
    const target = normalizeSource(source);
    const previous = this.get(target);
    if (!previous) {
      return null;
    }

    const now = normalizeTimestamp(input.now) ?? new Date().toISOString();
    let staleFact: SceneLedgerFact | null = null;
    const facts = previous.facts.map((fact) => {
      if (fact.id !== factId) {
        return fact;
      }
      staleFact = {
        ...fact,
        status: "stale",
        updatedAt: now,
        reason: optionalText(input.reason, 280) ?? fact.reason
      };
      return staleFact;
    });

    if (!staleFact) {
      return null;
    }

    this.save({ ...previous, facts, updatedAt: now });
    return staleFact;
  }

  private read(): SceneLedgerFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SceneLedgerFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private save(record: SceneLedgerRecord): void {
    const file = this.read();
    const ledgers = file.ledgers ?? {};
    ledgers[record.sourceKey] = record;
    this.write({ ...file, ledgers });
  }

  private write(file: SceneLedgerFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function sceneLedgerPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "scene-ledger-state.json");
}

export function sceneLedgerSourceKey(source: SceneLedgerSource): string | null {
  if (source.scope === "kin" && source.kinId?.trim()) {
    return `kin:${source.kinId.trim()}`;
  }
  if (source.scope === "group" && source.groupId?.trim()) {
    return `group:${source.groupId.trim()}`;
  }
  return null;
}

export function normalizeSceneLedgerFactKind(value: unknown): SceneLedgerFactKind | null {
  const key = canonicalKey(value);
  if (!key) {
    return null;
  }
  return sceneLedgerFactKindAliases[key] ?? null;
}

export function normalizeSceneLedgerFactInput(
  input: SceneLedgerFactInput,
  context: { sourceKey: string; previous?: SceneLedgerFact; now?: string }
): SceneLedgerFact | null {
  const kind = normalizeSceneLedgerFactKind(input.kind) ?? context.previous?.kind;
  const value = optionalText(input.value, 220) ?? context.previous?.value;
  if (!kind || !value) {
    return null;
  }

  const now = normalizeTimestamp(context.now) ?? new Date().toISOString();
  const provenance = input.provenance ? normalizeCanonProvenance(input.provenance) : context.previous?.provenance;
  const createdAt = context.previous?.createdAt ?? now;
  const firstObservedAt =
    context.previous?.firstObservedAt ?? provenance?.sourceTimestamp ?? provenance?.observedAt ?? now;
  const lastObservedAt = provenance?.sourceTimestamp ?? provenance?.observedAt ?? now;
  const reason = optionalText(input.reason, 280) ?? context.previous?.reason;

  return {
    id: optionalText(input.id, 180) ?? context.previous?.id ?? sceneLedgerFactId(context.sourceKey, kind, value),
    layer: "scene_state",
    kind,
    value,
    confidence: normalizeConfidence(input.confidence) ?? context.previous?.confidence ?? "medium",
    status: normalizeFactStatus(input.status) ?? context.previous?.status ?? "active",
    reviewStatus: normalizeReviewStatus(input.reviewStatus) ?? context.previous?.reviewStatus ?? "unreviewed",
    createdAt,
    updatedAt: now,
    firstObservedAt,
    lastObservedAt,
    ...(provenance && Object.keys(provenance).length > 0 ? { provenance } : {}),
    ...(reason ? { reason } : {})
  };
}

function sceneLedgerRecord(
  target: NormalizedSceneLedgerSource,
  input: { previous: SceneLedgerRecord | null; facts: SceneLedgerFact[]; now: string }
): SceneLedgerRecord {
  return {
    sourceKey: target.sourceKey,
    scope: target.scope,
    kinId: target.scope === "kin" ? target.kinId : undefined,
    groupId: target.scope === "group" ? target.groupId : undefined,
    sceneStartedAt: input.previous?.sceneStartedAt ?? input.now,
    updatedAt: input.now,
    facts: input.facts
  };
}

function normalizeSource(source: SceneLedgerSource): NormalizedSceneLedgerSource {
  if (source.scope === "kin") {
    const kinId = source.kinId?.trim();
    if (kinId) {
      return { scope: "kin", kinId, sourceKey: `kin:${kinId}` };
    }
  }
  if (source.scope === "group") {
    const groupId = source.groupId?.trim();
    if (groupId) {
      return { scope: "group", groupId, sourceKey: `group:${groupId}` };
    }
  }
  throw new Error("Scene ledger source requires a scope and matching source id.");
}

type NormalizedSceneLedgerSource =
  | { scope: "kin"; kinId: string; sourceKey: string }
  | { scope: "group"; groupId: string; sourceKey: string };

const sceneLedgerFactKindAliases: Record<string, SceneLedgerFactKind> = {
  location: "location",
  setting: "location",
  place: "location",
  time: "time_of_day",
  time_of_day: "time_of_day",
  timeofday: "time_of_day",
  activity: "activity",
  action: "activity",
  participant: "participant",
  participants: "participant",
  actor: "participant",
  character: "participant",
  object: "object",
  objects: "object",
  prop: "object",
  props: "object",
  tone: "tone",
  mood: "tone",
  energy: "tone",
  unresolved_thread: "unresolved_thread",
  unresolved: "unresolved_thread",
  thread: "unresolved_thread",
  open_beat: "unresolved_thread",
  privacy: "privacy"
};

const factStatuses: SceneLedgerFact["status"][] = [
  "candidate",
  "active",
  "dismissed",
  "stale",
  "expired",
  "superseded"
];

function normalizeFactStatus(value: unknown): SceneLedgerFact["status"] | undefined {
  const key = canonicalKey(value);
  return factStatuses.find((status) => status === key);
}

function normalizeConfidence(value: unknown): CanonConfidence | undefined {
  const key = canonicalKey(value);
  return key === "low" || key === "medium" || key === "high" ? key : undefined;
}

function normalizeReviewStatus(value: unknown): SceneLedgerReviewStatus | undefined {
  const key = canonicalKey(value);
  return key === "unreviewed" || key === "reviewed" || key === "rejected" ? key : undefined;
}

function sceneLedgerFactId(sourceKey: string, kind: SceneLedgerFactKind, value: string): string {
  return `${sourceKey}:${kind}:${slug(value)}`;
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "fact"
  );
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  const text = optionalText(value, 80);
  if (!text) {
    return undefined;
  }
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : undefined;
}

function canonicalKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}
