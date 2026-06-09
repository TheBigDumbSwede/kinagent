import type { AppConfig } from "../config/types.js";
import type { GroupBackgroundSuggestion } from "./groupBackgroundSuggestionStore.js";

const imageGenerationUrl = "https://api.openai.com/v1/images/generations";

export interface GeneratedGroupBackgroundImage {
  image: Buffer;
  mimeType: string;
  model: string;
  size: string;
}

interface OpenAiImageGenerationResponse {
  data?: Array<{
    b64_json?: string;
  }>;
}

export class OpenAiGroupBackgroundImageProvider {
  constructor(private readonly config: AppConfig["hermes"]["groupBackgrounds"]["images"]["openai"]) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generate(suggestion: GroupBackgroundSuggestion): Promise<GeneratedGroupBackgroundImage> {
    if (!this.config.apiKey) {
      throw new Error(
        "OpenAI image generation is not configured. Set KINAGENT_OPENAI_IMAGE_API_KEY or OPENAI_API_KEY."
      );
    }

    const prompt = imagePromptForSuggestion(suggestion);
    const response = await fetch(imageGenerationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt,
        n: 1,
        size: this.config.size,
        quality: this.config.quality
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI image generation failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const parsed = (await response.json()) as OpenAiImageGenerationResponse;
    const base64 = parsed.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("OpenAI image generation returned no image data.");
    }

    return {
      image: Buffer.from(base64, "base64"),
      mimeType: "image/png",
      model: this.config.model,
      size: this.config.size
    };
  }
}

function imagePromptForSuggestion(suggestion: GroupBackgroundSuggestion): string {
  const parts = [
    suggestion.prompt,
    suggestion.visualStyle ? `Visual style: ${suggestion.visualStyle}` : "",
    "Composition: chat background image, wide environmental scene, useful behind translucent chat text.",
    "Do not include text, logos, UI elements, portraits, close-up faces, or foreground characters.",
    suggestion.negativePrompt ? `Avoid: ${suggestion.negativePrompt}` : ""
  ];

  return parts.filter(Boolean).join("\n\n");
}
