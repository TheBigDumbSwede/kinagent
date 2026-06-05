export type SoundscapeTransition = "hold" | "fade" | "swell" | "drop_to_silence";

export type ProceduralLayerType = "rain" | "wind" | "roomTone" | "lowDrone" | "hum" | "tensionPulse" | "static";

export interface ProceduralLayerDescriptor {
  type: ProceduralLayerType;
  volume: number;
  density?: number;
  pitch?: number | string;
  warmth?: number;
  movement?: number;
}

export interface SoundscapeState {
  enabled: boolean;
  environment: string;
  mood: string;
  intensity: number;
  transition: SoundscapeTransition;
  layers: ProceduralLayerDescriptor[];
}

export const silentSoundscapeState: SoundscapeState = {
  enabled: false,
  environment: "none",
  mood: "neutral",
  intensity: 0,
  transition: "drop_to_silence",
  layers: []
};
