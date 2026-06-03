import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import { parseChatDynamismValue } from "../kindroid/chatDynamism.js";

export type ChatDynamismSuggestionStatus = "pending" | "accepted" | "rejected" | "expired";
export type ChatDynamismSuggestionDirection = "increase" | "decrease" | "set";

export interface ChatDynamismSuggestionInput {
  currentValue?: unknown;
  suggestedTarget: number;
  suggestedDelta?: number;
  direction: ChatDynamismSuggestionDirection;
  reason: string;
  confidence: "high";
  safetyNotes?: string[];
}

export interface ChatDynamismSuggestion {
  id: string;
  aiId: string;
  currentValue?: unknown;
  currentNumeric: number | null;
  suggestedTarget: number;
  suggestedDelta?: number;
  direction: ChatDynamismSuggestionDirection;
  reason: string;
  sourceDocumentId: string;
  createdAt: string;
  updatedAt: string;
  status: ChatDynamismSuggestionStatus;
  safetyNotes: string[];
}

interface ChatDynamismSuggestionFile {
  suggestions?: ChatDynamismSuggestion[];
}

export class ChatDynamismSuggestionStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): ChatDynamismSuggestionStore {
    return new ChatDynamismSuggestionStore(chatDynamismSuggestionsPath(config));
  }

  list(status?: ChatDynamismSuggestionStatus): ChatDynamismSuggestion[] {
    const suggestions = this.read().suggestions ?? [];
    const filtered = status ? suggestions.filter((suggestion) => suggestion.status === status) : suggestions;
    return [...filtered].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  createPending(
    notification: KindroidChatNotification,
    input: ChatDynamismSuggestionInput
  ): ChatDynamismSuggestion | null {
    if (notification.type !== "kindroid.chat.changed") {
      return null;
    }

    const reason = input.reason.trim();
    if (!reason) {
      return null;
    }

    const file = this.read();
    const suggestions = file.suggestions ?? [];
    if (suggestions.some((suggestion) => suggestion.aiId === notification.kinId && suggestion.status === "pending")) {
      return null;
    }

    const now = new Date().toISOString();
    const parsedCurrent = parseChatDynamismValue(input.currentValue);
    const suggestion: ChatDynamismSuggestion = {
      id: `${now}-${notification.kinId}-${notification.documentId}-chat-dynamism`.replace(/[^\w.-]+/g, "-"),
      aiId: notification.kinId,
      currentValue: input.currentValue,
      currentNumeric: parsedCurrent.numeric,
      suggestedTarget: input.suggestedTarget,
      suggestedDelta: input.suggestedDelta,
      direction: input.direction,
      reason,
      sourceDocumentId: notification.documentId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      safetyNotes: normalizeSafetyNotes(input.safetyNotes)
    };

    this.write({ ...file, suggestions: [suggestion, ...suggestions] });
    return suggestion;
  }

  private read(): ChatDynamismSuggestionFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ChatDynamismSuggestionFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: ChatDynamismSuggestionFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function chatDynamismSuggestionsPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "chat-dynamism-suggestions.json");
}

function normalizeSafetyNotes(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}
