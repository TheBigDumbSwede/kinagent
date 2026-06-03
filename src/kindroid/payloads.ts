import type {
  CreateKindroidJournalEntryInput,
  CreateKindroidGroupAiResponseInput,
  DeleteKindroidJournalEntryInput,
  GetKindroidGroupTurnInput,
  SendKindroidGroupMessageInput,
  SendKindroidMessageInput,
  UpdateKindroidCurrentSceneInput,
  UpdateKindroidChatDynamismInput,
  UpdateKindroidGroupCurrentSceneInput,
  UpdateKindroidIdentityInput
} from "./types.js";
import { normalizeChatDynamismInput } from "./chatDynamism.js";

export const currentSceneMaxLengthLimit = 160;

export function buildSendMessagePayload(input: SendKindroidMessageInput): Record<string, unknown> {
  return {
    ai_id: input.aiId,
    message: input.message,
    stream: false,
    idempotency_key: input.idempotencyKey,
    request_id: input.requestId,
    image_urls: null,
    image_description: null,
    video_url: null,
    video_description: null,
    internet_response: input.internetResponse ?? null,
    link_url: null,
    link_description: null,
    client_platform: "web"
  };
}

export function buildSendGroupMessagePayload(input: SendKindroidGroupMessageInput): Record<string, unknown> {
  return {
    message: input.message,
    image_urls: null,
    image_description: null,
    video_url: null,
    video_description: null,
    internet_response: input.internetResponse ?? null,
    link_url: null,
    link_description: null,
    client_platform: "web",
    group_id: input.groupId
  };
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
    stream: false,
    request_id: input.requestId,
    client_platform: "web"
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
