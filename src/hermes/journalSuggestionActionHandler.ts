import type { KindroidChatNotification } from "../firestore/types.js";
import type { JournalSuggestionContext } from "../journal/journalContext.js";
import {
  journalSuggestionCategories,
  type JournalSuggestion,
  type JournalSuggestionStore
} from "../journal/journalSuggestionStore.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface ProposeJournalEntryAction {
  type: "propose_journal_entry";
  ai_id?: string;
  title: string;
  entry: string;
  category?: string;
  category_detail?: string;
  keyphrases?: string[];
  evidence?: string[];
  durability_reason?: string;
  confidence?: string;
  strong_event?: boolean;
  reason?: string;
}

export interface DeleteJournalEntryAction {
  type: "delete_journal_entry";
  ai_id?: string;
  journal_entry_id: string;
  title: string;
  target_title?: string;
  target_entry?: string;
  evidence?: string[];
  durability_reason?: string;
  confidence?: string;
  strong_event?: boolean;
  reason?: string;
}

type JournalReviewAction = ProposeJournalEntryAction | DeleteJournalEntryAction;

export interface JournalSuggestionActionHandlerOptions {
  contextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
}

export class JournalSuggestionActionHandler implements HermesActionHandler<JournalReviewAction> {
  constructor(
    private readonly logger: Logger,
    private readonly store: JournalSuggestionStore,
    private readonly onSuggestionCreated?: (suggestion: JournalSuggestion) => void,
    private readonly options: JournalSuggestionActionHandlerOptions = {}
  ) {}

  promptLines(): string[] {
    return [
      `For durable Kin memories, you may request a triggerable capsule: {"type":"propose_journal_entry","ai_id":"<same ai_id>","title":"<specific short title>","category":"${journalSuggestionCategories[0]}","category_detail":"<optional more specific durable label>","entry":"<concise third-person journal capsule>","keyphrases":["<distinctive recall phrase>"],"evidence":["<specific message evidence>"],"durability_reason":"<why this changes future interpretation>","confidence":"high","strong_event":false}.`,
      'For stale, contradicted, or duplicate existing journal entries, you may request reviewed deletion: {"type":"delete_journal_entry","ai_id":"<same ai_id>","journal_entry_id":"<id from journalContext.existingEntries>","title":"<short deletion review title>","target_title":"<existing entry title>","target_entry":"<brief existing entry excerpt>","evidence":["<specific contradiction or duplicate evidence>"],"durability_reason":"<why keeping this entry would harm future recall>","confidence":"high","strong_event":false}.',
      `Prefer these review buckets when they fit: ${journalSuggestionCategories.join(", ")}. If none fit, use "other_durable_event" and a specific category_detail. Do not invent many top-level buckets.`,
      "Only propose journal entries from Kin-authored messages where sender is ai. Never propose journal entries from user-authored messages.",
      "Use the Kin design reference model: journals are triggerable capsules, not always-on rules or duplicated backstory.",
      "A journal entry is only for durable events, decisions, milestones, relationship changes, important personal facts, recurring patterns, behaviour callbacks, place/world capsules, or backstory hook movement.",
      "Keep entries short, specific, third-person, and useful when recalled later. Prefer names and concrete nouns over generic emotion labels.",
      "Use 1 to 8 distinctive keyphrases that would naturally trigger recall; avoid generic keyphrases like memory, important, relationship, feelings, event, milestone, or personal fact by themselves.",
      "Compare against journalContext.existingEntries and journalContext.fieldExcerpts when present; do not propose a duplicate or a fact already represented in stronger fields.",
      "Only propose delete_journal_entry for an id present in journalContext.existingEntries. Never invent a journal_entry_id.",
      "Do not propose journal entries for routine greetings, small talk, transient moods, scene movement, playful banter without durable consequence, ambiguity, speculation, untagged emotional mush, or content that belongs in Key Memories.",
      "Use strong_event only for explicit commitments, clear relationship transitions, resolved conflicts, important personal facts, major reveals, or backstory hook advancement/resolution."
    ];
  }

