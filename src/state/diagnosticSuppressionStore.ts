import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

const suppressionFileName = "diagnostic-suppressions.json";
const startSkewMs = 5_000;

export interface DiagnosticSuppressionRecord {
  kinId: string;
  reason: string;
  startsAt: number;
  expiresAt: number;
}

interface DiagnosticSuppressionState {
  suppressions: DiagnosticSuppressionRecord[];
}

export function recordDiagnosticSuppression(
  config: AppConfig,
  input: { kinId: string; reason: string; durationMs: number; now?: number }
): DiagnosticSuppressionRecord {
  const now = input.now ?? Date.now();
  const record: DiagnosticSuppressionRecord = {
    kinId: input.kinId,
    reason: input.reason,
    startsAt: now - startSkewMs,
    expiresAt: now + input.durationMs
  };
  const filePath = diagnosticSuppressionPath(config);
  const state = loadSuppressionState(filePath, now);
  state.suppressions.push(record);
  saveSuppressionState(filePath, state);
  return record;
}

export function findActiveDiagnosticSuppression(
  config: AppConfig,
  input: { kinId: string; timestamp: string | null; now?: number }
): DiagnosticSuppressionRecord | null {
  const now = input.now ?? Date.now();
  const filePath = diagnosticSuppressionPath(config);
  const state = loadSuppressionState(filePath, now);
  saveSuppressionState(filePath, state);
  const eventTime = parseEventTime(input.timestamp, now);

  return (
    state.suppressions.find((record) => {
      return record.kinId === input.kinId && eventTime >= record.startsAt && eventTime <= record.expiresAt;
    }) ?? null
  );
}

function diagnosticSuppressionPath(config: AppConfig): string {
  return path.join(path.dirname(config.bridge.sqlitePath), suppressionFileName);
}

function loadSuppressionState(filePath: string, now: number): DiagnosticSuppressionState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!isSuppressionState(parsed)) {
      return { suppressions: [] };
    }

    return {
      suppressions: parsed.suppressions.filter((record) => record.expiresAt >= now)
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { suppressions: [] };
    }
    return { suppressions: [] };
  }
}

function saveSuppressionState(filePath: string, state: DiagnosticSuppressionState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseEventTime(timestamp: string | null, fallback: number): number {
  if (!timestamp) {
    return fallback;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSuppressionState(value: unknown): value is DiagnosticSuppressionState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.suppressions) && record.suppressions.every(isSuppressionRecord);
}

function isSuppressionRecord(value: unknown): value is DiagnosticSuppressionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.kinId === "string" &&
    typeof record.reason === "string" &&
    typeof record.startsAt === "number" &&
    typeof record.expiresAt === "number"
  );
}
