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
