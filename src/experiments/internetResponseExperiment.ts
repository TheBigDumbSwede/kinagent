import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { NormalizedKindroidMessage } from "../firestore/types.js";
import { loadRecentKindroidChatHistoryMessages } from "../kindroid/chatHistory.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import { buildSendGroupMessagePayload, buildSendMessagePayload } from "../kindroid/payloads.js";
import { recordDiagnosticSuppression, type DiagnosticSuppressionRecord } from "../state/diagnosticSuppressionStore.js";
import { createDedupeStore } from "../state/sqliteStore.js";
import { newRequestId } from "../util/ids.js";
import type { Logger } from "../util/logger.js";
import { redactSecrets } from "../util/logger.js";

const defaultDelayMs = 15_000;
const defaultObserveSeconds = 60;
const recentMessageLimit = 20;
const snippetLength = 240;

export interface RunInternetResponseExperimentOptions {
  kinId?: string;
  groupId?: string;
  message?: string;
  internetResponse?: string;
  internetResponseFile?: string;
  expectedTexts?: string[];
  allowEmptyMessage?: boolean;
  requestId?: string;
  dryRun?: boolean;
  includeControl?: boolean;
  triggerGroupResponse?: boolean;
  delayMs?: number;
  observeSeconds?: number;
  verboseChat?: boolean;
}

export type InternetResponseConclusion = "accepted-and-used" | "accepted-but-not-used" | "rejected" | "unknown";

export interface InternetResponseExperimentReport {
  experiment: "kindroid.internet_response";
  dryRun: boolean;
  targetType: InternetResponseExperimentTargetType;
  targetId: string;
  kinId?: string;
  groupId?: string;
  canary: string;
  expectedTexts: string[];
  requestId: string;
  idempotencyKey: string;
  control?: SendReport;
  experimentSend: SendReport;
  internetResponseLength: number;
  diagnosticSuppression?: {
    reason: string;
    expiresAt: string;
  };
  observation?: ObservationReport;
  conclusion: InternetResponseConclusion;
  manualFollowUp?: string[];
}

export type InternetResponseExperimentTargetType = "kin" | "group";

interface InternetResponseExperimentTarget {
  type: InternetResponseExperimentTargetType;
  id: string;
}

interface SendReport {
  message: string;
  requestId: string;
  idempotencyKey: string;
  internetResponseSet: boolean;
  status?: number;
  ok?: boolean;
  error?: string;
  payloadPreview?: Record<string, unknown>;
}

interface ObservationReport {
  observeSeconds: number;
  checkedRecentMessages: number;
  experimentVisibleMessageObserved: boolean;
  visibleUserMessageContainsCanary: boolean;
  aiResponseAppearsToReferenceCanary: boolean;
  anyRecentMessageContainsCanary: boolean;
  visibleUserMessageContainsTrackedText: boolean;
  aiResponseAppearsToReferenceTrackedText: boolean;
  anyRecentMessageContainsTrackedText: boolean;
  matchedTrackedTexts: string[];
  recentMessages: MessageSnippet[];
}

interface MessageSnippet {
  id: string;
  timestamp: string | null;
  sender: string | null;
  role: string | null;
  text: string | null;
}

