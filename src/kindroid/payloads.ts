import type {
  CreateKindroidJournalEntryInput,
  SendKindroidMessageInput,
  UpdateKindroidCurrentSceneInput,
  UpdateKindroidGroupCurrentSceneInput,
  UpdateKindroidIdentityInput
} from "./types.js";

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
    internet_response: null,
    link_url: null,
    link_description: null,
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
