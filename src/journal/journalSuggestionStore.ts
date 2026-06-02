import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import type { ExistingJournalEntry } from "./journalContext.js";

export const journalSuggestionThrottleMessages = 20;
export const journalSuggestionMaxKeyphrases = 8;
export const journalSuggestionCategories = [
  "relationship_milestone",
  "world_capsule",
  "behavior_callback",
  "personal_fact",
  "resolved_conflict",
  "backstory_hook",
  "important_decision",
  "recurring_pattern",
  "other_durable_event"
] as const;

export interface JournalSuggestionStoreOptions {
  throttleMessages: number;
  strongEventBypass: boolean;
}

export type JournalSuggestionStatus = "pending" | "accepted" | "dismissed";
export type JournalSuggestionCategory = (typeof journalSuggestionCategories)[number];
export type JournalSuggestionAction = "create" | "delete";

export interface JournalSuggestionInput {
  title: string;
  entry: string;
  category?: string;
  categoryDetail?: string;
  keyphrases: string[];
  evidence: string[];
  durabilityReason: string;
  confidence: "high";
  strongEvent: boolean;
  existingEntries?: ExistingJournalEntry[];
}

export interface JournalDeletionSuggestionInput {
  title: string;
  targetJournalEntryId: string;
  targetJournalTitle?: string;
  targetJournalEntry?: string;
  evidence: string[];
  durabilityReason: string;
  confidence: "high";
  strongEvent: boolean;
}

export interface JournalSuggestion {
  id: string;
  aiId: string;
  action: JournalSuggestionAction;
  title: string;
  status: JournalSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  source: "direct" | "group";
  groupId?: string;
  documentId: string;
  timestamp: string | null;
  entry: string;
  category?: JournalSuggestionCategory;
  categoryDetail?: string;
  keyphrases: string[];
  evidence: string[];
  durabilityReason: string;
  confidence: "high";
  strongEvent: boolean;
  targetJournalEntryId?: string;
  targetJournalTitle?: string;
  targetJournalEntry?: string;
  acceptedAt?: string;
  dismissedAt?: string;
  result?: {
    ok: boolean;
    status?: number;
    responseText?: string;
    captureCommitHash?: string;
    captureCreatedCommit?: boolean;
  };
}

interface JournalSuggestionPacing {
  messagesSinceLastProposal: number;
  lastProposalAt?: string;
  lastProposalDocumentId?: string;
}

interface JournalSuggestionFile {
  suggestions?: JournalSuggestion[];
  pacing?: Record<string, JournalSuggestionPacing>;
}

export class JournalSuggestionStore {
  constructor(
    private readonly filePath: string,
    private readonly options: JournalSuggestionStoreOptions = {
      throttleMessages: journalSuggestionThrottleMessages,
      strongEventBypass: true
    }
  ) {}

  static fromConfig(config: AppConfig): JournalSuggestionStore {
    return new JournalSuggestionStore(journalSuggestionsPath(config), {
      throttleMessages: config.hermes.journalSuggestions.throttleMessages,
      strongEventBypass: config.hermes.journalSuggestions.strongEventBypass
    });
  }

