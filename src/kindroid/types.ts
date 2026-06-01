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
