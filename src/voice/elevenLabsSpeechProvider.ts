import type { AppConfig } from "../config/types.js";
import type { VoiceProviderClient, VoiceSynthesisResult } from "./types.js";

const elevenLabsApiBase = "https://api.elevenlabs.io/v1";

export class ElevenLabsSpeechProvider implements VoiceProviderClient {
  readonly provider = "elevenlabs" as const;

  constructor(private readonly config: AppConfig["voice"]["elevenlabs"]) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async synthesize(text: string, options: { voice?: string } = {}): Promise<VoiceSynthesisResult> {
    if (!this.config.apiKey) {
      throw new Error("ElevenLabs speech is not configured. Set ELEVENLABS_API_KEY.");
    }

    if (!options.voice?.trim()) {
      throw new Error("ElevenLabs speech requires a per-Kin voice ID.");
    }

    const voiceId = options.voice.trim();
    const response = await fetch(
      `${elevenLabsApiBase}/text-to-speech/${voiceId}?output_format=${encodeURIComponent(this.config.outputFormat)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.config.apiKey
        },
        body: JSON.stringify({
          text,
          model_id: this.config.model
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs synthesis failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    return {
      audio: await response.arrayBuffer(),
      format: "mp3",
      provider: this.provider,
      model: this.config.model,
      voice: voiceId
    };
  }
}
