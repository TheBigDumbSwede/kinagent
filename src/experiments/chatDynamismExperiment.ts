import type { AppConfig } from "../config/types.js";
import { FirestoreRestClient } from "../firestore/firestoreRestClient.js";
import {
  clampChatDynamism,
  defaultChatDynamismBounds,
  normalizeChatDynamismInput,
  parseChatDynamismValue,
  roundChatDynamismStep
} from "../kindroid/chatDynamism.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import { buildUpdateChatDynamismPayload } from "../kindroid/payloads.js";
import { newRequestId } from "../util/ids.js";
import type { Logger } from "../util/logger.js";
import { redactSecrets } from "../util/logger.js";

const chatDynamismField = "user_set_temperature";
const defaultObserveSeconds = 3;

export interface RunChatDynamismExperimentOptions {
  kinId: string;
  target?: string | number;
  dryRun?: boolean;
  restore?: boolean;
  requestId?: string;
  observeSeconds?: number;
  method?: "update-info" | "firestore";
  force?: boolean;
}

export type ChatDynamismExperimentConclusion =
  | "accepted-and-applied"
  | "accepted-but-not-applied"
  | "rejected"
  | "unknown";

export interface ChatDynamismReadReport {
  aiId: string;
  aiName?: string;
  fieldName: "user_set_temperature";
  displayName: "Chat Dynamism";
  raw: unknown;
  numeric: number | null;
  display: string;
  adjacentFields: {
    reasoning_effort?: unknown;
    llm_flair?: unknown;
  };
}

export interface ChatDynamismExperimentReport {
  experiment: "kindroid.chat_dynamism";
  dryRun: boolean;
  method: "update-info" | "firestore";
  aiId: string;
  aiName?: string;
  fieldName: "user_set_temperature";
  displayName: "Chat Dynamism";
  requestId: string;
  beforeRaw: unknown;
  beforeNumeric: number | null;
  target?: number;
  payloadPreview?: Record<string, unknown>;
  writeOk?: boolean;
  writeStatus?: number;
  writeError?: string;
  afterRaw?: unknown;
  afterNumeric?: number | null;
  changed?: boolean;
  restoreAttempted: boolean;
  restoreOk?: boolean;
  restoredRaw?: unknown;
  restoredNumeric?: number | null;
  warning?: string;
  conclusion: ChatDynamismExperimentConclusion;
}

export async function readChatDynamism(
  config: AppConfig,
  logger: Logger,
  aiId: string
): Promise<ChatDynamismReadReport> {
  const profile = await readKinProfile(config, logger, aiId);
  const parsed = parseChatDynamismValue(profile.data[chatDynamismField]);
  return {
    aiId,
    aiName: stringField(profile.data.ai_name),
    fieldName: chatDynamismField,
    displayName: "Chat Dynamism",
    raw: parsed.raw,
    numeric: parsed.numeric,
    display: parsed.display,
    adjacentFields: {
      reasoning_effort: profile.data.reasoning_effort,
      llm_flair: profile.data.llm_flair
    }
  };
}

