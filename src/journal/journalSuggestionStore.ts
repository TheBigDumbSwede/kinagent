import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";

export const journalSuggestionThrottleMessages = 20;
export const journalSuggestionMaxKeyphrases = 8;

export interface JournalSuggestionStoreOptions {
  throttleMessages: number;
  strongEventBypass: boolean;
}

export type JournalSuggestionStatus = "pending" | "accepted" | "dismissed";

export interface JournalSuggestionInput {
  title: string;
  entry: string;
  keyphrases: string[];
  evidence: string[];
  durabilityReason: string;
  confidence: "high";
  strongEvent: boolean;
}

export interface JournalSuggestion {
  id: string;
  aiId: string;
  title: string;
  status: JournalSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  source: "direct" | "group";
  groupId?: string;
  documentId: string;
  timestamp: string | null;
  entry: string;
  keyphrases: string[];
  evidence: string[];
  durabilityReason: string;
  confidence: "high";
  strongEvent: boolean;
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
    if (!title || !entry || !durabilityReason) {
      return null;
    }

    const file = this.read();
    const suggestions = file.suggestions ?? [];
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
      title,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      source: notification.type === "kindroid.group_chat.changed" ? "group" : "direct",
      groupId: notification.type === "kindroid.group_chat.changed" ? notification.groupId : undefined,
      documentId: notification.documentId,
      timestamp: notification.timestamp,
      entry,
      keyphrases: normalizeStringArray(input.keyphrases, journalSuggestionMaxKeyphrases),
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
