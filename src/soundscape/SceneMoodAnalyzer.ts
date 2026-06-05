import { soundscapeStateForPreset, type SoundscapePresetId } from "./SoundscapePresets.js";
import { silentSoundscapeState, type SoundscapeState } from "./SoundscapeState.js";

export interface SceneMoodInput {
  enabled?: boolean;
  preset?: SoundscapePresetId;
  environment?: string;
  mood?: string;
  intensity?: number;
}

export function mapSceneMoodToSoundscape(input: SceneMoodInput): SoundscapeState {
  if (!input.enabled) {
    return { ...silentSoundscapeState };
  }

  if (input.preset) {
    const state = soundscapeStateForPreset(input.preset, { enabled: true, intensity: input.intensity });
    return {
      ...state,
      environment: input.environment?.trim() || state.environment,
      mood: input.mood?.trim() || state.mood
    };
  }

  const mood = input.mood?.trim().toLowerCase();
  if (mood === "tense" || mood === "uneasy") {
    return soundscapeStateForPreset("eerie_static", { enabled: true, intensity: input.intensity });
  }

  return soundscapeStateForPreset("calm_room", { enabled: true, intensity: input.intensity });
}
