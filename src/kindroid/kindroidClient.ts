import type { AppConfig } from "../config/types.js";
import { loadFreshFirebaseAuth } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import type {
  BreakKindroidChatInput,
  BreakKindroidChatResult,
  BreakKindroidGroupChatInput,
  BreakKindroidGroupChatResult,
  CreateKindroidJournalEntryInput,
  CreateKindroidJournalEntryResult,
  CreateKindroidGroupAiResponseInput,
  DeleteKindroidJournalEntryInput,
  DeleteKindroidJournalEntryResult,
  GetKindroidChatMessagesInput,
  GetKindroidChatMessagesResult,
  GetKindroidGroupTurnInput,
  GetKindroidGroupTurnResult,
  RewindKindroidMessagesInput,
  RewindKindroidMessagesResult,
  SendKindroidGroupMessageInput,
  SendKindroidGroupMessageResult,
  SendKindroidMessageInput,
  SendKindroidMessageResult,
  UpdateKindroidCurrentSceneInput,
  UpdateKindroidCurrentSceneResult,
  UpdateKindroidChatDynamismInput,
  UpdateKindroidChatDynamismResult,
  UpdateKindroidGroupCurrentSceneInput,
  UpdateKindroidGroupCurrentSceneResult,
  UpdateKindroidGroupTurnTakingInput,
  UpdateKindroidGroupTurnTakingResult,
  UpdateKindroidIdentityInput,
  UpdateKindroidIdentityResult
} from "./types.js";
import {
  buildBreakChatPayload,
  buildBreakGroupChatPayload,
  buildCreateJournalEntryPayload,
  buildCreateGroupAiResponsePayload,
  buildDeleteJournalEntryPayload,
  buildGetGroupTurnPayload,
  buildRewindMessagesPayload,
  buildSendGroupMessagePayload,
  buildSendMessagePayload,
  buildUpdateCurrentScenePayload,
  buildUpdateChatDynamismPayload,
  buildUpdateGroupCurrentScenePayload,
  buildUpdateGroupTurnTakingPayload,
  buildUpdateIdentityPayload
} from "./payloads.js";

const sendMessageUrl = "https://api.kindroid.ai/v1/send-message";
const groupUserMessageUrl = "https://api.kindroid.ai/v1/groupchats-user-message";
const groupGetTurnUrl = "https://api.kindroid.ai/v1/groupchats-get-turn";
const groupAiResponseUrl = "https://api.kindroid.ai/v1/groupchats-ai-response";
const chatBreakUrl = "https://api.kindroid.ai/v1/chat-break";
const groupChatBreakUrl = "https://api.kindroid.ai/v1/groupchats-chat-break";
const rewindMessagesUrl = "https://api.kindroid.ai/v1/rewind-messages";
const updateInfoUrl = "https://api.kindroid.ai/v1/update-info";
const updateGroupChatUrl = "https://api.kindroid.ai/v1/groupchats-update";
const journalCreateUrl = "https://api.kindroid.ai/v1/journal-create";
const journalDeleteUrl = "https://api.kindroid.ai/v1/journal-delete";
const getChatMessagesUrl = "https://api.kindroid.ai/v1/get-chat-messages";

export class KindroidClient {
  private fallbackAuthWarningLogged = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async sendMessage(input: SendKindroidMessageInput): Promise<SendKindroidMessageResult> {
    const payload = buildSendMessagePayload(input);
    const response = await fetch(sendMessageUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid send-message request completed.", {
      status: response.status,
      ok: response.ok,
      requestId: input.requestId
    });

