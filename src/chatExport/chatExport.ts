import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { NormalizedKindroidMessage } from "../firestore/types.js";
import { chatHistoryDisplayName, loadAllKindroidChatHistoryMessages } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";

export interface KinChatExportOptions {
  kinId: string;
  kinName?: string;
  fromDate?: string;
  toDate?: string;
  tempDir: string;
}

export interface GroupChatExportOptions {
  groupId: string;
  groupName?: string;
  speakerNames?: Record<string, string>;
  fromDate?: string;
  toDate?: string;
  tempDir: string;
}

export interface KinChatExportProgress {
  phase: "loading" | "writing" | "complete";
  processed: number;
  total?: number;
  message: string;
}

export interface KinChatExportResult {
  tempPath: string;
  fileName: string;
  exportedCount: number;
  totalCount: number;
}

export async function exportKinChatTranscript(
  config: AppConfig,
  logger: Logger,
  options: KinChatExportOptions,
  onProgress: (progress: KinChatExportProgress) => void
): Promise<KinChatExportResult> {
  if (!options.kinId) {
    throw new Error("Select a Kin before exporting chat.");
  }

  return exportChatTranscript(
    config,
    logger,
    {
      scope: "kin",
      id: options.kinId,
      displayName: options.kinName || options.kinId,
      fromDate: options.fromDate,
      toDate: options.toDate,
      tempDir: options.tempDir,
      speakerNames: {}
    },
    onProgress
  );
}

export async function exportGroupChatTranscript(
  config: AppConfig,
  logger: Logger,
  options: GroupChatExportOptions,
  onProgress: (progress: KinChatExportProgress) => void
): Promise<KinChatExportResult> {
  if (!options.groupId) {
    throw new Error("Select a Group before exporting chat.");
  }

  return exportChatTranscript(
    config,
    logger,
    {
      scope: "group",
      id: options.groupId,
      displayName: options.groupName || options.groupId,
      fromDate: options.fromDate,
      toDate: options.toDate,
      tempDir: options.tempDir,
      speakerNames: options.speakerNames ?? {}
    },
    onProgress
  );
}

async function exportChatTranscript(
  config: AppConfig,
  logger: Logger,
  options: {
    scope: "kin" | "group";
    id: string;
    displayName: string;
    fromDate?: string;
    toDate?: string;
    tempDir: string;
    speakerNames: Record<string, string>;
  },
  onProgress: (progress: KinChatExportProgress) => void
): Promise<KinChatExportResult> {
  onProgress({ phase: "loading", processed: 0, message: "Loading chat entries." });
  const messages = await loadAllKindroidChatHistoryMessages(config, logger, { scope: options.scope, id: options.id });
  const range = normalizeDateRange(options.fromDate, options.toDate);
  const candidates = messages.filter((message) => isMessageInRange(message, range)).sort(compareMessagesAscending);

  onProgress({
    phase: "loading",
    processed: candidates.length,
    total: candidates.length,
    message: candidates.length === 1 ? "Loaded 1 chat entry." : `Loaded ${candidates.length} chat entries.`
  });

  onProgress({
    phase: "writing",
    processed: 0,
    total: candidates.length,
    message: "Preparing transcript."
  });

  onProgress({
    phase: "writing",
    processed: candidates.length,
    total: candidates.length,
    message: "Writing transcript."
  });

  fs.mkdirSync(options.tempDir, { recursive: true });
  const fileName = defaultChatExportFileName(options.displayName, range);
  const tempPath = path.join(options.tempDir, `${Date.now()}-${fileName}`);
  fs.writeFileSync(
    tempPath,
    renderChatTranscript(candidates, {
      kinName: options.displayName || "Kin",
      speakerNames: options.speakerNames
    })
  );

  onProgress({
    phase: "complete",
    processed: candidates.length,
    total: candidates.length,
    message: "Transcript ready."
  });

  return {
    tempPath,
    fileName,
    exportedCount: candidates.length,
    totalCount: candidates.length
  };
}

