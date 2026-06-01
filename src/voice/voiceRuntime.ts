import type { AppConfig, VoiceProvider } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import { ElevenLabsSpeechProvider } from "./elevenLabsSpeechProvider.js";
import { OpenAiSpeechProvider } from "./openAiSpeechProvider.js";
import { splitSpeechIntoParagraphChunks, stripKindroidNarrationForSpeech } from "./speechText.js";
import type { VoiceMessageInput, VoicePlaybackChunk, VoiceProviderClient } from "./types.js";
import {
  loadKinVoicePreference,
  type KinVoicePreference,
  type KinVoiceProvider,
  voiceProvidersConfigured
} from "./voicePreferences.js";

export interface VoiceRuntimeOptions {
  config: AppConfig;
  logger: Logger;
  desktopPlayback?: (chunk: VoicePlaybackChunk) => void;
}

const maxSeenMessageIds = 1_000;
const maxSpokenTextLength = 4_000;
const paragraphBoundaryGapMs = 120;

export class VoiceRuntime {
  private readonly providers: Record<KinVoiceProvider, VoiceProviderClient>;
  private readonly seenMessageIds: string[] = [];
  private readonly seenMessageIdSet = new Set<string>();
  private queue = Promise.resolve();

  constructor(private readonly options: VoiceRuntimeOptions) {
    this.providers = {
      openai: new OpenAiSpeechProvider(options.config.voice.openai),
      elevenlabs: new ElevenLabsSpeechProvider(options.config.voice.elevenlabs)
    };
  }

  enabled(): boolean {
    return Boolean(this.options.config.voice.enabled && this.options.desktopPlayback);
  }

  enqueue(message: VoiceMessageInput): void {
    const preference = this.resolveSpeakPreference(message);
    if (!preference) {
      return;
    }

    this.rememberMessage(message.id);
    const queuedAt = Date.now();
    this.queue = this.queue
      .then(() => this.speak(message, preference, queuedAt))
      .catch((error: unknown) => {
        this.options.logger.warn("Voice sidecar playback failed.", {
          provider: preference.provider,
          kinId: message.kinId,
          groupId: message.groupId,
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  async idle(): Promise<void> {
    await this.queue;
  }

  private async speak(message: VoiceMessageInput, preference: KinVoicePreference, queuedAt: number): Promise<void> {
    const provider = this.providers[preference.provider];
    if (!provider || !this.options.desktopPlayback || !message.text) {
      return;
    }

    const text = stripKindroidNarrationForSpeech(message.text, {
      enabled: preference.filterNarrationForTts,
      delimiter: preference.narrationDelimiter
    })
      .slice(0, maxSpokenTextLength)
      .trim();
    const chunks = splitSpeechIntoParagraphChunks(text);
    if (chunks.length === 0) {
      return;
    }

    this.options.logger.info("Synthesizing voice sidecar audio.", {
      provider: provider.provider,
      kinId: message.kinId,
      groupId: message.groupId,
      messageId: message.id,
      originalTextLength: message.text.length,
      textLength: text.length,
      chunks: chunks.length,
      queueDelayMs: Date.now() - queuedAt
    });
    for (const [sequence, chunk] of chunks.entries()) {
      const startedAt = Date.now();
      const result = await provider.synthesize(chunk, {
        voice: voiceForProvider(preference),
        instructions: preference.provider === "openai" ? preference.openaiInstructions : undefined
      });
      this.options.logger.info("Voice sidecar audio synthesized.", {
        provider: result.provider,
        kinId: message.kinId,
        groupId: message.groupId,
        messageId: message.id,
        sequence,
        chunks: chunks.length,
        model: result.model,
        voice: result.voice,
        textLength: chunk.length,
        audioBytes: result.audio.byteLength,
        durationMs: Date.now() - startedAt
      });
      this.options.desktopPlayback({
        turnId: `${message.groupId ?? message.kinId}:${message.id}`,
        sequence,
        boundaryGapMs: sequence === 0 ? 0 : paragraphBoundaryGapMs,
        provider: result.provider,
        format: result.format,
        audio: result.audio,
        speakerLabel: message.kinName,
        kinId: message.kinId,
        groupId: message.groupId
      });
    }
  }

  private resolveSpeakPreference(message: VoiceMessageInput): KinVoicePreference | null {
    if (!this.enabled() || !message.id || this.seenMessageIdSet.has(message.id)) {
      return null;
    }

    if (!message.text?.trim() || message.textDecryptionError || message.textDecrypted === false) {
      return null;
    }

    if (!isAssistantMessage(message)) {
      return null;
    }

    const preference = loadKinVoicePreference(this.options.config, message.kinId);
    if (!preference.enabled) {
      return null;
    }

    const provider = this.providers[preference.provider];
    if (!provider.isConfigured()) {
      return null;
    }

    if (preference.provider === "elevenlabs" && !preference.elevenLabsVoiceId) {
      return null;
    }

    return preference;
  }

  private rememberMessage(messageId: string): void {
    this.seenMessageIds.push(messageId);
    this.seenMessageIdSet.add(messageId);

    while (this.seenMessageIds.length > maxSeenMessageIds) {
      const removed = this.seenMessageIds.shift();
      if (removed) {
        this.seenMessageIdSet.delete(removed);
      }
    }
  }
}

function voiceForProvider(preference: KinVoicePreference): string {
  return preference.provider === "elevenlabs" ? preference.elevenLabsVoiceId : preference.openaiVoice;
}

function isAssistantMessage(message: VoiceMessageInput): boolean {
  const sender = normalized(message.sender);
  const role = normalized(message.role);
  return sender === "ai" || sender === "assistant" || role === "ai" || role === "assistant";
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function voiceProviderConfigured(config: AppConfig): {
  enabled: boolean;
  provider: VoiceProvider;
  configured: boolean;
  providers: Record<KinVoiceProvider, boolean>;
} {
  const providers = voiceProvidersConfigured(config);
  return {
    enabled: config.voice.enabled,
    provider: config.voice.provider,
    configured:
      config.voice.provider === "none" ? providers.openai || providers.elevenlabs : providers[config.voice.provider],
    providers
  };
}
