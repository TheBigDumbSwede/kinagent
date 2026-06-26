import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export const timelineEventTypes = [
  "app.status",
  "kindroid.message.observed",
  "hermes.request",
  "hermes.response",
  "journal.suggestion.created",
  "previously_on.generated",
  "soundscape.changed",
  "game.state.changed",
  "game.roll.resolved",
  "game.keeper.sent",
  "browser_bridge.command.queued",
  "browser_bridge.status.changed",
  "user.action"
] as const;

export type KinAgentTimelineEventType = (typeof timelineEventTypes)[number];
export type KinAgentTimelineSourceKind = "app" | "kin" | "group" | "hermes" | "game" | "browser_bridge";

export interface KinAgentTimelineSource {
  kind: KinAgentTimelineSourceKind;
  id?: string;
  documentId?: string;
}

export interface KinAgentTimelineEvent {
  id: string;
  type: KinAgentTimelineEventType;
  occurredAt: string;
  source?: KinAgentTimelineSource;
  payload?: Record<string, unknown>;
}

export interface KinAgentTimelineEventInput {
  type: KinAgentTimelineEventType;
  occurredAt?: string | Date;
  source?: KinAgentTimelineSource;
  payload?: Record<string, unknown>;
}

export interface TimelineQuery {
  sourceId?: string;
  type?: KinAgentTimelineEventType;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
}

interface TimelineFile {
  events?: unknown[];
}

export interface TimelineStoreOptions {
  maxEvents?: number;
}

const defaultMaxEvents = 500;
const maxPayloadKeys = 24;
const maxArrayValues = 20;
const maxStringLength = 240;
const maxPayloadDepth = 4;
const sourceKinds = new Set<KinAgentTimelineSourceKind>(["app", "kin", "group", "hermes", "game", "browser_bridge"]);
const eventTypeSet = new Set<KinAgentTimelineEventType>(timelineEventTypes);

export class TimelineStore {
  private readonly maxEvents: number;

  constructor(
    private readonly filePath: string,
    options: TimelineStoreOptions = {}
  ) {
    this.maxEvents = positiveInteger(options.maxEvents, defaultMaxEvents);
  }

  static fromConfig(config: AppConfig, options: TimelineStoreOptions = {}): TimelineStore {
    return new TimelineStore(timelinePath(config), options);
  }

  append(input: KinAgentTimelineEventInput): KinAgentTimelineEvent {
    const event = normalizeTimelineEvent({
      id: randomUUID(),
      type: input.type,
      occurredAt: normalizeInputDate(input.occurredAt) ?? new Date().toISOString(),
      ...(input.source ? { source: input.source } : {}),
      ...(input.payload ? { payload: input.payload } : {})
    });
    if (!event) {
      throw new Error("Timeline event input could not be normalized.");
    }

    const events = [...this.readEvents(), event].sort(compareTimelineEvents).slice(-this.maxEvents);
    this.write({ events });
    return event;
  }

  list(query: TimelineQuery = {}): KinAgentTimelineEvent[] {
    const from = optionalTime(query.from);
    const to = optionalTime(query.to);
    const sourceId = normalizeString(query.sourceId, maxStringLength);
    const filtered = this.readEvents().filter((event) => {
      if (query.type && event.type !== query.type) {
        return false;
      }
      if (sourceId && !timelineSourceMatches(event.source, sourceId)) {
        return false;
      }
      const occurredAt = Date.parse(event.occurredAt);
      if (from !== undefined && occurredAt < from) {
        return false;
      }
      if (to !== undefined && occurredAt > to) {
        return false;
      }
      return true;
    });

    const limit = query.limit ? positiveInteger(query.limit, filtered.length) : undefined;
    return limit ? filtered.slice(-limit) : filtered;
  }

  private readEvents(): KinAgentTimelineEvent[] {
    const parsed = this.readFile();
    return (parsed.events ?? [])
      .map((event) => normalizeTimelineEvent(event))
      .filter((event): event is KinAgentTimelineEvent => Boolean(event))
      .sort(compareTimelineEvents)
      .slice(-this.maxEvents);
  }

  private readFile(): TimelineFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        return { events: parsed };
      }
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as TimelineFile).events)) {
        return parsed as TimelineFile;
      }
    } catch {
      return {};
    }
    return {};
  }

  private write(file: { events: KinAgentTimelineEvent[] }): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function timelinePath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "timeline-events.json");
}

export function normalizeTimelineEvent(value: unknown): KinAgentTimelineEvent | null {
  const record = objectRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeString(record.id, maxStringLength);
  const type = normalizeTimelineEventType(record.type);
  const occurredAt = normalizeInputDate(record.occurredAt);
  if (!id || !type || !occurredAt) {
    return null;
  }

  const source = normalizeTimelineSource(record.source);
  const payload = normalizePayloadRecord(record.payload);
  return {
    id,
    type,
    occurredAt,
    ...(source ? { source } : {}),
    ...(payload ? { payload } : {})
  };
}

function normalizeTimelineEventType(value: unknown): KinAgentTimelineEventType | null {
  return typeof value === "string" && eventTypeSet.has(value as KinAgentTimelineEventType)
    ? (value as KinAgentTimelineEventType)
    : null;
}

function normalizeTimelineSource(value: unknown): KinAgentTimelineSource | undefined {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }

  const kind =
    typeof record.kind === "string" && sourceKinds.has(record.kind as KinAgentTimelineSourceKind)
      ? (record.kind as KinAgentTimelineSourceKind)
      : undefined;
  if (!kind) {
    return undefined;
  }

  return {
    kind,
    ...(normalizeString(record.id, maxStringLength) ? { id: normalizeString(record.id, maxStringLength) } : {}),
    ...(normalizeString(record.documentId, maxStringLength)
      ? { documentId: normalizeString(record.documentId, maxStringLength) }
      : {})
  };
}

function normalizePayloadRecord(value: unknown): Record<string, unknown> | undefined {
  const normalized = normalizePayloadValue(value, 0);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? (normalized as Record<string, unknown>)
    : undefined;
}

function normalizePayloadValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return normalizeString(value, maxStringLength);
  }
  if (value instanceof Date) {
    return normalizeInputDate(value);
  }
  if (depth >= maxPayloadDepth) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayValues)
      .map((item) => normalizePayloadValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record)
    .slice(0, maxPayloadKeys)
    .map(([key, item]) => [normalizeString(key, 80), normalizePayloadValue(item, depth + 1)] as const)
    .filter((entry): entry is readonly [string, unknown] => Boolean(entry[0]) && entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function timelineSourceMatches(source: KinAgentTimelineSource | undefined, sourceId: string): boolean {
  return source?.id === sourceId || source?.documentId === sourceId;
}

function optionalTime(value: string | Date | undefined): number | undefined {
  const normalized = normalizeInputDate(value);
  return normalized ? Date.parse(normalized) : undefined;
}

function normalizeInputDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function compareTimelineEvents(left: KinAgentTimelineEvent, right: KinAgentTimelineEvent): number {
  const timeComparison = left.occurredAt.localeCompare(right.occurredAt);
  return timeComparison === 0 ? left.id.localeCompare(right.id) : timeComparison;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeString(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
