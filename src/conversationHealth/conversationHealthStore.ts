import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import {
  analyzeRepetitivePhrasing,
  type ConversationHealthEvidence,
  type ConversationHealthMessage,
  type ConversationHealthSignalScope,
  type ConversationHealthSignalSeverity,
  type ConversationHealthSignalType
} from "./repetitionDiagnostic.js";

export type ConversationHealthSignalStatus = "active" | "dismissed" | "muted";

export interface ConversationHealthSignal {
  id: string;
  type: ConversationHealthSignalType;
  scope: ConversationHealthSignalScope;
  sourceId: string;
  sourceName?: string;
  subjectKinId?: string;
  subjectName?: string;
  severity: ConversationHealthSignalSeverity;
  status: ConversationHealthSignalStatus;
  fingerprint: string;
  summary: string;
  evidence: ConversationHealthEvidence[];
  sourceDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationHealthSourceState {
  messages?: ConversationHealthMessage[];
  signals?: ConversationHealthSignal[];
}

interface ConversationHealthFile {
  sources?: Record<string, ConversationHealthSourceState>;
}

export interface ConversationHealthStoreOptions {
  maxMessagesPerSource?: number;
  maxSignalsPerSource?: number;
  throttleMs?: number;
  now?: () => Date;
}

const healthFileName = "conversation-health-signals.json";
const defaultMaxMessagesPerSource = 8;
const defaultMaxSignalsPerSource = 50;
const defaultThrottleMs = 6 * 60 * 60 * 1000;

export class ConversationHealthStore {
  private readonly maxMessagesPerSource: number;
  private readonly maxSignalsPerSource: number;
  private readonly throttleMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly filePath: string,
    options: ConversationHealthStoreOptions = {}
  ) {
    this.maxMessagesPerSource = positiveInteger(options.maxMessagesPerSource, defaultMaxMessagesPerSource);
    this.maxSignalsPerSource = positiveInteger(options.maxSignalsPerSource, defaultMaxSignalsPerSource);
    this.throttleMs = positiveInteger(options.throttleMs, defaultThrottleMs);
    this.now = options.now ?? (() => new Date());
  }

  static fromConfig(config: AppConfig, options: ConversationHealthStoreOptions = {}): ConversationHealthStore {
    return new ConversationHealthStore(conversationHealthPath(config), options);
  }

  recordMessage(message: ConversationHealthMessage): ConversationHealthSignal | null {
    const normalized = normalizeMessage(message);
    if (!normalized) {
      return null;
    }

    const file = this.read();
    const sources = file.sources ?? {};
    const key = sourceKey(normalized);
    const current = sources[key] ?? {};
    const messages = upsertMessage(current.messages ?? [], normalized, this.maxMessagesPerSource);
    const diagnostic = analyzeRepetitivePhrasing(messages);
    sources[key] = { ...current, messages };
    if (!diagnostic) {
      this.write({ ...file, sources });
      return null;
    }

    const signals = current.signals ?? [];
    if (isSuppressed(signals, diagnostic.fingerprint, this.now().getTime(), this.throttleMs)) {
      this.write({ ...file, sources });
      return null;
    }

    const now = this.now().toISOString();
    const signal: ConversationHealthSignal = {
      id: `${now}-${key}-${diagnostic.fingerprint}`.replace(/[^\w.-]+/g, "-"),
      type: diagnostic.type,
      scope: normalized.scope,
      sourceId: normalized.sourceId,
      ...(normalized.sourceName ? { sourceName: normalized.sourceName } : {}),
      ...(normalized.subjectKinId ? { subjectKinId: normalized.subjectKinId } : {}),
      ...(normalized.subjectName ? { subjectName: normalized.subjectName } : {}),
      severity: diagnostic.severity,
      status: "active",
      fingerprint: diagnostic.fingerprint,
      summary: diagnostic.summary,
      evidence: diagnostic.evidence,
      sourceDocumentIds: diagnostic.sourceDocumentIds,
      createdAt: now,
      updatedAt: now
    };

    sources[key] = {
      ...current,
      messages,
      signals: [signal, ...signals].slice(0, this.maxSignalsPerSource)
    };
    this.write({ ...file, sources });
    return signal;
  }

  list(status?: ConversationHealthSignalStatus): ConversationHealthSignal[] {
    const signals = Object.values(this.read().sources ?? {}).flatMap((source) => source.signals ?? []);
    const filtered = status ? signals.filter((signal) => signal.status === status) : signals;
    return [...filtered].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  dismissSignal(id: string): ConversationHealthSignal | null {
    return this.updateSignalStatus(id, "dismissed");
  }

  muteSignal(id: string): ConversationHealthSignal | null {
    return this.updateSignalStatus(id, "muted");
  }

  private updateSignalStatus(id: string, status: ConversationHealthSignalStatus): ConversationHealthSignal | null {
    const signalId = id.trim();
    if (!signalId) {
      return null;
    }

    const file = this.read();
    const sources = file.sources ?? {};
    const now = this.now().toISOString();
    let updatedSignal: ConversationHealthSignal | null = null;
    for (const [key, source] of Object.entries(sources)) {
      const signals = source.signals ?? [];
      const nextSignals = signals.map((signal) => {
        if (signal.id !== signalId) {
          return signal;
        }
        updatedSignal = { ...signal, status, updatedAt: now };
        return updatedSignal;
      });
      sources[key] = { ...source, signals: nextSignals };
    }

    if (updatedSignal) {
      this.write({ ...file, sources });
    }
    return updatedSignal;
  }

  private read(): ConversationHealthFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ConversationHealthFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: ConversationHealthFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function conversationHealthPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), healthFileName);
}

function normalizeMessage(message: ConversationHealthMessage): ConversationHealthMessage | null {
  const sourceId = message.sourceId.trim();
  const documentId = message.documentId.trim();
  const text = message.text.trim().replace(/\s+/g, " ");
  if (!sourceId || !documentId || !text) {
    return null;
  }
  return {
    scope: message.scope,
    sourceId,
    ...(optionalText(message.sourceName) ? { sourceName: optionalText(message.sourceName) } : {}),
    ...(optionalText(message.subjectKinId ?? undefined) ? { subjectKinId: optionalText(message.subjectKinId) } : {}),
    ...(optionalText(message.subjectName ?? undefined) ? { subjectName: optionalText(message.subjectName) } : {}),
    documentId,
    timestamp: validTimestamp(message.timestamp),
    text
  };
}

function upsertMessage(
  messages: ConversationHealthMessage[],
  message: ConversationHealthMessage,
  maxMessages: number
): ConversationHealthMessage[] {
  return [...messages.filter((current) => current.documentId !== message.documentId), message]
    .sort(compareMessages)
    .slice(-maxMessages);
}

function isSuppressed(
  signals: ConversationHealthSignal[],
  fingerprint: string,
  nowMs: number,
  throttleMs: number
): boolean {
  return signals.some((signal) => {
    if (signal.fingerprint !== fingerprint) {
      return false;
    }
    if (signal.status === "muted") {
      return true;
    }
    const createdAt = Date.parse(signal.createdAt);
    return Number.isFinite(createdAt) && nowMs - createdAt < throttleMs;
  });
}

function sourceKey(message: ConversationHealthMessage): string {
  return [message.scope, message.sourceId, message.subjectKinId ?? message.sourceId].join(":");
}

function compareMessages(left: ConversationHealthMessage, right: ConversationHealthMessage): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.documentId.localeCompare(right.documentId);
}

function validTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
