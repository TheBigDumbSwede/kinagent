import { describe, expect, it } from "vitest";
import { diffLayers, normalizeSoundscapeState } from "../src/soundscape/ProceduralLayers.js";
import { mapSceneMoodToSoundscape } from "../src/soundscape/SceneMoodAnalyzer.js";
import { soundscapePresetIds, soundscapeStateForPreset } from "../src/soundscape/SoundscapePresets.js";

describe("soundscape presets", () => {
  it("defines the expected procedural presets", () => {
    expect(soundscapePresetIds).toEqual(["rainy_room", "windy_night", "spaceship_idle", "eerie_static", "calm_room"]);

    expect(soundscapeStateForPreset("spaceship_idle")).toMatchObject({
      enabled: true,
      environment: "spaceship_idle",
      mood: "calm",
      intensity: 0.35
    });
    expect(soundscapeStateForPreset("spaceship_idle").layers.map((layer) => layer.type)).toEqual([
      "hum",
      "lowDrone",
      "static"
    ]);
  });

  it("clamps state intensity and layer controls", () => {
    const normalized = normalizeSoundscapeState({
      enabled: true,
      environment: "",
      mood: "",
      intensity: 2,
      transition: "fade",
      layers: [{ type: "static", volume: 4, density: -1, warmth: 3, movement: 0.4 }]
    });

    expect(normalized).toMatchObject({
      environment: "unspecified",
      mood: "neutral",
      intensity: 1,
      layers: [{ volume: 1, density: 0, warmth: 1, movement: 0.4 }]
    });
  });
});

describe("scene mood mapper", () => {
  it("returns silence when disabled", () => {
    expect(mapSceneMoodToSoundscape({ enabled: false, preset: "rainy_room" })).toEqual({
      enabled: false,
      environment: "none",
      mood: "neutral",
      intensity: 0,
      transition: "drop_to_silence",
      layers: []
    });
  });

  it("uses deterministic fallback presets for simple moods", () => {
    expect(mapSceneMoodToSoundscape({ enabled: true, mood: "tense" }).environment).toBe("eerie_static");
    expect(mapSceneMoodToSoundscape({ enabled: true, mood: "calm" }).environment).toBe("calm_room");
  });
});

describe("layer diffing", () => {
  it("classifies added, updated, removed, and unchanged layers by type", () => {
    const diff = diffLayers(
      [
        { type: "rain", volume: 0.2 },
        { type: "roomTone", volume: 0.1 },
        { type: "static", volume: 0.1 }
      ],
      [
        { type: "rain", volume: 0.4 },
        { type: "roomTone", volume: 0.1 },
        { type: "lowDrone", volume: 0.05 }
      ]
    );

    expect(diff.added.map((layer) => layer.type)).toEqual(["lowDrone"]);
    expect(diff.updated.map((layer) => layer.type)).toEqual(["rain"]);
    expect(diff.removed.map((layer) => layer.type)).toEqual(["static"]);
    expect(diff.unchanged.map((layer) => layer.type)).toEqual(["roomTone"]);
  });
});
