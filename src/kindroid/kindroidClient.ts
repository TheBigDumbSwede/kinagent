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

const sendMessageUrl = "https://api.kindroid.ai/v1/send-message";
const updateInfoUrl = "https://api.kindroid.ai/v1/update-info";
const updateGroupChatUrl = "https://api.kindroid.ai/v1/groupchats-update";
const currentSceneMaxLengthLimit = 160;

export class KindroidClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async sendMessage(input: SendKindroidMessageInput): Promise<SendKindroidMessageResult> {
    const response = await fetch(sendMessageUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({
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
      })
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
    if (!input.aiId) {
      throw new Error("Missing Kindroid ai_id for current scene update.");
    }
    const currentScene = validateCurrentScene(input.currentScene);

    const response = await fetch(updateInfoUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({
        ai_id: input.aiId,
        current_scene: currentScene
      })
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
    if (!input.groupId) {
      throw new Error("Missing Kindroid group_id for current scene update.");
    }
    const currentScene = validateCurrentScene(input.currentScene);

    const response = await fetch(updateGroupChatUrl, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({
        group_id: input.groupId,
        current_scene: currentScene
      })
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

function validateCurrentScene(value: string): string {
  const currentScene = value.trim();
  if (!currentScene) {
    throw new Error("Current scene cannot be empty.");
  }
  if (currentScene.length > currentSceneMaxLengthLimit) {
    throw new Error(`Current scene cannot exceed ${currentSceneMaxLengthLimit} characters.`);
  }

  return currentScene;
}
