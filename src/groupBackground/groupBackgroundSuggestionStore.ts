import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { KindroidChatNotification } from "../firestore/types.js";

export type GroupBackgroundSuggestionStatus = "pending" | "dismissed" | "stale";

export interface GroupBackgroundGeneratedImage {
  path: string;
  mimeType: string;
  model: string;
  size: string;
  generatedAt: string;
}

export interface GroupBackgroundSuggestionInput {
  title: string;
  prompt: string;
  negativePrompt?: string;
  targetCurrentScene?: string;
  sceneSummary?: string;
  visualStyle?: string;
  reason: string;
  evidence?: string[];
  significance: number;
}

export interface GroupBackgroundSuggestion {
  id: string;
  groupId: string;
  aiId?: string | null;
  title: string;
  prompt: string;
  negativePrompt?: string;
  targetCurrentScene?: string;
  sceneSummary?: string;
  visualStyle?: string;
  reason: string;
  evidence: string[];
  significance: number;
  sourceDocumentId: string;
  sourceTimestamp: string | null;
  createdAt: string;
  updatedAt: string;
  status: GroupBackgroundSuggestionStatus;
  dismissedAt?: string;
  staleAt?: string;
  staleReason?: string;
  generatedImage?: GroupBackgroundGeneratedImage;
  generationError?: string;
  generationErrorAt?: string;
  appliedBackgroundPath?: string;
  appliedAt?: string;
  applyError?: string;
  applyErrorAt?: string;
}

export interface GroupBackgroundSuggestionStoreOptions {
  minMessagesBetweenProposals: number;
  minSignificance: number;
}

interface GroupBackgroundSuggestionPacing {
  messagesSinceLastProposal: number;
  lastProposalAt?: string;
  lastProposalDocumentId?: string;
}

interface GroupBackgroundSuggestionFile {
  suggestions?: GroupBackgroundSuggestion[];
  pacing?: Record<string, GroupBackgroundSuggestionPacing>;
}

export interface GroupBackgroundPruneOptions {
  maxAgeDays?: number;
  maxCompleted?: number;
  now?: Date;
}

export interface GroupBackgroundPruneResult {
  removed: number;
  retained: number;
}

export class GroupBackgroundSuggestionStore {
  constructor(
    private readonly filePath: string,
    private readonly options: GroupBackgroundSuggestionStoreOptions
  ) {}

  static fromConfig(config: AppConfig): GroupBackgroundSuggestionStore {
    return new GroupBackgroundSuggestionStore(groupBackgroundSuggestionsPath(config), {
      minMessagesBetweenProposals: config.hermes.groupBackgrounds.suggestions.minMessagesBetweenProposals,
      minSignificance: config.hermes.groupBackgrounds.suggestions.minSignificance
    });
  }

