import type { AppConfig } from "../config/types.js";
import { loadFreshFirebaseAuth } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import type {
  SendKindroidMessageInput,
  SendKindroidMessageResult,
  UpdateKindroidCurrentSceneInput,
  UpdateKindroidCurrentSceneResult,
  UpdateKindroidGroupCurrentSceneInput,
  UpdateKindroidGroupCurrentSceneResult
} from "./types.js";
import {
  buildSendMessagePayload,
  buildUpdateCurrentScenePayload,
  buildUpdateGroupCurrentScenePayload
} from "./payloads.js";

const sendMessageUrl = "https://api.kindroid.ai/v1/send-message";
const updateInfoUrl = "https://api.kindroid.ai/v1/update-info";
const updateGroupChatUrl = "https://api.kindroid.ai/v1/groupchats-update";

export class KindroidClient {
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

  private async authHeaders(): Promise<Record<string, string>> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);

    return {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${auth.accessToken}`
    };
  }
}
