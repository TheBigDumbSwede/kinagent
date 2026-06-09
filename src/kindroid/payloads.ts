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
  ApplyKindroidGroupBackgroundInput,
  UpdateKindroidGroupCurrentSceneInput,
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
    message: message ? input.message : undefined,
    image_urls: null,
    image_description: null,
    video_url: null,
    video_description: null,
    internet_response: input.internetResponse || null,
    link_url: null,
    link_description: null,
    client_platform: "web",
    group_id: input.groupId
  };
  if (message) {
    payload.message = input.message;
  }
  if (audioUrl) {
    delete payload.message;
    payload.audio_url = audioUrl;
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
    stream: false,
    request_id: input.requestId,
    client_platform: "web"
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

export function buildApplyGroupBackgroundPayload(input: {
  group: Record<string, unknown>;
  storagePath: string;
}): Record<string, unknown> {
  const groupId = stringValue(input.group.group_id);
  if (!groupId) {
    throw new Error("Missing Kindroid group_id for background update.");
  }

  return {
    group_id: groupId,
    ai_list: normalizeGroupAiList(input.group.group_ais),
    group_name: stringValue(input.group.group_name) ?? "",
    group_context: stringValue(input.group.group_context) ?? "",
    group_directive: stringValue(input.group.group_directive) ?? "",
    use_manual_turntaking: booleanValue(input.group.use_manual_turntaking, false),
    share_short_term_memory: booleanValue(input.group.share_short_term_memory, false),
    disable_ltm_recall: booleanValue(input.group.disable_ltm_recall, false),
    disable_ltm_consolidate: booleanValue(input.group.disable_ltm_consolidate, false),
    user_persona_id: stringValue(input.group.user_persona_id) ?? "",
    background_settings: {
      ...defaultBackgroundSettings(input.group.background_settings),
      background_url: input.storagePath,
      use_latest_gallery: false
    }
  };
}

export function validateApplyGroupBackgroundInput(input: ApplyKindroidGroupBackgroundInput): void {
  if (!input.groupId) {
    throw new Error("Missing Kindroid group_id for background update.");
  }
  if (!input.image.length) {
    throw new Error("Group background image is empty.");
  }
  if (!input.fileName.endsWith(".png")) {
    throw new Error("Group background image file name must end in .png.");
  }
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

function defaultBackgroundSettings(value: unknown): Record<string, unknown> {
  const existing =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    background_url: "",
    use_latest_gallery: false,
    background_opacity: numberValue(existing.background_opacity, 50),
    message_fading_strength: numberValue(existing.message_fading_strength, 0),
    message_mask_drag: numberValue(existing.message_mask_drag, 0.2),
    background_blur: numberValue(existing.background_blur, 0),
    enable_background_blur_on_wide_screen_only: booleanValue(existing.enable_background_blur_on_wide_screen_only, true),
    enable_message_fade: booleanValue(existing.enable_message_fade, false),
    top_offset: numberValue(existing.top_offset, 0),
    left_offset: numberValue(existing.left_offset, 50)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeGroupAiList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string" && item.length > 0) {
      return [item];
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const aiId = stringValue(record.ai_id) ?? stringValue(record.aiId) ?? stringValue(record.id);
      return aiId ? [aiId] : [];
    }
    return [];
  });
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