  list(status?: GroupBackgroundSuggestionStatus): GroupBackgroundSuggestion[] {
    const suggestions = this.read().suggestions ?? [];
    const filtered = status ? suggestions.filter((suggestion) => suggestion.status === status) : suggestions;
    return [...filtered].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  listReviewable(): GroupBackgroundSuggestion[] {
    return this.list("pending");
  }

  pruneCompleted(options: GroupBackgroundPruneOptions = {}): GroupBackgroundPruneResult {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const nextSuggestions = pruneSuggestions(suggestions, options);
    if (nextSuggestions.length !== suggestions.length) {
      this.write({ ...file, suggestions: nextSuggestions });
    }
    return {
      removed: suggestions.length - nextSuggestions.length,
      retained: nextSuggestions.length
    };
  }

  get(id: string): GroupBackgroundSuggestion | null {
    return this.read().suggestions?.find((suggestion) => suggestion.id === id) ?? null;
  }

  recordReadableMessage(notification: KindroidChatNotification): void {
    if (notification.type !== "kindroid.group_chat.changed" || !notification.text) {
      return;
    }

    const file = this.read();
    const pacing = file.pacing ?? {};
    const current = pacing[notification.groupId] ?? {
      messagesSinceLastProposal: this.options.minMessagesBetweenProposals
    };
    pacing[notification.groupId] = {
      ...current,
      messagesSinceLastProposal: Math.max(0, current.messagesSinceLastProposal) + 1
    };
    this.write({ ...file, pacing });
  }

  createPending(
    notification: KindroidChatNotification,
    input: GroupBackgroundSuggestionInput,
    options: { bypassPacing?: boolean; replacePendingForGroup?: boolean } = {}
  ): GroupBackgroundSuggestion | null {
    if (notification.type !== "kindroid.group_chat.changed") {
      return null;
    }

    const title = normalizeText(input.title, 100);
    const prompt = normalizeText(input.prompt, 1200);
    const reason = normalizeText(input.reason, 240);
    const significance = normalizeSignificance(input.significance);
    if (!title || !prompt || !reason || significance < this.options.minSignificance) {
      return null;
    }

    const file = this.read();
    const suggestions = options.replacePendingForGroup
      ? markPendingForGroupStale(file.suggestions ?? [], notification.groupId)
      : (file.suggestions ?? []);
    const hasPendingForGroup = suggestions.some(
      (suggestion) => suggestion.groupId === notification.groupId && suggestion.status === "pending"
    );
    const pacing = file.pacing ?? {};
    const currentPacing = pacing[notification.groupId] ?? {
      messagesSinceLastProposal: this.options.minMessagesBetweenProposals
    };
    if (
      hasPendingForGroup ||
      (!options.bypassPacing && currentPacing.messagesSinceLastProposal < this.options.minMessagesBetweenProposals)
    ) {
      return null;
    }

    const now = new Date().toISOString();
    const suggestion: GroupBackgroundSuggestion = {
      id: `${now}-${notification.groupId}-${notification.documentId}-background`.replace(/[^\w.-]+/g, "-"),
      groupId: notification.groupId,
      aiId: notification.aiId,
      title,
      prompt,
      negativePrompt: normalizeText(input.negativePrompt, 500),
      targetCurrentScene: normalizeText(input.targetCurrentScene, 160),
      sceneSummary: normalizeText(input.sceneSummary, 320),
      visualStyle: normalizeText(input.visualStyle, 160),
      reason,
      evidence: normalizeStringArray(input.evidence, 6, 180),
      significance,
      sourceDocumentId: notification.documentId,
      sourceTimestamp: notification.timestamp,
      createdAt: now,
      updatedAt: now,
      status: "pending"
    };

    pacing[notification.groupId] = {
      messagesSinceLastProposal: 0,
      lastProposalAt: now,
      lastProposalDocumentId: notification.documentId
    };
    this.write({ ...file, suggestions: [suggestion, ...suggestions], pacing });
    return suggestion;
  }

  markDismissed(id: string): GroupBackgroundSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    let found: GroupBackgroundSuggestion | null = null;
    const nextSuggestions = suggestions.map((suggestion) => {
      if (suggestion.id !== id) {
        return suggestion;
      }

      found = {
        ...suggestion,
        status: "dismissed" as const,
        updatedAt: now,
        dismissedAt: now
      };
      return found;
    });

    if (!found) {
      throw new Error("Group background suggestion not found.");
    }

    this.write({ ...file, suggestions: nextSuggestions });
    return found;
  }

  markImageGenerated(id: string, image: Omit<GroupBackgroundGeneratedImage, "generatedAt">): GroupBackgroundSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    let found: GroupBackgroundSuggestion | null = null;
    const nextSuggestions = suggestions.map((suggestion) => {
      if (suggestion.id !== id) {
        return suggestion;
      }

      found = {
        ...suggestion,
        generatedImage: {
          ...image,
          generatedAt: now
        },
        generationError: undefined,
        generationErrorAt: undefined,
        updatedAt: now
      };
      return found;
    });

    if (!found) {
      throw new Error("Group background suggestion not found.");
    }

