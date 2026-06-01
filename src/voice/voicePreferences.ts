import fs from "node:fs";
import path from "node:path";
import type { AppConfig, VoiceProvider } from "../config/types.js";

export type KinVoiceProvider = Exclude<VoiceProvider, "none">;

export interface KinVoicePreference {
  enabled: boolean;
  provider: KinVoiceProvider;
  openaiVoice: string;
  openaiInstructions: string;
  elevenLabsVoiceId: string;
  filterNarrationForTts: boolean;
  narrationDelimiter: string;
}

interface VoicePreferencesFile {
  kins?: Record<string, Partial<KinVoicePreference>>;
}

export const openAiVoiceOptions = [
  "marin",
  "cedar",
  "coral",
  "verse",
  "ballad",
  "ash",
  "sage",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer"
] as const;

export function voicePreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "voice-preferences.json");
}

export function loadKinVoicePreference(config: AppConfig, kinId: string): KinVoicePreference {
  const file = readVoicePreferences(config);
  return normalizeKinVoicePreference(file.kins?.[kinId], config);
}

export function saveKinVoicePreference(
  config: AppConfig,
  kinId: string,
  preference: Partial<KinVoicePreference>
): KinVoicePreference {
  if (!kinId.trim()) {
    throw new Error("Kin id is required.");
  }

  const file = readVoicePreferences(config);
  const normalized = normalizeKinVoicePreference(preference, config);
  const next: VoicePreferencesFile = {
    ...file,
    kins: {
      ...(file.kins ?? {}),
      [kinId]: normalized
    }
  };

  writeVoicePreferences(config, next);
  return normalized;
}

export function voiceProvidersConfigured(config: AppConfig): Record<KinVoiceProvider, boolean> {
  return {
    openai: Boolean(config.voice.openai.apiKey),
    elevenlabs: Boolean(config.voice.elevenlabs.apiKey)
  };
}

function readVoicePreferences(config: AppConfig): VoicePreferencesFile {
  const preferencePath = voicePreferencesPath(config);
  if (!fs.existsSync(preferencePath)) {
    return { kins: {} };
  }

  const raw = fs.readFileSync(preferencePath, "utf8");
  const parsed = JSON.parse(raw) as VoicePreferencesFile;
  return parsed && typeof parsed === "object" ? parsed : { kins: {} };
}

function writeVoicePreferences(config: AppConfig, preferences: VoicePreferencesFile): void {
  const preferencePath = voicePreferencesPath(config);
  fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
  fs.writeFileSync(preferencePath, `${JSON.stringify(preferences, null, 2)}\n`);
}

function normalizeKinVoicePreference(
  preference: Partial<KinVoicePreference> | undefined,
  config: AppConfig
): KinVoicePreference {
  const provider = normalizeProvider(preference?.provider);
  return {
    enabled: Boolean(preference?.enabled),
    provider,
    openaiVoice: normalizeText(preference?.openaiVoice) || config.voice.openai.voice || "marin",
    openaiInstructions:
      normalizeText(preference?.openaiInstructions) || normalizeText(config.voice.openai.instructions),
    elevenLabsVoiceId: normalizeText(preference?.elevenLabsVoiceId),
    filterNarrationForTts: preference?.filterNarrationForTts ?? true,
    narrationDelimiter: normalizeText(preference?.narrationDelimiter) || "*"
  };
}

function normalizeProvider(value: unknown): KinVoiceProvider {
  return value === "elevenlabs" ? "elevenlabs" : "openai";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
