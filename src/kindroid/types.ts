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
  responseText?: string;
}

export interface SendKindroidGroupMessageInput {
  groupId: string;
  message: string;
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

export interface CreateKindroidGroupAiResponseInput {
  groupId: string;
  aiId: string;
  requestId: string;
}

export interface UpdateKindroidCurrentSceneInput {
  aiId: string;
  currentScene: string;
}

export interface UpdateKindroidCurrentSceneResult {
  status: number;
  ok: boolean;
  responseText?: string;
}

export interface UpdateKindroidGroupCurrentSceneInput {
  groupId: string;
  currentScene: string;
}

export type UpdateKindroidGroupCurrentSceneResult = UpdateKindroidCurrentSceneResult;

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
