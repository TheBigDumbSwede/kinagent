import type { AppConfig } from "../config/types.js";
import { ambientHermesMessageGuardrails, type AmbientContextTone } from "../kindroid/ambientContext.js";
import type { Logger } from "../util/logger.js";

export interface ScreenContextCaptureMetadata {
  mode: "screen";
  displayId?: string;
  displayName?: string;
  width: number;
  height: number;
  capturedAt: string;
}

export type ScreenContextDetailLevel = "brief" | "detailed" | "text-heavy";

export interface ScreenContextAnalysisRequest {
  kinId: string;
  kinName?: string | null;
  imageMimeType: "image/png";
  imageBase64: string;
  capture: ScreenContextCaptureMetadata;
  detailLevel: ScreenContextDetailLevel;
}

export interface ScreenContextAnalysisResult {
  ambientMessage: string;
  context: string;
  suggestedUse?: string;
  tone?: AmbientContextTone;
  sensitivityFlags: string[];
  summary?: string;
  visibleText?: string;
}

const screenContextAnalysisTimeoutMs = 45_000;

interface HermesChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface HermesChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } }
        >;
  }>;
  temperature: number;
}

export async function analyzeScreenContextWithHermes(
  config: AppConfig,
  logger: Logger,
  request: ScreenContextAnalysisRequest
): Promise<ScreenContextAnalysisResult> {
  if (!config.hermes.enabled) {
    throw new Error("Hermes is disabled.");
  }

  const endpoint = `${normalizeBaseUrl(config.hermes.baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), screenContextAnalysisTimeoutMs);

  logger.info("Starting Hermes screen context analysis.", {
    kinId: request.kinId,
    displayId: request.capture.displayId,
    width: request.capture.width,
    height: request.capture.height,
    detailLevel: request.detailLevel,
    imageBase64Length: request.imageBase64.length,
    timeoutMs: screenContextAnalysisTimeoutMs
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.hermes.apiKey ? { authorization: `Bearer ${config.hermes.apiKey}` } : {})
      },
      body: JSON.stringify(buildScreenContextChatRequest(config.hermes.agentId || "hermes-agent", request))
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Hermes screen context analysis timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  if (!response.ok) {
    logger.warn("Hermes screen context analysis failed.", {
      status: response.status,
      responseText: responseText.slice(0, 500)
    });
    throw new Error(`Hermes screen context analysis failed with HTTP ${response.status}.`);
  }

  let parsed: HermesChatCompletionResponse;
  try {
    parsed = JSON.parse(responseText) as HermesChatCompletionResponse;
  } catch {
    throw new Error("Hermes screen context response was not valid JSON.");
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Hermes screen context response did not include text content.");
  }

  return normalizeScreenContextAnalysis(content);
}

export function buildScreenContextChatRequest(
  model: string,
  request: ScreenContextAnalysisRequest
): HermesChatCompletionRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: screenContextSystemPrompt()
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              type: "kinagent.screen_context.analyze",
              kin: {
                ai_id: request.kinId,
                name: request.kinName || undefined
              },
              capture: request.capture,
              detail_level: request.detailLevel,
              instructions:
                "Analyze the attached screenshot image. Do not infer visual details if the image is unavailable or unreadable."
            })
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${request.imageMimeType};base64,${request.imageBase64}`,
              detail: "high"
            }
          }
        ]
      }
    ],
    temperature: 0.2
  };
}

export function normalizeScreenContextAnalysis(content: string): ScreenContextAnalysisResult {
  const parsed = parseHermesJson(content);
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const ambientMessage = stringField(record.ambient_message ?? record.ambientMessage).slice(0, 240);
  const context = stringField(record.context ?? record.analysis).slice(0, 6_000);
  const visibleText = optionalStringField(record.visible_text ?? record.visibleText, 8_000);

  if (!ambientMessage) {
    throw new Error("Hermes screen context analysis did not include an ambient message.");
  }
  if (!context) {
    throw new Error("Hermes screen context analysis did not include context.");
  }
  if (isNoVisualContentFallback(`${ambientMessage}\n${context}\n${stringField(record.summary)}`)) {
    throw new Error("Hermes could not inspect the screenshot image. The configured Hermes backend may be text-only.");
  }

  return {
    ambientMessage,
    context,
    suggestedUse: optionalStringField(record.suggested_use ?? record.suggestedUse, 1_000),
    tone: ambientToneField(record.tone),
    sensitivityFlags: stringArrayField(record.sensitivity_flags ?? record.sensitivityFlags, 12),
    summary: optionalStringField(record.summary, 1_000),
    visibleText
  };
}

function isNoVisualContentFallback(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("no reliable visual content") ||
    normalized.includes("no readable on-screen details") ||
    normalized.includes("captured data in this turn") ||
    normalized.includes("low-confidence ambient awareness only")
  );
}

function screenContextSystemPrompt(): string {
  return [
    "You analyze a user-triggered desktop screenshot for Kinagent.",
    "Return compact JSON only with keys: ambient_message, context, suggested_use, tone, sensitivity_flags, summary, visible_text.",
    "ambient_message is the short visible narrated beat that will appear in the Kin transcript.",
    "context is the hidden analysis that the Kin should receive through ambient context.",
    "If detail_level is brief, keep context to a short situational summary and include visible_text only for short, important text.",
    "If detail_level is detailed, include notable visual details and any important readable text in visible_text.",
    "If detail_level is text-heavy, transcribe meaningful readable on-screen text into visible_text as faithfully as possible, preserving line breaks when useful.",
    "Do not include raw OCR dumps unless directly useful. Summarize sensitive material cautiously.",
    "If the screenshot contains passwords, tokens, financial account numbers, medical details, or private communications, name that category in sensitivity_flags and avoid reproducing secrets.",
    "Never claim the screenshot should be stored or persisted.",
    ...ambientHermesMessageGuardrails.map((line) => `Ambient message guardrail: ${line}`)
  ].join("\n");
}

function parseHermesJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Hermes screen context analysis was not JSON.");
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(value: unknown, maxLength: number): string | undefined {
  const text = stringField(value);
  return text ? text.slice(0, maxLength) : undefined;
}

function stringArrayField(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      const text = stringField(item).slice(0, 80);
      return text ? [text] : [];
    })
    .slice(0, maxLength);
}

function ambientToneField(value: unknown): AmbientContextTone | undefined {
  return value === "neutral" ||
    value === "domestic" ||
    value === "storm" ||
    value === "sci-fi" ||
    value === "noir" ||
    value === "fantasy" ||
    value === "gothic"
    ? value
    : undefined;
}