  list(status?: JournalSuggestionStatus): JournalSuggestion[] {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const filtered = status ? suggestions.filter((suggestion) => suggestion.status === status) : suggestions;
    return [...filtered].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(id: string): JournalSuggestion | null {
    return this.read().suggestions?.find((suggestion) => suggestion.id === id) ?? null;
  }

  recordReadableMessage(notification: KindroidChatNotification): void {
    if (notification.sender !== "ai") {
      return;
    }

    const aiId = aiIdFromNotification(notification);
    if (!aiId) {
      return;
    }

    const file = this.read();
    const pacing = file.pacing ?? {};
    const current = pacing[aiId] ?? { messagesSinceLastProposal: this.options.throttleMessages };
    pacing[aiId] = {
      ...current,
      messagesSinceLastProposal: Math.max(0, current.messagesSinceLastProposal) + 1
    };
    this.write({ ...file, pacing });
  }

  createPending(notification: KindroidChatNotification, input: JournalSuggestionInput): JournalSuggestion | null {
    const aiId = aiIdFromNotification(notification);
    if (!aiId) {
      return null;
    }

    const title = input.title.trim();
    const entry = input.entry.trim();
    const durabilityReason = input.durabilityReason.trim();
    const category = normalizeCategoryInput(input.category, input.categoryDetail);
    const keyphrases = normalizeKeyphrases(input.keyphrases);
    if (!title || !entry || !durabilityReason || keyphrases.length === 0) {
      return null;
    }

    const file = this.read();
    const suggestions = file.suggestions ?? [];
    if (isDuplicateSuggestion(aiId, title, entry, keyphrases, suggestions, input.existingEntries ?? [])) {
      return null;
    }

    const pacing = file.pacing ?? {};
    const currentPacing = pacing[aiId] ?? { messagesSinceLastProposal: this.options.throttleMessages };
    const hasPendingForKin = suggestions.some(
      (suggestion) => suggestion.aiId === aiId && suggestion.status === "pending"
    );
    const eligible =
      (input.strongEvent && this.options.strongEventBypass) ||
      (!hasPendingForKin && currentPacing.messagesSinceLastProposal >= this.options.throttleMessages);

    if (!eligible) {
      return null;
    }

    const now = new Date().toISOString();
    const suggestion: JournalSuggestion = {
      id: `${now}-${aiId}-${notification.documentId}`.replace(/[^\w.-]+/g, "-"),
      aiId,
      action: "create",
      title,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      source: notification.type === "kindroid.group_chat.changed" ? "group" : "direct",
      groupId: notification.type === "kindroid.group_chat.changed" ? notification.groupId : undefined,
      documentId: notification.documentId,
      timestamp: notification.timestamp,
      entry,
      category: category.category,
      categoryDetail: category.categoryDetail,
      keyphrases,
      evidence: normalizeStringArray(input.evidence, 6),
      durabilityReason,
      confidence: "high",
      strongEvent: input.strongEvent
    };

    pacing[aiId] = {
      messagesSinceLastProposal: 0,
      lastProposalAt: now,
      lastProposalDocumentId: notification.documentId
    };
    this.write({ ...file, suggestions: [suggestion, ...suggestions], pacing });
    return suggestion;
  }

  createPendingDelete(
    notification: KindroidChatNotification,
    input: JournalDeletionSuggestionInput
  ): JournalSuggestion | null {
    const aiId = aiIdFromNotification(notification);
    if (!aiId) {
      return null;
    }

    const title = input.title.trim();
    const targetJournalEntryId = input.targetJournalEntryId.trim();
    const durabilityReason = input.durabilityReason.trim();
    if (!title || !targetJournalEntryId || !durabilityReason) {
      return null;
    }

    const file = this.read();
    const suggestions = file.suggestions ?? [];
    if (
      suggestions.some(
        (suggestion) =>
          suggestion.aiId === aiId &&
          suggestion.status === "pending" &&
          suggestion.action === "delete" &&
          suggestion.targetJournalEntryId === targetJournalEntryId
      )
    ) {
      return null;
    }

    const pacing = file.pacing ?? {};
    const currentPacing = pacing[aiId] ?? { messagesSinceLastProposal: this.options.throttleMessages };
    const hasPendingForKin = suggestions.some(
      (suggestion) => suggestion.aiId === aiId && suggestion.status === "pending"
    );
    const eligible =
      (input.strongEvent && this.options.strongEventBypass) ||
      (!hasPendingForKin && currentPacing.messagesSinceLastProposal >= this.options.throttleMessages);

    if (!eligible) {
      return null;
    }

    const now = new Date().toISOString();
    const suggestion: JournalSuggestion = {
      id: `${now}-${aiId}-${notification.documentId}-delete-${targetJournalEntryId}`.replace(/[^\w.-]+/g, "-"),
      aiId,
      action: "delete",
      title,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      source: notification.type === "kindroid.group_chat.changed" ? "group" : "direct",
      groupId: notification.type === "kindroid.group_chat.changed" ? notification.groupId : undefined,
      documentId: notification.documentId,
      timestamp: notification.timestamp,
      entry: "",
      keyphrases: [],
      evidence: normalizeStringArray(input.evidence, 6),
      durabilityReason,
      confidence: "high",
      strongEvent: input.strongEvent,
      targetJournalEntryId,
      targetJournalTitle: normalizeOptionalString(input.targetJournalTitle),
      targetJournalEntry: normalizeOptionalString(input.targetJournalEntry)
    };

    pacing[aiId] = {
      messagesSinceLastProposal: 0,
      lastProposalAt: now,
      lastProposalDocumentId: notification.documentId
    };
    this.write({ ...file, suggestions: [suggestion, ...suggestions], pacing });
    return suggestion;
  }

  markAccepted(id: string, result: NonNullable<JournalSuggestion["result"]>): JournalSuggestion {
    return this.updateSuggestion(id, (suggestion, now) => ({
      ...suggestion,
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
      result
    }));
  }

  markDismissed(id: string): JournalSuggestion {
    return this.updateSuggestion(id, (suggestion, now) => ({
      ...suggestion,
      status: "dismissed",
      dismissedAt: now,
      updatedAt: now
    }));
  }

  private updateSuggestion(
    id: string,
    update: (suggestion: JournalSuggestion, now: string) => JournalSuggestion
  ): JournalSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const index = suggestions.findIndex((suggestion) => suggestion.id === id);
    if (index < 0) {
      throw new Error("Journal suggestion not found.");
    }

    const next = update(suggestions[index], new Date().toISOString());
    const nextSuggestions = [...suggestions];
    nextSuggestions[index] = next;
    this.write({ ...file, suggestions: nextSuggestions });
    return next;
  }

