import type { KindroidChatNotification } from "../firestore/types.js";
import { type JournalSuggestion, type JournalSuggestionStore } from "../journal/journalSuggestionStore.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface ProposeJournalEntryAction {
  type: "propose_journal_entry";
  ai_id?: string;
  title: string;
  entry: string;
  keyphrases?: string[];
  evidence?: string[];
  durability_reason?: string;
  confidence?: string;
  strong_event?: boolean;
  reason?: string;
}

export class JournalSuggestionActionHandler implements HermesActionHandler<ProposeJournalEntryAction> {
  constructor(
    private readonly logger: Logger,
    private readonly store: JournalSuggestionStore,
    private readonly onSuggestionCreated?: (suggestion: JournalSuggestion) => void
  ) {}

  promptLines(): string[] {
    return [
      'For durable Kin memories, you may request a triggerable capsule: {"type":"propose_journal_entry","ai_id":"<same ai_id>","title":"<specific short title>","entry":"<concise third-person journal capsule>","keyphrases":["<distinctive recall phrase>"],"evidence":["<specific message evidence>"],"durability_reason":"<why this changes future interpretation>","confidence":"high","strong_event":false}.',
      "Only propose journal entries from Kin-authored messages where sender is ai. Never propose journal entries from user-authored messages.",
      "Use the Kin design reference model: journals are triggerable capsules, not always-on rules or duplicated backstory.",
      "A journal entry is only for durable events, decisions, milestones, relationship changes, important personal facts, recurring patterns, behaviour callbacks, place/world capsules, or backstory hook movement.",
      "Keep entries short, specific, third-person, and useful when recalled later. Prefer names and concrete nouns over generic emotion labels.",
      "Use 1 to 8 distinctive keyphrases that would naturally trigger recall; avoid generic keyphrases like memory, important, relationship, or feelings by themselves.",
      "Do not propose journal entries for routine greetings, small talk, transient moods, scene movement, playful banter without durable consequence, ambiguity, speculation, untagged emotional mush, or content that belongs in Key Memories.",
      "Use strong_event only for explicit commitments, clear relationship transitions, resolved conflicts, important personal facts, major reveals, or backstory hook advancement/resolution."
    ];
  }

  normalizeActions(decision: HermesActionDecision): ProposeJournalEntryAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): ProposeJournalEntryAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (record.type !== "propose_journal_entry") {
        return [];
      }

      if (record.confidence !== "high" || typeof record.title !== "string" || typeof record.entry !== "string") {
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

      return [
        {
          type: "propose_journal_entry",
          ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
          title: record.title,
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

  async handle(notification: KindroidChatNotification, action: ProposeJournalEntryAction): Promise<void> {
    if (notification.sender !== "ai") {
      this.logger.info("Ignoring Hermes journal suggestion for non-Kin-authored message.", {
        sender: notification.sender,
        documentId: notification.documentId
      });
      return;
    }

    const notificationAiId = notification.type === "kindroid.chat.changed" ? notification.kinId : notification.aiId;
    const targetAiId = action.ai_id ?? notificationAiId;
    if (targetAiId !== notificationAiId) {
      this.logger.warn("Ignoring Hermes journal suggestion for mismatched ai_id.", {
        expectedAiId: notificationAiId,
        requestedAiId: targetAiId
      });
      return;
    }

    const suggestion = this.store.createPending(notification, {
      title: action.title,
      entry: action.entry,
      keyphrases: action.keyphrases ?? [],
      evidence: action.evidence ?? [],
      durabilityReason: action.durability_reason ?? "",
      confidence: "high",
      strongEvent: action.strong_event === true
    });

    if (!suggestion) {
      this.logger.info("Hermes journal suggestion skipped by pacing rules.", {
        aiId: notificationAiId,
        documentId: notification.documentId,
        strongEvent: action.strong_event === true
      });
      return;
    }

    this.logger.info("Hermes journal suggestion created.", {
      aiId: suggestion.aiId,
      documentId: suggestion.documentId,
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