  normalizeActions(decision: HermesActionDecision): JournalReviewAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): JournalReviewAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (record.confidence !== "high" || typeof record.title !== "string") {
        return [];
      }

      const durabilityReason =
        typeof record.durability_reason === "string"
          ? record.durability_reason
          : typeof record.reason === "string"
            ? record.reason
            : "";
      if (!durabilityReason.trim()) {
        return [];
      }

      if (record.type === "delete_journal_entry") {
        if (typeof record.journal_entry_id !== "string" || !record.journal_entry_id.trim()) {
          return [];
        }

        return [
          {
            type: "delete_journal_entry",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            journal_entry_id: record.journal_entry_id,
            title: record.title,
            target_title: typeof record.target_title === "string" ? record.target_title : undefined,
            target_entry: typeof record.target_entry === "string" ? record.target_entry : undefined,
            evidence: stringArray(record.evidence),
            durability_reason: durabilityReason,
            confidence: "high",
            strong_event: record.strong_event === true
          }
        ];
      }

      if (record.type !== "propose_journal_entry" || typeof record.entry !== "string") {
        return [];
      }

      return [
        {
          type: "propose_journal_entry",
          ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
          title: record.title,
          category: typeof record.category === "string" ? record.category : undefined,
          category_detail: typeof record.category_detail === "string" ? record.category_detail : undefined,
          entry: record.entry,
          keyphrases: stringArray(record.keyphrases),
          evidence: stringArray(record.evidence),
          durability_reason: durabilityReason,
          confidence: "high",
          strong_event: record.strong_event === true
        }
      ];
    });
  }

  async handle(notification: KindroidChatNotification, action: JournalReviewAction): Promise<void> {
    if (notification.sender !== "ai") {
      this.logger.info("Ignoring Hermes journal suggestion for non-Kin-authored message.", {
        sender: notification.sender,
        documentId: notification.documentId
      });
      return;
    }

    const notificationAiId = notification.type === "kindroid.chat.changed" ? notification.kinId : notification.aiId;
    if (!notificationAiId) {
      this.logger.warn("Ignoring Hermes journal suggestion without a Kin ai_id.", {
        documentId: notification.documentId
      });
      return;
    }

    const targetAiId = action.ai_id ?? notificationAiId;
    if (targetAiId !== notificationAiId) {
      this.logger.warn("Ignoring Hermes journal suggestion for mismatched ai_id.", {
        expectedAiId: notificationAiId,
        requestedAiId: targetAiId
      });
      return;
    }

    const context = (await this.options.contextProvider?.(notification)) ?? { existingEntries: [], fieldExcerpts: [] };
    if (action.type === "delete_journal_entry") {
      const target = context.existingEntries.find((entry) => entry.id === action.journal_entry_id);
      if (!target) {
        this.logger.warn("Ignoring Hermes journal delete suggestion for unknown journal entry id.", {
          aiId: notificationAiId,
          requestedJournalEntryId: action.journal_entry_id
        });
        return;
      }

      const suggestion = this.store.createPendingDelete(notification, {
        title: action.title,
        targetJournalEntryId: target.id,
        targetJournalTitle: action.target_title ?? target.title,
        targetJournalEntry: action.target_entry ?? target.entry,
        evidence: action.evidence ?? [],
        durabilityReason: action.durability_reason ?? "",
        confidence: "high",
        strongEvent: action.strong_event === true
      });
      this.emitSuggestion(notificationAiId, notification.documentId, action.strong_event === true, suggestion);
      return;
    }

    const suggestion = this.store.createPending(notification, {
      title: action.title,
      entry: action.entry,
      category: action.category,
      categoryDetail: action.category_detail,
      keyphrases: action.keyphrases ?? [],
      evidence: action.evidence ?? [],
      durabilityReason: action.durability_reason ?? "",
      confidence: "high",
      strongEvent: action.strong_event === true,
      existingEntries: context.existingEntries
    });

    this.emitSuggestion(notificationAiId, notification.documentId, action.strong_event === true, suggestion);
  }

  private emitSuggestion(
    aiId: string,
    documentId: string,
    strongEvent: boolean,
    suggestion: JournalSuggestion | null
  ): void {
    if (!suggestion) {
      this.logger.info("Hermes journal suggestion skipped by pacing rules.", {
        aiId,
        documentId,
        strongEvent
      });
      return;
    }

    this.logger.info("Hermes journal suggestion created.", {
      aiId: suggestion.aiId,
      documentId: suggestion.documentId,
      action: suggestion.action,
      keyphraseCount: suggestion.keyphrases.length,
      evidenceCount: suggestion.evidence.length,
      strongEvent: suggestion.strongEvent
    });
    this.onSuggestionCreated?.(suggestion);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