    return {
      status: response.status,
      ok: response.ok,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      replyText: response.ok ? responseText : undefined,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async sendGroupMessage(input: SendKindroidGroupMessageInput): Promise<SendKindroidGroupMessageResult> {
    const userMessagePayload = buildSendGroupMessagePayload(input);
    const userMessageResponse = await fetch(groupUserMessageUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(userMessagePayload)
    });

    const userMessageResponseText = await userMessageResponse.text();
    this.logger.info("Kindroid groupchats-user-message request completed.", {
      status: userMessageResponse.status,
      ok: userMessageResponse.ok,
      groupId: input.groupId,
      requestId: input.requestId
    });

    if (!userMessageResponse.ok) {
      return {
        status: userMessageResponse.status,
        ok: false,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        responseText: userMessageResponseText.slice(0, 1000)
      };
    }

    if (!input.triggerAiResponse) {
      return {
        status: userMessageResponse.status,
        ok: true,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey
      };
    }

    const turnResult = await this.getGroupTurn({ groupId: input.groupId, allowUser: input.allowUserTurn ?? false });
    if (!turnResult.ok || !turnResult.aiId) {
      return {
        status: userMessageResponse.status,
        ok: false,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        responseText: turnResult.responseText,
        nextAiId: turnResult.aiId
      };
    }

    const aiResponseRequestId = `group-ai-${input.groupId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const aiResponseResult = await this.createGroupAiResponse({
      groupId: input.groupId,
      aiId: turnResult.aiId,
      requestId: aiResponseRequestId
    });

    return {
      status: userMessageResponse.status,
      ok: aiResponseResult.ok,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      nextAiId: turnResult.aiId,
      aiResponseStatus: aiResponseResult.status,
      aiResponseOk: aiResponseResult.ok,
      aiResponseText: aiResponseResult.replyText ?? aiResponseResult.responseText,
      responseText: aiResponseResult.ok ? undefined : aiResponseResult.responseText
    };
  }

  async getGroupTurn(input: GetKindroidGroupTurnInput): Promise<GetKindroidGroupTurnResult> {
    const payload = buildGetGroupTurnPayload(input);
    const response = await fetch(groupGetTurnUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = (await response.text()).trim();
    this.logger.info("Kindroid groupchats-get-turn request completed.", {
      status: response.status,
      ok: response.ok,
      groupId: input.groupId,
      allowUser: input.allowUser,
      aiIdPresent: Boolean(responseText)
    });

    return {
      status: response.status,
      ok: response.ok,
      aiId: response.ok && responseText ? responseText : undefined,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  private async createGroupAiResponse(input: CreateKindroidGroupAiResponseInput): Promise<{
    ok: boolean;
    status: number;
    replyText?: string;
    responseText?: string;
  }> {
    const payload = buildCreateGroupAiResponsePayload(input);
    const response = await fetch(groupAiResponseUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid groupchats-ai-response request completed.", {
      status: response.status,
      ok: response.ok,
      groupId: input.groupId,
      aiId: input.aiId,
      requestId: input.requestId
    });

    return {
      status: response.status,
      ok: response.ok,
      replyText: response.ok ? responseText : undefined,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async breakChat(input: BreakKindroidChatInput): Promise<BreakKindroidChatResult> {
    const payload = buildBreakChatPayload(input);
    const response = await fetch(chatBreakUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid chat-break request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      wipeCascaded: input.wipeCascaded === true,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async breakGroupChat(input: BreakKindroidGroupChatInput): Promise<BreakKindroidGroupChatResult> {
    const payload = buildBreakGroupChatPayload(input);
    const response = await fetch(groupChatBreakUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid groupchats-chat-break request completed.", {
      status: response.status,
      ok: response.ok,
      groupId: input.groupId,
      wipeCascaded: input.wipeCascaded === true,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async rewindMessages(input: RewindKindroidMessagesInput): Promise<RewindKindroidMessagesResult> {
    const payload = buildRewindMessagesPayload(input);
    const response = await fetch(rewindMessagesUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid rewind-messages request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      groupId: input.groupId,
      count: input.count,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async updateCurrentScene(input: UpdateKindroidCurrentSceneInput): Promise<UpdateKindroidCurrentSceneResult> {
    const payload = buildUpdateCurrentScenePayload(input);
    const response = await fetch(updateInfoUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid update-info request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      field: "current_scene",
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async updateGroupCurrentScene(
    input: UpdateKindroidGroupCurrentSceneInput
  ): Promise<UpdateKindroidGroupCurrentSceneResult> {
    const payload = buildUpdateGroupCurrentScenePayload(input);
    const response = await fetch(updateGroupChatUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid groupchats-update request completed.", {
      status: response.status,
      ok: response.ok,
      groupId: input.groupId,
      field: "current_scene",
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async updateGroupTurnTaking(input: UpdateKindroidGroupTurnTakingInput): Promise<UpdateKindroidGroupTurnTakingResult> {
    const payload = buildUpdateGroupTurnTakingPayload(input);
    const response = await fetch(updateGroupChatUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid groupchats-update request completed.", {
      status: response.status,
      ok: response.ok,
      groupId: input.groupId,
      field: "use_manual_turntaking",
      useManualTurntaking: input.useManualTurntaking,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async createJournalEntry(input: CreateKindroidJournalEntryInput): Promise<CreateKindroidJournalEntryResult> {
    const payload = buildCreateJournalEntryPayload(input);
    const response = await fetch(journalCreateUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid journal-create request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      keyphraseCount: payload.keyphrases instanceof Array ? payload.keyphrases.length : 0,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async deleteJournalEntry(input: DeleteKindroidJournalEntryInput): Promise<DeleteKindroidJournalEntryResult> {
    const payload = buildDeleteJournalEntryPayload(input);
    const response = await fetch(journalDeleteUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid journal-delete request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      journalEntryId: input.id,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async getChatMessages(input: GetKindroidChatMessagesInput): Promise<GetKindroidChatMessagesResult> {
    const url = new URL(getChatMessagesUrl);
    if (input.aiId && input.groupId) {
      throw new Error("Chat history request must specify either aiId or groupId, not both.");
    }
    if (!input.aiId && !input.groupId) {
      throw new Error("Chat history request requires an aiId or groupId.");
    }
    if (input.aiId) {
      url.searchParams.set("ai_id", input.aiId);
    }
    if (input.groupId) {
      url.searchParams.set("group_id", input.groupId);
    }
    url.searchParams.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 100))));
    if (typeof input.startAfterTimestamp === "number" && Number.isFinite(input.startAfterTimestamp)) {
      url.searchParams.set("start_after_timestamp", String(input.startAfterTimestamp));
    }

    const response = await fetch(url, {
      method: "GET",
      headers: await this.authHeaders()
    });
    const responseText = await response.text();
    this.logger.info("Kindroid get-chat-messages request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      groupId: input.groupId,
      startAfterTimestamp: input.startAfterTimestamp
    });

    if (!response.ok) {
      return {
        status: response.status,
        ok: false,
        messages: [],
        responseText: responseText.slice(0, 1000)
      };
    }

    const payload = JSON.parse(responseText) as {
      messages?: unknown;
      pagination?: GetKindroidChatMessagesResult["pagination"];
    };
    return {
      status: response.status,
      ok: true,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      pagination: payload.pagination
    };
  }

  async updateIdentity(input: UpdateKindroidIdentityInput): Promise<UpdateKindroidIdentityResult> {
    const payload = buildUpdateIdentityPayload(input);
    const response = await fetch(updateInfoUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid update-info request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      field: "identity_settings",
      backstoryLength: input.backstory.length,
      memoryLength: input.memory.length,
      exampleMessageLength: input.exampleMessage.length,
      directiveLength: input.directive.length,
      additionalContextLength: input.additionalContext.length,
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  async updateChatDynamism(input: UpdateKindroidChatDynamismInput): Promise<UpdateKindroidChatDynamismResult> {
    const payload = buildUpdateChatDynamismPayload(input);
    const response = await fetch(updateInfoUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    this.logger.info("Kindroid update-info request completed.", {
      status: response.status,
      ok: response.ok,
      aiId: input.aiId,
      field: "user_set_temperature",
      responseText: response.ok ? undefined : responseText.slice(0, 500)
    });

    return {
      status: response.status,
      ok: response.ok,
      responseText: response.ok ? undefined : responseText.slice(0, 1000)
    };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const apiKey = this.config.kindroid.apiKey?.trim();
    if (apiKey) {
      return this.requestHeaders(apiKey);
    }

    if (!this.fallbackAuthWarningLogged) {
      this.fallbackAuthWarningLogged = true;
      this.logger.warn(
        "Kindroid API key is not configured; falling back to saved Firebase browser auth for /v1 requests."
      );
    }

    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);
    return this.requestHeaders(auth.accessToken);
  }

  private requestHeaders(bearerToken: string): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "text/plain, application/json",
      authorization: `Bearer ${bearerToken}`
    };
  }
}
