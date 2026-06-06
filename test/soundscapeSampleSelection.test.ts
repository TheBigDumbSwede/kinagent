import { describe, expect, it } from "vitest";
import type { ProceduralLayerDescriptor, SoundscapeState } from "../src/soundscape/SoundscapeState.js";
import {
  chooseSampleLoop,
  describeSoundscapeLayerSample,
  layerVoiceKey,
  playableLayerDescriptors,
  soundscapeLayerSummary
} from "../src/desktop/renderer/SoundscapeSampleSelection.js";

describe("soundscape sample selection", () => {
  it("uses coworker murmur for ordinary office room tone", () => {
    const state = sampleState({
      environment: "quiet office floor",
      layers: [layer("roomTone")]
    });

    expect(chooseSampleLoop(state, state.layers[0])).toMatchObject({
      path: "office_coworker_murmur_soft_01.mp3"
    });
    expect(soundscapeLayerSummary(state)).toBe("roomTone:office_coworker_murmur_soft_01");
  });

  it("suppresses static unless the scene explicitly calls for it", () => {
    const officeState = sampleState({
      environment: "office floor",
      layers: [layer("static")]
    });
    const radioState = sampleState({
      environment: "radio room with signal interference",
      layers: [layer("static")]
    });

    expect(playableLayerDescriptors(officeState)).toEqual([]);
    expect(describeSoundscapeLayerSample(officeState, officeState.layers[0])).toBe("muted");
    expect(chooseSampleLoop(radioState, radioState.layers[0])).toMatchObject({
      path: "radio_static_soft_01.mp3"
    });
  });

  it("uses vehicle-specific loops before generic room tone", () => {
    const rainyDrive = sampleState({
      environment: "rainy car drive with windshield wipers",
      layers: [layer("roomTone")]
    });
    const elevator = sampleState({
      environment: "elevator car",
      layers: [layer("roomTone")]
    });

    expect(chooseSampleLoop(rainyDrive, rainyDrive.layers[0])).toMatchObject({
      path: "car_interior_rain_drive_01.mp3"
    });
    expect(chooseSampleLoop(elevator, elevator.layers[0])).toMatchObject({
      path: "elevator_car_idle_01.mp3"
    });
  });

  it("keys active voices by selected sample, not just layer type", () => {
    const office = sampleState({
      environment: "office floor",
      layers: [layer("roomTone")]
    });
    const cafe = sampleState({
      environment: "small cafe",
      layers: [layer("roomTone")]
    });

    expect(layerVoiceKey(office, office.layers[0])).toBe("roomTone:office_coworker_murmur_soft_01.mp3");
    expect(layerVoiceKey(cafe, cafe.layers[0])).toBe("roomTone:cafe_murmur_indistinct_soft_01.mp3");
  });
});

function sampleState(overrides: Partial<SoundscapeState>): SoundscapeState {
  return {
    enabled: true,
    environment: "room",
    mood: "neutral",
    intensity: 0.5,
    transition: "fade",
    layers: [],
    ...overrides
  };
}

function layer(type: ProceduralLayerDescriptor["type"], volume = 0.5): ProceduralLayerDescriptor {
  return { type, volume };
}