    this.write({ ...file, suggestions: nextSuggestions });
    return found;
  }

  markImageGenerationFailed(id: string, error: string): GroupBackgroundSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    let found: GroupBackgroundSuggestion | null = null;
    const nextSuggestions = suggestions.map((suggestion) => {
      if (suggestion.id !== id) {
        return suggestion;
      }

      found = {
        ...suggestion,
        generationError: normalizeText(error, 500),
        generationErrorAt: now,
        updatedAt: now
      };
      return found;
    });

    if (!found) {
      throw new Error("Group background suggestion not found.");
    }

    this.write({ ...file, suggestions: nextSuggestions });
    return found;
  }

  markApplied(id: string, storagePath: string): GroupBackgroundSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    let found: GroupBackgroundSuggestion | null = null;
    const nextSuggestions = suggestions.map((suggestion) => {
      if (suggestion.id !== id) {
        return suggestion;
      }

      found = {
        ...suggestion,
        appliedBackgroundPath: storagePath,
        appliedAt: now,
        applyError: undefined,
        applyErrorAt: undefined,
        updatedAt: now
      };
      return found;
    });

    if (!found) {
      throw new Error("Group background suggestion not found.");
    }

    this.write({ ...file, suggestions: nextSuggestions });
    return found;
  }

  markApplyFailed(id: string, error: string): GroupBackgroundSuggestion {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    let found: GroupBackgroundSuggestion | null = null;
    const nextSuggestions = suggestions.map((suggestion) => {
      if (suggestion.id !== id) {
        return suggestion;
      }

      found = {
        ...suggestion,
        applyError: normalizeText(error, 500),
        applyErrorAt: now,
        updatedAt: now
      };
      return found;
    });

    if (!found) {
      throw new Error("Group background suggestion not found.");
    }

    this.write({ ...file, suggestions: nextSuggestions });
    return found;
  }

  markSourceDeleted(input: { groupId: string; documentId: string }): GroupBackgroundSuggestion[] {
    const file = this.read();
    const suggestions = file.suggestions ?? [];
    const now = new Date().toISOString();
    const stale: GroupBackgroundSuggestion[] = [];
    const nextSuggestions = suggestions.map((suggestion) => {
      if (
        suggestion.status !== "pending" ||
        suggestion.groupId !== input.groupId ||
        suggestion.sourceDocumentId !== input.documentId
      ) {
        return suggestion;
      }

      const next = {
        ...suggestion,
        status: "stale" as const,
        updatedAt: now,
        staleAt: now,
        staleReason: "Source chat message was deleted or rewound before review."
      };
      stale.push(next);
      return next;
    });

    if (stale.length > 0) {
      this.write({ ...file, suggestions: nextSuggestions });
    }
    return stale;
  }

  private read(): GroupBackgroundSuggestionFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as GroupBackgroundSuggestionFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: GroupBackgroundSuggestionFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function markPendingForGroupStale(
  suggestions: GroupBackgroundSuggestion[],
  groupId: string
): GroupBackgroundSuggestion[] {
  const now = new Date().toISOString();
  return suggestions.map((suggestion) =>
    suggestion.groupId === groupId && suggestion.status === "pending"
      ? {
          ...suggestion,
          status: "stale",
          updatedAt: now,
          staleAt: now,
          staleReason: "Replaced by a manual background refresh."
        }
      : suggestion
  );
}

export function groupBackgroundSuggestionsPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "group-background-suggestions.json");
}

function normalizeText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeSignificance(value: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function normalizeStringArray(values: string[] | undefined, maxCount: number, maxLength: number): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean))]
    .slice(0, maxCount)
    .map((value) => value.slice(0, maxLength));
}

function pruneSuggestions(
  suggestions: GroupBackgroundSuggestion[],
  options: GroupBackgroundPruneOptions
): GroupBackgroundSuggestion[] {
  const maxAgeDays = options.maxAgeDays ?? 30;
  const maxCompleted = options.maxCompleted ?? 200;
  const cutoffMs = (options.now?.getTime() ?? Date.now()) - maxAgeDays * 24 * 60 * 60 * 1000;
  const protectedSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const candidates = suggestions.filter((suggestion) => suggestion.status !== "pending");
  const recentCandidates = candidates.filter((suggestion) => suggestionTimestampMs(suggestion) >= cutoffMs);
  const retainedCandidateIds = new Set(
    [...recentCandidates]
      .sort((left, right) => suggestionTimestampMs(right) - suggestionTimestampMs(left))
      .slice(0, maxCompleted)
      .map((suggestion) => suggestion.id)
  );
  const protectedIds = new Set(protectedSuggestions.map((suggestion) => suggestion.id));
  return suggestions.filter((suggestion) => protectedIds.has(suggestion.id) || retainedCandidateIds.has(suggestion.id));
}

function suggestionTimestampMs(suggestion: GroupBackgroundSuggestion): number {
  const updated = Date.parse(suggestion.updatedAt);
  if (Number.isFinite(updated)) {
    return updated;
  }
  const created = Date.parse(suggestion.createdAt);
  return Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER;
}
