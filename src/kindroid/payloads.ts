import type {
  BreakKindroidChatInput,
  BreakKindroidGroupChatInput,
  CreateKindroidJournalEntryInput,
  CreateKindroidGroupAiResponseInput,
  DeleteKindroidJournalEntryInput,
  GetKindroidGroupTurnInput,
  RewindKindroidMessagesInput,
  SendKindroidGroupMessageInput,
  SendKindroidMessageInput,
  UpdateKindroidCurrentSceneInput,
  UpdateKindroidChatDynamismInput,
  UpdateKindroidGroupCurrentSceneInput,
  UpdateKindroidGroupTurnTakingInput,
  UpdateKindroidIdentityInput
} from "./types.js";
import { normalizeChatDynamismInput } from "./chatDynamism.js";

export const currentSceneMaxLengthLimit = 160;

export function buildSendMessagePayload(input: SendKindroidMessageInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ai_id: input.aiId,
    message: input.message,
    stream: false
  };

  if (input.internetResponse) {
    payload.internet_response = input.internetResponse;
  }

  return payload;
}

export function buildSendGroupMessagePayload(input: SendKindroidGroupMessageInput): Record<string, unknown> {
  const message = input.message?.trim();
  const audioUrl = input.audioUrl?.trim();
  if (message && audioUrl) {
    throw new Error("Group user message must specify either message or audioUrl, not both.");
  }
  if (!message && !audioUrl) {
    throw new Error("Group user message requires message or audioUrl.");
  }

  const payload: Record<string, unknown> = {
    group_id: input.groupId
  };
  if (message) {
    payload.message = input.message;
  }
  if (audioUrl) {
    payload.audio_url = audioUrl;
  }

  if (input.internetResponse) {
    payload.internet_response = input.internetResponse;
  }

  return payload;
}

export function buildGetGroupTurnPayload(input: GetKindroidGroupTurnInput): Record<string, unknown> {
  return {
    group_id: input.groupId,
    allow_user: input.allowUser
  };
}

export function buildCreateGroupAiResponsePayload(input: CreateKindroidGroupAiResponseInput): Record<string, unknown> {
  return {
    ai_id: input.aiId,
    group_id: input.groupId,
    stream: false
  };
}

export function buildBreakChatPayload(input: BreakKindroidChatInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for chat break.");
  }

  const greeting = input.greeting.trim();
  if (!greeting) {
    throw new Error("Chat break greeting cannot be empty.");
  }

  const payload: Record<string, unknown> = {
    ai_id: input.aiId,
    greeting
  };
  if (typeof input.wipeCascaded === "boolean") {
    payload.wipe_cascaded = input.wipeCascaded;
  }
  return payload;
}

export function buildBreakGroupChatPayload(input: BreakKindroidGroupChatInput): Record<string, unknown> {
  if (!input.groupId) {
    throw new Error("Missing Kindroid group_id for group chat break.");
  }

  const greeting = input.greeting.trim();
  if (!greeting) {
    throw new Error("Group chat break greeting cannot be empty.");
  }

  const payload: Record<string, unknown> = {
    group_id: input.groupId,
    greeting
  };
  if (typeof input.wipeCascaded === "boolean") {
    payload.wipe_cascaded = input.wipeCascaded;
  }
  return payload;
}

export function buildRewindMessagesPayload(input: RewindKindroidMessagesInput): Record<string, unknown> {
  if (input.aiId && input.groupId) {
    throw new Error("Rewind request must specify either aiId or groupId, not both.");
  }
  if (!input.aiId && !input.groupId) {
    throw new Error("Rewind request requires an aiId or groupId.");
  }
  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new Error("Rewind count must be a positive integer.");
  }
  if (input.aiId && input.count % 2 !== 0) {
    throw new Error("Direct Kin rewind count must be even.");
  }

  return {
    ...(input.aiId ? { ai_id: input.aiId } : { group_id: input.groupId }),
    count: input.count
  };
}

export function buildUpdateCurrentScenePayload(input: UpdateKindroidCurrentSceneInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for current scene update.");
  }

  return {
    ai_id: input.aiId,
    current_scene: validateCurrentScene(input.currentScene)
  };
}

export function buildUpdateGroupCurrentScenePayload(
  input: UpdateKindroidGroupCurrentSceneInput
): Record<string, unknown> {
  if (!input.groupId) {
    throw new Error("Missing Kindroid group_id for current scene update.");
  }

  return {
    group_id: input.groupId,
    current_scene: validateCurrentScene(input.currentScene)
  };
}

export function buildUpdateGroupTurnTakingPayload(input: UpdateKindroidGroupTurnTakingInput): Record<string, unknown> {
  if (!input.groupId) {
    throw new Error("Missing Kindroid group_id for turn-taking update.");
  }

  return {
    group_id: input.groupId,
    use_manual_turntaking: input.useManualTurntaking
  };
}

export function buildCreateJournalEntryPayload(input: CreateKindroidJournalEntryInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for journal entry creation.");
  }

  const entry = input.entry.trim();
  if (!entry) {
    throw new Error("Journal entry cannot be empty.");
  }

  return {
    entry,
    keyphrases: normalizeKeyphrases(input.keyphrases),
    ai_id: input.aiId
  };
}

export function buildDeleteJournalEntryPayload(input: DeleteKindroidJournalEntryInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for journal entry deletion.");
  }

  if (!input.id) {
    throw new Error("Missing Kindroid journal entry id for deletion.");
  }

  return {
    ai_id: input.aiId,
    id: input.id
  };
}

export function buildUpdateIdentityPayload(input: UpdateKindroidIdentityInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for identity update.");
  }

  if (!input.backstory.trim()) {
    throw new Error("Backstory cannot be empty.");
  }

  return {
    ai_id: input.aiId,
    ai_backstory: input.backstory,
    ai_memory: input.memory,
    ai_example_message: input.exampleMessage,
    ai_directive: input.directive,
    ai_additional_context: input.additionalContext
  };
}

export function buildUpdateChatDynamismPayload(input: UpdateKindroidChatDynamismInput): Record<string, unknown> {
  if (!input.aiId) {
    throw new Error("Missing Kindroid ai_id for Chat Dynamism update.");
  }

  return {
    ai_id: input.aiId,
    user_set_temperature: normalizeChatDynamismInput(input.value)
  };
}

export function validateCurrentScene(value: string): string {
  const currentScene = value.trim();
  if (!currentScene) {
    throw new Error("Current scene cannot be empty.");
  }
  if (currentScene.length > currentSceneMaxLengthLimit) {
    throw new Error(`Current scene cannot exceed ${currentSceneMaxLengthLimit} characters.`);
  }

  return currentScene;
}

function normalizeKeyphrases(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
}
