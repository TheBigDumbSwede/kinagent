import type { SoundscapePaletteItem } from "./palette.js";

export interface ElevenLabsGenerationRequest {
  apiKey: string;
  item: SoundscapePaletteItem;
  model: string;
  outputFormat: string;
}

export interface ElevenLabsGenerationResult {
  bytes: Buffer;
  contentType: string | null;
  characterCost?: string | null;
}

const elevenLabsSoundGenerationUrl = "https://api.elevenlabs.io/v1/sound-generation";

export async function generateElevenLabsSound(
  request: ElevenLabsGenerationRequest
): Promise<ElevenLabsGenerationResult> {
  const url = new URL(elevenLabsSoundGenerationUrl);
  url.searchParams.set("output_format", request.outputFormat);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": request.apiKey
    },
    body: JSON.stringify({
      text: request.item.prompt,
      loop: request.item.loop,
      duration_seconds: request.item.durationSeconds,
      prompt_influence: 0.3,
      model_id: request.model
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ElevenLabs sound generation failed with HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    characterCost: response.headers.get("character-cost")
  };
}