  private read(): JournalSuggestionFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as JournalSuggestionFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: JournalSuggestionFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}

export function journalSuggestionsPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "journal-suggestions.json");
}

function aiIdFromNotification(notification: KindroidChatNotification): string | null {
  if (notification.type === "kindroid.chat.changed") {
    return notification.kinId || null;
  }

  return notification.aiId || null;
}

function normalizeStringArray(values: string[], maxCount: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maxCount);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeCategoryInput(
  categoryValue: string | undefined,
  detailValue: string | undefined
): { category: JournalSuggestionCategory; categoryDetail?: string } {
  const category = normalizeCategoryText(categoryValue);
  const detail = normalizeCategoryDetail(detailValue);
  if (journalSuggestionCategories.includes(category as JournalSuggestionCategory)) {
    return {
      category: category as JournalSuggestionCategory,
      categoryDetail: detail
    };
  }

  return {
    category: "other_durable_event",
    categoryDetail: detail || category || undefined
  };
}

function normalizeCategoryText(value: string | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^\w]+/g, "") ?? ""
  );
}

function normalizeCategoryDetail(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 80) : undefined;
}

const genericKeyphrases = new Set([
  "memory",
  "important",
  "relationship",
  "feelings",
  "emotion",
  "emotions",
  "event",
  "moment",
  "milestone",
  "fact",
  "personal fact",
  "journal",
  "update"
]);

function normalizeKeyphrases(values: string[]): string[] {
  return normalizeStringArray(values, journalSuggestionMaxKeyphrases).filter((value) => {
    const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
    return normalized.length >= 3 && !genericKeyphrases.has(normalized);
  });
}

function isDuplicateSuggestion(
  aiId: string,
  title: string,
  entry: string,
  keyphrases: string[],
  suggestions: JournalSuggestion[],
  existingEntries: ExistingJournalEntry[]
): boolean {
  const comparableSuggestions = suggestions
    .filter((suggestion) => suggestion.aiId === aiId && suggestion.status !== "dismissed")
    .map((suggestion) => ({
      title: suggestion.title,
      entry: suggestion.entry,
      keyphrases: suggestion.keyphrases
    }));

  return [...comparableSuggestions, ...existingEntries].some((existing) => {
    return (
      normalizedText(existing.title) === normalizedText(title) ||
      textSimilarity(existing.entry, entry) >= 0.74 ||
      (keyphraseOverlap(existing.keyphrases, keyphrases) >= 0.75 && textSimilarity(existing.entry, entry) >= 0.35)
    );
  });
}

function normalizedText(value: string): string {
  return tokenize(value).join(" ");
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function keyphraseOverlap(left: string[], right: string[]): number {
  const leftPhrases = new Set(left.map(normalizedText).filter(Boolean));
  const rightPhrases = new Set(right.map(normalizedText).filter(Boolean));
  if (leftPhrases.size === 0 || rightPhrases.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const phrase of leftPhrases) {
    if (rightPhrases.has(phrase)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftPhrases.size, rightPhrases.size);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !genericKeyphrases.has(token));
}
