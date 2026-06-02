export interface SendKindroidMessageInput {
  aiId: string;
  message: string;
  requestId: string;
  idempotencyKey: string;
}

export interface SendKindroidMessageResult {
  status: number;
  ok: boolean;
  requestId: string;
  idempotencyKey: string;
  responseText?: string;
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
