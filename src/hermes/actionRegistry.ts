import type { KindroidChatNotification } from "../firestore/types.js";
import {
  type ChatDynamismSuggestion,
  type ChatDynamismSuggestionStore
} from "../chatDynamism/chatDynamismSuggestionStore.js";
import { createCapturedJournalContextProvider, type JournalSuggestionContext } from "../journal/journalContext.js";
import { type JournalSuggestion, type JournalSuggestionStore } from "../journal/journalSuggestionStore.js";
import type { DedupeStore } from "../state/dedupeStore.js";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import { ChatDynamismActionHandler } from "./chatDynamismActionHandler.js";
import { LocalSceneActionHandler } from "./localSceneActionHandler.js";
import {
  AmbientContextActionHandler,
  isAmbientContextSender,
  type AmbientContextPreference,
  type AmbientContextSentEvent
} from "./ambientContextActionHandler.js";
import {
  CurrentSceneActionHandler,
  type HermesActionHandler,
  type KindroidSceneUpdater
} from "./currentSceneActionHandler.js";
import { JournalSuggestionActionHandler } from "./journalSuggestionActionHandler.js";
import { type LocalSceneState, type LocalSceneStateStore } from "../localScene/localSceneStore.js";
import {
  SoundscapeActionHandler,
  type ScopedSoundscapeUpdate,
  type SoundscapePreference
} from "./soundscapeActionHandler.js";

export interface HermesActionRegistryOptions {
  journalSuggestions?: JournalSuggestionStore;
  onJournalSuggestionCreated?: (suggestion: JournalSuggestion) => void;
  localScenes?: LocalSceneStateStore;
  onLocalSceneUpdated?: (state: LocalSceneState) => void;
  chatDynamismSuggestions?: ChatDynamismSuggestionStore;
  onChatDynamismSuggestionCreated?: (suggestion: ChatDynamismSuggestion) => void;
  isChatDynamismEnabled?: (aiId: string) => boolean;
  chatDynamismRange?: (aiId: string) => { min: number; max: number };
  journalContextProvider?: (notification: KindroidChatNotification) => Promise<JournalSuggestionContext>;
  dedupeStore?: DedupeStore;
  onAmbientContextSent?: (event: AmbientContextSentEvent) => void;
  isAmbientContextEnabled?: AmbientContextPreference;
  onSoundscapeUpdated?: (update: ScopedSoundscapeUpdate) => void;
  isSoundscapeEnabled?: SoundscapePreference;
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
    actionTypes: ["update_local_scene_state", "update_group_local_scene_state"],
    handler: "LocalSceneActionHandler",
    enabledWhen: "bridge runtime provides a LocalSceneStateStore",
    execution: "immediate",
    scope: "Stores local-only backstage scene metadata for the same direct Kin or group chat."
  },
  {
    actionTypes: ["update_current_scene", "update_group_current_scene"],
    handler: "CurrentSceneActionHandler",
    enabledWhen: "hermes.enabled and hermes.currentSceneUpdates.enabled are true",
    execution: "immediate",
    scope: "Updates Kindroid current_scene for the same direct Kin or group chat."
  },
  {
    actionTypes: ["update_soundscape", "update_group_soundscape"],
    handler: "SoundscapeActionHandler",
    enabledWhen:
      "a desktop soundscape callback is provided and the direct Kin or Group Audio soundscape setting is enabled",
    execution: "immediate",
    scope: "Emits local desktop procedural soundscape metadata for the same direct Kin or group chat."
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
  },
  {
    actionTypes: ["propose_chat_dynamism_adjustment"],
    handler: "ChatDynamismActionHandler",
    enabledWhen:
      "bridge runtime provides a ChatDynamismSuggestionStore and hermes.chatDynamism.suggestions.enabled is true",
    execution: "reviewed",
    scope: "Creates pending direct-Kin Chat Dynamism review items; no Kindroid mutation is performed automatically."
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
        options.onAmbientContextSent,
        options.isAmbientContextEnabled
      )
    );
  }

  if (options.onSoundscapeUpdated) {
    handlers.push(new SoundscapeActionHandler(input.logger, options.onSoundscapeUpdated, options.isSoundscapeEnabled));
  }

  if (options.localScenes) {
    handlers.push(new LocalSceneActionHandler(input.logger, options.localScenes, options.onLocalSceneUpdated));
  }

  if (options.journalSuggestions) {
    journalContextProvider = options.journalContextProvider ?? createCapturedJournalContextProvider(input.logger);
    handlers.push(
      new JournalSuggestionActionHandler(input.logger, options.journalSuggestions, options.onJournalSuggestionCreated, {
        contextProvider: journalContextProvider
      })
    );
  }

  if (options.chatDynamismSuggestions) {
    handlers.push(
      new ChatDynamismActionHandler(
        input.config,
        input.logger,
        options.chatDynamismSuggestions,
        options.onChatDynamismSuggestionCreated,
        {
          isEnabled: options.isChatDynamismEnabled,
          range: options.chatDynamismRange
        }
      )
    );
  }

  return {
    handlers,
    journalContextProvider
  };
}
