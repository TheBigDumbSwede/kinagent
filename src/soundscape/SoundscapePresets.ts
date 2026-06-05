import { normalizeSoundscapeState } from "./ProceduralLayers.js";
import type { SoundscapeState } from "./SoundscapeState.js";

export type SoundscapePresetId = "rainy_room" | "windy_night" | "spaceship_idle" | "eerie_static" | "calm_room";

export const soundscapePresetIds: SoundscapePresetId[] = [
  "rainy_room",
  "windy_night",
  "spaceship_idle",
  "eerie_static",
  "calm_room"
];

export const soundscapePresets: Record<SoundscapePresetId, SoundscapeState> = {
  rainy_room: {
    enabled: true,
    environment: "rainy_room",
    mood: "melancholy",
    intensity: 0.3,
    transition: "fade",
    layers: [
      { type: "rain", volume: 0.38, density: 0.72, warmth: 0.34, movement: 0.42 },
      { type: "roomTone", volume: 0.18, density: 0.42, warmth: 0.68 },
      { type: "lowDrone", volume: 0.09, pitch: 82, warmth: 0.72, movement: 0.16 }
    ]
  },
  windy_night: {
    enabled: true,
    environment: "windy_night",
    mood: "uneasy",
    intensity: 0.4,
    transition: "fade",
    layers: [
      { type: "wind", volume: 0.34, density: 0.58, warmth: 0.28, movement: 0.76 },
      { type: "roomTone", volume: 0.15, density: 0.38, warmth: 0.52 },
      { type: "lowDrone", volume: 0.12, pitch: 73, warmth: 0.36, movement: 0.24 }
    ]
  },
  spaceship_idle: {
    enabled: true,
    environment: "spaceship_idle",
    mood: "calm",
    intensity: 0.35,
    transition: "fade",
    layers: [
      { type: "hum", volume: 0.28, pitch: 58, warmth: 0.48, movement: 0.28 },
      { type: "lowDrone", volume: 0.13, pitch: 46, warmth: 0.34, movement: 0.18 },
      { type: "static", volume: 0.08, density: 0.22, warmth: 0.24, movement: 0.18 }
    ]
  },
  eerie_static: {
    enabled: true,
    environment: "eerie_static",
    mood: "tense",
    intensity: 0.5,
    transition: "swell",
    layers: [
      { type: "static", volume: 0.22, density: 0.62, warmth: 0.16, movement: 0.36 },
      { type: "lowDrone", volume: 0.16, pitch: 55, warmth: 0.22, movement: 0.22 },
      { type: "tensionPulse", volume: 0.13, pitch: 98, density: 0.42, warmth: 0.22, movement: 0.52 }
    ]
  },
  calm_room: {
    enabled: true,
    environment: "calm_room",
    mood: "calm",
    intensity: 0.2,
    transition: "fade",
    layers: [
      { type: "roomTone", volume: 0.16, density: 0.32, warmth: 0.7 },
      { type: "lowDrone", volume: 0.055, pitch: 74, warmth: 0.76, movement: 0.1 }
    ]
  }
};

export function soundscapeStateForPreset(
  presetId: SoundscapePresetId,
  options: { enabled?: boolean; intensity?: number } = {}
): SoundscapeState {
  const preset = soundscapePresets[presetId];
  return normalizeSoundscapeState({
    ...preset,
    enabled: options.enabled ?? preset.enabled,
    intensity: options.intensity ?? preset.intensity,
    layers: preset.layers.map((layer) => ({ ...layer }))
  });
}

export function isSoundscapePresetId(value: unknown): value is SoundscapePresetId {
  return typeof value === "string" && soundscapePresetIds.includes(value as SoundscapePresetId);
}