export function renderChatTranscript(
  messages: NormalizedKindroidMessage[],
  options: { kinName: string; speakerNames?: Record<string, string> }
): string {
  const lines: string[] = [];
  let currentDate = "";

  for (const message of messages) {
    const date = dateHeading(message.timestamp);
    if (date !== currentDate) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(`## ${date}`);
      currentDate = date;
    }

    lines.push(
      `[${timeLabel(message.timestamp)}] ${speakerLabel(message, options.kinName, options.speakerNames ?? {})}: ${message.text || ""}`
    );
  }

  if (lines.length === 0) {
    lines.push("No chat entries found for the selected range.");
  }

  return `${lines.join("\n")}\n`;
}

export function normalizeDateRange(
  fromDate?: string,
  toDate?: string
): { from?: Date; toExclusive?: Date; label: string } {
  const from = parseDateStart(fromDate);
  const toExclusive = parseDateEndExclusive(toDate);
  if (from && toExclusive && from.getTime() >= toExclusive.getTime()) {
    throw new Error("Export start date must be before the end date.");
  }

  return {
    from,
    toExclusive,
    label: dateRangeLabel(fromDate, toDate)
  };
}

export function isMessageInRange(
  message: Pick<NormalizedKindroidMessage, "timestamp">,
  range: { from?: Date; toExclusive?: Date }
): boolean {
  if (!message.timestamp) {
    return !range.from && !range.toExclusive;
  }

  const timestamp = Date.parse(message.timestamp);
  if (!Number.isFinite(timestamp)) {
    return !range.from && !range.toExclusive;
  }

  if (range.from && timestamp < range.from.getTime()) {
    return false;
  }

  if (range.toExclusive && timestamp >= range.toExclusive.getTime()) {
    return false;
  }

  return true;
}

export function defaultChatExportFileName(kinName: string, range: { label: string }): string {
  return `${safeFilePart(kinName)}-chat-${safeFilePart(range.label)}.md`;
}

function compareMessagesAscending(left: NormalizedKindroidMessage, right: NormalizedKindroidMessage): number {
  return timestampSortValue(left) - timestampSortValue(right) || left.id.localeCompare(right.id);
}

function timestampSortValue(message: NormalizedKindroidMessage): number {
  if (!message.timestamp) {
    return 0;
  }
  const timestamp = Date.parse(message.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dateHeading(timestamp: string | null): string {
  return timestamp ? timestamp.slice(0, 10) : "Undated";
}

function timeLabel(timestamp: string | null): string {
  return timestamp ? timestamp.slice(11, 16) || "Unknown" : "Unknown";
}

function speakerLabel(
  message: Pick<NormalizedKindroidMessage, "kinId" | "sender" | "role" | "raw">,
  kinName: string,
  speakerNames: Record<string, string>
): string {
  const sender = (message.sender || message.role || "").toLowerCase();
  if (sender === "user" || sender === "human") {
    return "User";
  }
  const displayName = chatHistoryDisplayName(message.raw);
  if (displayName) {
    return displayName;
  }
  if (speakerNames[message.kinId]) {
    return speakerNames[message.kinId];
  }
  if (sender === "ai" || sender === "assistant" || sender === "kin") {
    return kinName;
  }
  return message.sender || message.role || "Unknown";
}

function parseDateStart(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Export start date is invalid.");
  }
  return parsed;
}

function parseDateEndExclusive(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Export end date is invalid.");
  }
  return new Date(parsed.getTime() + 24 * 60 * 60 * 1000);
}

function dateRangeLabel(fromDate?: string, toDate?: string): string {
  if (fromDate && toDate) {
    return `${fromDate}-to-${toDate}`;
  }
  if (fromDate) {
    return `from-${fromDate}`;
  }
  if (toDate) {
    return `through-${toDate}`;
  }
  return "all";
}

function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}
