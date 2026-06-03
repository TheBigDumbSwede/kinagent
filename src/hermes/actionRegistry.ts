import type { KindroidChatNotification } from "../firestore/types.js";
import { createCapturedJournalContextProvider, type JournalSuggestionContext } from "../journal/journalContext.js";
import { type JournalSuggestion, type JournalSuggestionStore } from "../journal/journalSuggestionStore.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import {
  AmbientContextActionHandler,
  isAmbientContextSender,
  type AmbientContextSentEvent
} from "./ambientContextActionHandler.js";
import {
  CurrentSceneActionHandler,
  type HermesActionHandler,
  type KindroidSceneUpdater
} from "./currentSceneActionHandler.js";
import { JournalSuggestionActionHandler } from "./journalSuggestionActionHandler.js";

export interface HermesActionRegistryOptions {
  journalSuggestions?: JournalSuggestionStore;
  onJournalSuggestionCreated?: (suggestion: JournalSuggestion) => void;
  journalContextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
  dedupeStore?: DedupeStore;
  onAmbientContextSent?: (event: AmbientContextSentEvent) => void;
}

export interface HermesActionRegistry {
  handlers: Array<HermesActionHandler<unknown>>;
  journalContextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
}

export interface HermesActionRegistryEntry {
  actionTypes: string[];
  handler: string;
  enabledWhen: string;
  execution: "immediate" | "reviewed";
  scope: string;
}

export const hermesActionRegistryEntries: HermesActionRegistryEntry[] = [
  {
    actionTypes: ["update_current_scene", "update_group_current_scene"],
    handler: "CurrentSceneActionHandler",
    enabledWhen: "hermes.enabled and hermes.currentSceneUpdates.enabled are true",
    execution: "immediate",
    scope: "Updates Kindroid current_scene for the same direct Kin or group chat."
  },
  {
    actionTypes: ["send_ambient_context_turn"],
    handler: "AmbientContextActionHandler",
    enabledWhen: "a Kindroid send client and outbound DedupeStore are provided",
    execution: "immediate",
    scope: "Sends a direct Kin ambient visible message with hidden internet_response context."
  },
  {
    actionTypes: ["propose_journal_entry", "delete_journal_entry"],
    handler: "JournalSuggestionActionHandler",
    enabledWhen: "bridge runtime provides a JournalSuggestionStore and hermes.journalSuggestions.enabled is true",
    execution: "reviewed",
    scope:
      "Creates pending desktop review items for journal creation or deletion; Kindroid is mutated only after acceptance."
  }
];

export function createHermesActionRegistry(input: {
  config: AppConfig;
  logger: Logger;
  kindroidClient: KindroidSceneUpdater;
  options?: HermesActionRegistryOptions;
}): HermesActionRegistry {
  const options = input.options ?? {};
  const handlers: Array<HermesActionHandler<unknown>> = [
    new CurrentSceneActionHandler(input.config, input.logger, input.kindroidClient)
  ];
  let journalContextProvider:
    | ((notification: KindroidChatNotification) => Promise<JournalSuggestionContext>)
    | undefined;

  if (options.dedupeStore && isAmbientContextSender(input.kindroidClient)) {
    handlers.push(
      new AmbientContextActionHandler(
        input.logger,
        input.kindroidClient,
        options.dedupeStore,
        options.onAmbientContextSent
      )
    );
  }

  if (options.journalSuggestions) {
    journalContextProvider = options.journalContextProvider ?? createCapturedJournalContextProvider(input.logger);
    handlers.push(
      new JournalSuggestionActionHandler(input.logger, options.journalSuggestions, options.onJournalSuggestionCreated, {
        contextProvider: journalContextProvider
      })
    );
  }

  return {
    handlers,
    journalContextProvider
  };
}