export async function runInternetResponseExperiment(
  config: AppConfig,
  logger: Logger,
  options: RunInternetResponseExperimentOptions
): Promise<InternetResponseExperimentReport> {
  const target = resolveTarget(options);
  const visibleMessage = resolveVisibleMessage(options);
  const delayMs = options.delayMs ?? defaultDelayMs;
  const observeSeconds = options.observeSeconds ?? defaultObserveSeconds;
  validateNonNegativeInteger(delayMs, "--delay-ms");
  validateNonNegativeInteger(observeSeconds, "--observe-seconds");

  const requestId = options.requestId?.trim() || newRequestId();
  const idempotencyKey = newRequestId();
  const canary = `KINAGENT-IR-${newRequestId().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const internetResponse = buildInternetResponse(options, canary);
  const expectedTexts = normalizeExpectedTexts(options.expectedTexts);
  const trackedTexts = [canary, ...expectedTexts];
  const controlMessage = `Control diagnostic ${requestId}: ${visibleMessage}`;
  const experimentMessage = visibleMessage;

  const controlReport: SendReport | undefined = options.includeControl
    ? {
        message: controlMessage,
        requestId: `${requestId}-control`,
        idempotencyKey: newRequestId(),
        internetResponseSet: false
      }
    : undefined;
  const experimentReport: SendReport = {
    message: experimentMessage,
    requestId,
    idempotencyKey,
    internetResponseSet: true
  };

  if (options.dryRun) {
    return {
      experiment: "kindroid.internet_response",
      dryRun: true,
      targetType: target.type,
      targetId: target.id,
      kinId: target.type === "kin" ? target.id : undefined,
      groupId: target.type === "group" ? target.id : undefined,
      canary,
      expectedTexts,
      requestId,
      idempotencyKey,
      control: controlReport
        ? {
            ...controlReport,
            payloadPreview: previewPayload({
              target,
              message: controlMessage,
              requestId: controlReport.requestId,
              idempotencyKey: controlReport.idempotencyKey
            })
          }
        : undefined,
      experimentSend: {
        ...experimentReport,
        payloadPreview: previewPayload({
          target,
          message: experimentMessage,
          requestId,
          idempotencyKey,
          internetResponse
        })
      },
      internetResponseLength: internetResponse.length,
      conclusion: "unknown",
      manualFollowUp: manualFollowUp(target, canary, expectedTexts)
    };
  }

  const client = new KindroidClient(config, logger);
  const dedupeStore = await createDedupeStore(config.bridge.sqlitePath, config.bridge.dedupeWindowSeconds);
  const diagnosticSuppression = recordDiagnosticSuppression(config, {
    kinId: target.id,
    reason: "internet-response-experiment",
    durationMs: diagnosticSuppressionDurationMs({ delayMs, observeSeconds, includeControl: Boolean(controlReport) })
  });

  if (controlReport) {
    await dedupeStore.recordOutbound({
      kinId: target.id,
      text: controlMessage,
      requestId: controlReport.requestId,
      idempotencyKey: controlReport.idempotencyKey
    });

    const controlResult = await sendExperimentMessage(client, {
      target,
      message: controlMessage,
      requestId: controlReport.requestId,
      idempotencyKey: controlReport.idempotencyKey,
      triggerGroupResponse: Boolean(options.triggerGroupResponse)
    });
    controlReport.status = controlResult.status;
    controlReport.ok = controlResult.ok;
    controlReport.error = controlResult.responseText ? redactSecrets(controlResult.responseText) : undefined;

    if (controlResult.ok) {
      await sleep(delayMs);
    }
  }

  await dedupeStore.recordOutbound({
    kinId: target.id,
    text: experimentMessage,
    requestId,
    idempotencyKey
  });

  const experimentResult = await sendExperimentMessage(client, {
    target,
    message: experimentMessage,
    requestId,
    idempotencyKey,
    internetResponse,
    triggerGroupResponse: Boolean(options.triggerGroupResponse)
  });
  experimentReport.status = experimentResult.status;
  experimentReport.ok = experimentResult.ok;
  experimentReport.error = experimentResult.responseText ? redactSecrets(experimentResult.responseText) : undefined;

  const observation = experimentResult.ok
    ? await observeRecentMessages(config, logger, {
        target,
        canary,
        trackedTexts,
        visibleMessages: [controlMessage, experimentMessage],
        internetResponse,
        observeSeconds,
        verboseChat: Boolean(options.verboseChat)
      })
    : undefined;

  return {
    experiment: "kindroid.internet_response",
    dryRun: false,
    targetType: target.type,
    targetId: target.id,
    kinId: target.type === "kin" ? target.id : undefined,
    groupId: target.type === "group" ? target.id : undefined,
    canary,
    expectedTexts,
    requestId,
    idempotencyKey,
    control: controlReport,
    experimentSend: experimentReport,
    internetResponseLength: internetResponse.length,
    diagnosticSuppression: toSuppressionReport(diagnosticSuppression),
    observation,
    conclusion: conclude(experimentResult.ok, observation),
    manualFollowUp: observation ? undefined : manualFollowUp(target, canary, expectedTexts)
  };
}

async function sendExperimentMessage(
  client: KindroidClient,
  input: {
    target: InternetResponseExperimentTarget;
    message: string;
    requestId: string;
    idempotencyKey: string;
    internetResponse?: string;
    triggerGroupResponse: boolean;
  }
): Promise<{ status: number; ok: boolean; requestId: string; idempotencyKey: string; responseText?: string }> {
  if (input.target.type === "group") {
    return client.sendGroupMessage({
      groupId: input.target.id,
      message: input.message,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      internetResponse: input.internetResponse,
      triggerAiResponse: input.triggerGroupResponse
    });
  }

  return client.sendMessage({
    aiId: input.target.id,
    message: input.message,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    internetResponse: input.internetResponse
  });
}

function diagnosticSuppressionDurationMs(input: {
  delayMs: number;
  observeSeconds: number;
  includeControl: boolean;
}): number {
  const controlDelayMs = input.includeControl ? input.delayMs : 0;
  return Math.max(60_000, controlDelayMs + input.observeSeconds * 1000 + 30_000);
}

function toSuppressionReport(record: DiagnosticSuppressionRecord): { reason: string; expiresAt: string } {
  return {
    reason: record.reason,
    expiresAt: new Date(record.expiresAt).toISOString()
  };
}

function buildInternetResponse(options: RunInternetResponseExperimentOptions, canary: string): string {
  if (options.internetResponse && options.internetResponseFile) {
    throw new Error("Use either --internet-response or --internet-response-file, not both.");
  }

  const supplied = options.internetResponseFile
    ? fs.readFileSync(path.resolve(process.cwd(), options.internetResponseFile), "utf8")
    : options.internetResponse;
  const base = supplied?.trim();
  const canaryInstruction = `Diagnostic canary: ${canary}. If this context is available, answer with exactly: ${canary}.`;

  return base ? `${base}\n\n${canaryInstruction}` : `Diagnostic hidden context: ${canaryInstruction}`;
}

async function observeRecentMessages(
  config: AppConfig,
  logger: Logger,
  options: {
    target: InternetResponseExperimentTarget;
    canary: string;
    trackedTexts: string[];
    visibleMessages: string[];
    internetResponse: string;
    observeSeconds: number;
    verboseChat: boolean;
  }
): Promise<ObservationReport> {
  if (options.observeSeconds > 0) {
    await sleep(options.observeSeconds * 1000);
  }

  const messages = await loadRecentKindroidChatHistoryMessages(config, logger, {
    scope: options.target.type,
    id: options.target.id,
    limit: recentMessageLimit
  });
  const experimentVisibleMessageObserved = messages.some((message) =>
    Boolean(message.text?.includes(options.visibleMessages.at(-1) ?? ""))
  );
  const visibleUserMessageContainsCanary = messages.some(
    (message) => message.text?.includes(options.canary) && isLikelyUserMessage(message, options.visibleMessages)
  );
  const aiResponseAppearsToReferenceCanary = messages.some(
    (message) => message.text?.includes(options.canary) && !isLikelyUserMessage(message, options.visibleMessages)
  );
  const anyRecentMessageContainsCanary = messages.some((message) => Boolean(message.text?.includes(options.canary)));
  const visibleUserMessageContainsTrackedText = messages.some(
    (message) =>
      containsAnyTrackedText(message.text, options.trackedTexts) &&
      isLikelyUserMessage(message, options.visibleMessages)
  );
  const aiResponseAppearsToReferenceTrackedText = messages.some(
    (message) =>
      containsAnyTrackedText(message.text, options.trackedTexts) &&
      !isLikelyUserMessage(message, options.visibleMessages)
  );
  const anyRecentMessageContainsTrackedText = messages.some((message) =>
    containsAnyTrackedText(message.text, options.trackedTexts)
  );
  const matchedTrackedTexts = options.trackedTexts.filter((trackedText) =>
    messages.some((message) => message.text?.includes(trackedText))
  );

  return {
    observeSeconds: options.observeSeconds,
    checkedRecentMessages: messages.length,
    experimentVisibleMessageObserved,
    visibleUserMessageContainsCanary,
    aiResponseAppearsToReferenceCanary,
    anyRecentMessageContainsCanary,
    visibleUserMessageContainsTrackedText,
    aiResponseAppearsToReferenceTrackedText,
    anyRecentMessageContainsTrackedText,
    matchedTrackedTexts,
    recentMessages: summarizeMessages(messages, {
      canary: options.canary,
      trackedTexts: options.trackedTexts,
      internetResponse: options.internetResponse,
      visibleMessages: options.visibleMessages,
      verboseChat: options.verboseChat
    })
  };
}

function conclude(sendOk: boolean | undefined, observation: ObservationReport | undefined): InternetResponseConclusion {
  if (!sendOk) {
    return "rejected";
  }
  if (!observation) {
    return "unknown";
  }
  if (observation.visibleUserMessageContainsCanary) {
    return "unknown";
  }
  if (observation.visibleUserMessageContainsTrackedText) {
    return "unknown";
  }
  if (observation.aiResponseAppearsToReferenceTrackedText) {
    return "accepted-and-used";
  }
  if (observation.experimentVisibleMessageObserved) {
    return "accepted-but-not-used";
  }
  return "unknown";
}

function summarizeMessages(
  messages: NormalizedKindroidMessage[],
  options: {
    canary: string;
    trackedTexts: string[];
    internetResponse: string;
    visibleMessages: string[];
    verboseChat: boolean;
  }
): MessageSnippet[] {
  const selected = options.verboseChat ? messages : selectRelevantMessages(messages, options);
  return selected.map((message) => ({
    id: message.id,
    timestamp: message.timestamp,
    sender: message.sender,
    role: message.role,
    text: sanitizeText(message.text, options)
  }));
}

function selectRelevantMessages(
  messages: NormalizedKindroidMessage[],
  options: { canary: string; trackedTexts: string[]; visibleMessages: string[] }
): NormalizedKindroidMessage[] {
  const indexes = new Set<number>();

  messages.forEach((message, index) => {
    const text = message.text ?? "";
    const isRelevant =
      containsAnyTrackedText(text, options.trackedTexts) ||
      options.visibleMessages.some((visibleMessage) => text.includes(visibleMessage));
    if (!isRelevant) {
      return;
    }

    indexes.add(index);
    if (index > 0) {
      indexes.add(index - 1);
    }
    if (index + 1 < messages.length) {
      indexes.add(index + 1);
    }
  });

  if (indexes.size === 0) {
    messages.slice(0, 6).forEach((_message, index) => indexes.add(index));
  }

  return [...indexes]
    .sort((left, right) => left - right)
    .slice(0, 8)
    .map((index) => messages[index])
    .filter((message): message is NormalizedKindroidMessage => Boolean(message));
}

function sanitizeText(
  value: string | null,
  options: { canary: string; internetResponse: string; verboseChat: boolean }
): string | null {
  if (!value) {
    return value;
  }

  const internetResponseRedaction = `[INTERNET_RESPONSE_REDACTED length=${options.internetResponse.length} canary=${options.canary}]`;
  const redacted = redactSecrets(value.replaceAll(options.internetResponse, internetResponseRedaction));
  if (options.verboseChat || redacted.length <= snippetLength) {
    return redacted;
  }

  return `${redacted.slice(0, snippetLength)}...`;
}

function containsAnyTrackedText(value: string | null | undefined, trackedTexts: string[]): boolean {
  return Boolean(value && trackedTexts.some((trackedText) => value.includes(trackedText)));
}

function normalizeExpectedTexts(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
}

function isLikelyUserMessage(message: NormalizedKindroidMessage, visibleMessages: string[]): boolean {
  const role = `${message.role ?? ""} ${message.sender ?? ""}`.toLowerCase();
  if (/\b(user|human)\b/.test(role)) {
    return true;
  }
  if (/\b(ai|assistant|kindroid|kin)\b/.test(role)) {
    return false;
  }

  const text = message.text ?? "";
  return visibleMessages.some((visibleMessage) => text.includes(visibleMessage));
}

function previewPayload(input: {
  target: InternetResponseExperimentTarget;
  message: string;
  requestId: string;
  idempotencyKey: string;
  internetResponse?: string;
}): Record<string, unknown> {
  const payload =
    input.target.type === "group"
      ? buildSendGroupMessagePayload({
          groupId: input.target.id,
          message: input.message,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          internetResponse: input.internetResponse
        })
      : buildSendMessagePayload({
          aiId: input.target.id,
          message: input.message,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          internetResponse: input.internetResponse
        });
  return {
    ...payload,
    internet_response:
      typeof payload.internet_response === "string"
        ? `[REDACTED length=${payload.internet_response.length}]`
        : payload.internet_response
  };
}

function manualFollowUp(target: InternetResponseExperimentTarget, canary: string, expectedTexts: string[]): string[] {
  const expectedTextNote = expectedTexts.length > 0 ? ` or any expected value: ${expectedTexts.join(", ")}` : "";
  const targetLabel = target.type === "group" ? `group ${target.id}` : `Kin ${target.id}`;
  const responderLabel = target.type === "group" ? "group AI response" : "Kin";
  return [
    `Open the Kindroid UI for ${targetLabel} and inspect the paired diagnostic messages.`,
    `If the ${responderLabel} replies with ${canary}${expectedTextNote}, bucket the result as accepted-and-used.`,
    "If the canary appears inside the visible user transcript, the field is not hidden in practice.",
    `If the ${responderLabel} does not reference any tracked text and the API accepted the send, bucket the result as accepted-but-not-used.`
  ];
}

function resolveTarget(options: RunInternetResponseExperimentOptions): InternetResponseExperimentTarget {
  const kinId = options.kinId?.trim();
  const groupId = options.groupId?.trim();
  if (kinId && groupId) {
    throw new Error("Use either --kin or --group, not both.");
  }
  if (groupId) {
    return { type: "group", id: groupId };
  }
  if (kinId) {
    return { type: "kin", id: kinId };
  }
  throw new Error("--kin or --group is required.");
}

function requireNonEmpty(value: string | undefined, optionName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${optionName} is required.`);
  }
  return trimmed;
}

function resolveVisibleMessage(options: RunInternetResponseExperimentOptions): string {
  if (options.allowEmptyMessage) {
    return typeof options.message === "string" ? options.message : "";
  }

  return requireNonEmpty(options.message, "--message");
}

function validateNonNegativeInteger(value: number, optionName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