export async function runChatDynamismExperiment(
  config: AppConfig,
  logger: Logger,
  options: RunChatDynamismExperimentOptions
): Promise<ChatDynamismExperimentReport> {
  const aiId = options.kinId.trim();
  if (!aiId) {
    throw new Error("--kin is required.");
  }

  const method = options.method ?? "update-info";
  const observeSeconds = options.observeSeconds ?? defaultObserveSeconds;
  validateObserveSeconds(observeSeconds);

  const requestId = options.requestId?.trim() || newRequestId();
  const before = await readKinProfile(config, logger, aiId);
  const beforeParsed = parseChatDynamismValue(before.data[chatDynamismField]);
  const restore = options.restore ?? true;
  const target = options.target === undefined ? undefined : normalizeTarget(options.target, Boolean(options.force));

  if (method === "firestore") {
    return {
      experiment: "kindroid.chat_dynamism",
      dryRun: Boolean(options.dryRun),
      method,
      aiId,
      aiName: stringField(before.data.ai_name),
      fieldName: chatDynamismField,
      displayName: "Chat Dynamism",
      requestId,
      beforeRaw: beforeParsed.raw,
      beforeNumeric: beforeParsed.numeric,
      target,
      restoreAttempted: false,
      warning: "Direct Firestore mutation is intentionally not implemented in this first pass.",
      conclusion: "unknown"
    };
  }

  if (options.dryRun) {
    const previewTarget = target ?? beforeParsed.numeric;
    return {
      experiment: "kindroid.chat_dynamism",
      dryRun: true,
      method,
      aiId,
      aiName: stringField(before.data.ai_name),
      fieldName: chatDynamismField,
      displayName: "Chat Dynamism",
      requestId,
      beforeRaw: beforeParsed.raw,
      beforeNumeric: beforeParsed.numeric,
      target: previewTarget ?? undefined,
      payloadPreview:
        previewTarget === null || previewTarget === undefined
          ? undefined
          : buildUpdateChatDynamismPayload({ aiId, value: previewTarget }),
      restoreAttempted: false,
      conclusion: "unknown"
    };
  }

  if (target === undefined) {
    throw new Error("--target is required unless --dry-run is set.");
  }
  if (beforeParsed.numeric === null && !options.force) {
    throw new Error(
      "Refusing to write because the current Chat Dynamism value could not be read. Use --force to test."
    );
  }
  if (!restore && !options.force) {
    throw new Error("Refusing --no-restore without --force.");
  }

  const client = new KindroidClient(config, logger);
  const writeResult = await client.updateChatDynamism({ aiId, value: target });
  if (observeSeconds > 0) {
    await sleep(observeSeconds * 1000);
  }
  const after = writeResult.ok ? await readKinProfile(config, logger, aiId) : before;
  const afterParsed = parseChatDynamismValue(after.data[chatDynamismField]);
  const changed = writeResult.ok ? afterParsed.numeric === target || afterParsed.raw !== beforeParsed.raw : false;

  let restoreOk: boolean | undefined;
  let restoredRaw: unknown;
  let restoredNumeric: number | null | undefined;
  if (restore && beforeParsed.numeric !== null) {
    const restoreResult = await client.updateChatDynamism({ aiId, value: beforeParsed.numeric });
    if (restoreResult.ok && observeSeconds > 0) {
      await sleep(observeSeconds * 1000);
    }
    const restored = restoreResult.ok ? await readKinProfile(config, logger, aiId) : after;
    const restoredParsed = parseChatDynamismValue(restored.data[chatDynamismField]);
    restoredRaw = restoredParsed.raw;
    restoredNumeric = restoredParsed.numeric;
    restoreOk = restoreResult.ok && restoredParsed.numeric === beforeParsed.numeric;
  }

  return {
    experiment: "kindroid.chat_dynamism",
    dryRun: false,
    method,
    aiId,
    aiName: stringField(before.data.ai_name),
    fieldName: chatDynamismField,
    displayName: "Chat Dynamism",
    requestId,
    beforeRaw: beforeParsed.raw,
    beforeNumeric: beforeParsed.numeric,
    target,
    writeOk: writeResult.ok,
    writeStatus: writeResult.status,
    writeError: writeResult.responseText ? redactSecrets(writeResult.responseText) : undefined,
    afterRaw: afterParsed.raw,
    afterNumeric: afterParsed.numeric,
    changed,
    restoreAttempted: restore && beforeParsed.numeric !== null,
    restoreOk,
    restoredRaw,
    restoredNumeric,
    warning: restore ? undefined : "Restore disabled by explicit --no-restore and --force.",
    conclusion: conclude(writeResult.ok, changed)
  };
}

async function readKinProfile(
  config: AppConfig,
  logger: Logger,
  aiId: string
): Promise<{ id: string; data: Record<string, unknown> }> {
  const rest = new FirestoreRestClient(config, logger);
  const uid = await rest.resolveUid();
  const documents = await rest.listDocuments({
    collectionPath: `Users/${uid}/AIs`,
    pageSize: 100,
    logLabel: "chatDynamism.kins"
  });
  const document = documents.find((candidate) => {
    const data = candidate.data() as Record<string, unknown>;
    return data.ai_id === aiId || candidate.id === aiId;
  });
  if (!document) {
    throw new Error(`Kin not found for ai_id ${aiId}.`);
  }

  return {
    id: document.id,
    data: document.data() as Record<string, unknown>
  };
}

function normalizeTarget(value: string | number, force: boolean): number {
  const rounded = roundChatDynamismStep(normalizeChatDynamismInput(value));
  const clamped = clampChatDynamism(rounded);
  if (rounded !== clamped && !force) {
    throw new Error(
      `Chat Dynamism target must be between ${defaultChatDynamismBounds.min} and ${defaultChatDynamismBounds.max}.`
    );
  }

  return force ? rounded : clamped;
}

function conclude(writeOk: boolean, changed: boolean): ChatDynamismExperimentConclusion {
  if (!writeOk) {
    return "rejected";
  }
  return changed ? "accepted-and-applied" : "accepted-but-not-applied";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateObserveSeconds(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--observe-seconds must be a non-negative number.");
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
