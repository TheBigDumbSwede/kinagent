import type { VoiceProvider } from "../config/types.js";

export type VoiceAudioFormat = "mp3";

export interface VoiceSynthesisResult {
  audio: ArrayBuffer;
  format: VoiceAudioFormat;
  provider: VoiceProvider;
  model: string;
  voice: string;
}

export interface VoiceProviderClient {
  readonly provider: VoiceProvider;
  isConfigured(): boolean;
  synthesize(text: string, options?: { voice?: string; instructions?: string }): Promise<VoiceSynthesisResult>;
}

export interface VoicePlaybackChunk {
  turnId: string;
  sequence?: number;
  boundaryGapMs?: number;
  provider: VoiceProvider;
  format: VoiceAudioFormat;
  audio: ArrayBuffer;
  speakerLabel?: string;
  kinId?: string;
  groupId?: string;
}

export interface VoiceMessageInput {
  id: string;
  kinId: string;
  kinName?: string;
  groupId?: string;
  groupName?: string;
  sender?: string | null;
  role?: string | null;
  text?: string | null;
  textEncrypted?: boolean;
  textDecrypted?: boolean;
  textDecryptionError?: string;
}
