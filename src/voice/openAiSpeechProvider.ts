import type { AppConfig } from "../config/types.js";
import type { VoiceProviderClient, VoiceSynthesisResult } from "./types.js";

const speechUrl = "https://api.openai.com/v1/audio/speech";

export class OpenAiSpeechProvider implements VoiceProviderClient {
  readonly provider = "openai" as const;

  constructor(private readonly config: AppConfig["voice"]["openai"]) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async synthesize(
    text: string,
    options: { voice?: string; instructions?: string } = {}
  ): Promise<VoiceSynthesisResult> {
    if (!this.config.apiKey) {
      throw new Error("OpenAI speech is not configured. Set OPENAI_API_KEY or KINAGENT_OPENAI_API_KEY.");
    }

    const voice = options.voice || this.config.voice;
    const instructions = options.instructions ?? this.config.instructions;
    const response = await fetch(speechUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        voice,
        input: text,
        format: "mp3",
        ...(instructions ? { instructions } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI speech request failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    return {
      audio: await response.arrayBuffer(),
      format: "mp3",
      provider: this.provider,
      model: this.config.model,
      voice
    };
  }
}
