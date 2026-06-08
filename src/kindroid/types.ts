export interface SendKindroidMessageInput {
  aiId: string;
  message: string;
  requestId: string;
  idempotencyKey: string;
  internetResponse?: string | null;
}

export interface SendKindroidMessageResult {
  status: number;
  ok: boolean;
  requestId: string;
  idempotencyKey: string;
  replyText?: string;
  responseText?: string;
}

export interface SendKindroidGroupMessageInput {
  groupId: string;
  message?: string;
  audioUrl?: string;
  requestId: string;
  idempotencyKey: string;
  internetResponse?: string | null;
  triggerAiResponse?: boolean;
  allowUserTurn?: boolean;
}

export interface SendKindroidGroupMessageResult {
  status: number;
  ok: boolean;
  requestId: string;
  idempotencyKey: string;
  responseText?: string;
  nextAiId?: string;
  aiResponseStatus?: number;
  aiResponseOk?: boolean;
  aiResponseText?: string;
}

export interface GetKindroidGroupTurnInput {
  groupId: string;
  allowUser: boolean;
}

export interface GetKindroidGroupTurnResult {
  status: number;
  ok: boolean;
  aiId?: string;
  responseText?: string;
}

export interface CreateKindroidGroupAiResponseInput {
  groupId: string;
  aiId: string;
  requestId: string;
}

export interface BreakKindroidChatInput {
  aiId: string;
  greeting: string;
  wipeCascaded?: boolean;
}

export interface BreakKindroidGroupChatInput {
  groupId: string;
  greeting: string;
  wipeCascaded?: boolean;
}

export interface RewindKindroidMessagesInput {
  aiId?: string;
  groupId?: string;
  count: number;
}

export interface KindroidMutationResult {
  status: number;
  ok: boolean;
  responseText?: string;
}

export interface UpdateKindroidCurrentSceneInput {
  aiId: string;
  currentScene: string;
}

export type UpdateKindroidCurrentSceneResult = KindroidMutationResult;

export interface UpdateKindroidGroupCurrentSceneInput {
  groupId: string;
  currentScene: string;
}

export type UpdateKindroidGroupCurrentSceneResult = UpdateKindroidCurrentSceneResult;
export type BreakKindroidChatResult = KindroidMutationResult;
export type BreakKindroidGroupChatResult = KindroidMutationResult;
export type RewindKindroidMessagesResult = KindroidMutationResult;

export interface CreateKindroidJournalEntryInput {
  aiId: string;
  entry: string;
  keyphrases?: string[];
}

export interface CreateKindroidJournalEntryResult {
  status: number;
  ok: boolean;
  responseText?: string;
}

export interface DeleteKindroidJournalEntryInput {
  aiId: string;
  id: string;
}

export type DeleteKindroidJournalEntryResult = CreateKindroidJournalEntryResult;

export interface GetKindroidChatMessagesInput {
  aiId?: string;
  groupId?: string;
  limit?: number;
  startAfterTimestamp?: number;
}

export interface KindroidChatHistoryMessage {
  id?: string;
  ai_id?: string;
  aiId?: string;
  sender?: string;
  sender_type?: string;
  display_name?: string;
  timestamp?: number;
  message?: string;
  image_urls?: string[];
  image_description?: string;
  video_description?: string;
  internet_response?: string;
  link_url?: string;
  link_description?: string;
}

export interface GetKindroidChatMessagesResult {
  status: number;
  ok: boolean;
  messages: KindroidChatHistoryMessage[];
  pagination?: {
    hasMore?: boolean;
    lastTimestamp?: number;
    limit?: number;
  };
  responseText?: string;
}

export interface UpdateKindroidIdentityInput {
  aiId: string;
  backstory: string;
  memory: string;
  exampleMessage: string;
  directive: string;
  additionalContext: string;
}

export type UpdateKindroidIdentityResult = UpdateKindroidCurrentSceneResult;

export interface UpdateKindroidChatDynamismInput {
  aiId: string;
  value: number;
}

export type UpdateKindroidChatDynamismResult = UpdateKindroidCurrentSceneResult;
