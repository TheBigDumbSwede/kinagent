import type { AppConfig } from "../config/types.js";
import { buildCookieHeader, loadBrowserSession } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import type { SendKindroidMessageInput, SendKindroidMessageResult } from "./types.js";

const sendMessageUrl = "https://api.kindroid.ai/v1/send-message";

export class KindroidClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async sendMessage(input: SendKindroidMessageInput): Promise<SendKindroidMessageResult> {
    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const cookieHeader = buildCookieHeader(session.storageState, "api.kindroid.ai");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept": "application/json"
    };

    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    if (session.firebaseAuth?.accessToken) {
      headers.authorization = `Bearer ${session.firebaseAuth.accessToken}`;
    }

    const response = await fetch(sendMessageUrl, {
      method: "POST",
      headers,
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
}
