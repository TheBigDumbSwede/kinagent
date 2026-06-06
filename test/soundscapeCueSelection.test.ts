import { describe, expect, it } from "vitest";
import type { ProceduralLayerDescriptor, SoundscapeState } from "../src/soundscape/SoundscapeState.js";
import {
  cuePlansForState,
  cueSceneKey,
  SoundscapeCueScheduler
} from "../src/desktop/renderer/SoundscapeCueSelection.js";

describe("soundscape cue selection", () => {
  it("keeps scene identity stable across intensity-only changes", () => {
    const calmOffice = sampleState({
      environment: "quiet office floor",
      intensity: 0.2,
      layers: [layer("roomTone")]
    });
    const louderOffice = sampleState({
      environment: "quiet office floor",
      intensity: 0.8,
      layers: [layer("roomTone")]
    });
    const cafe = sampleState({
      environment: "small cafe",
      intensity: 0.2,
      layers: [layer("roomTone")]
    });

    expect(cueSceneKey(calmOffice)).toBe(cueSceneKey(louderOffice));
    expect(cueSceneKey(calmOffice)).not.toBe(cueSceneKey(cafe));
  });

  it("builds conservative cue plans for common scenes", () => {
    const officePlans = cuePlansForState(
      sampleState({
        environment: "quiet office floor",
        layers: [layer("roomTone")]
      })
    );
    const radioPlans = cuePlansForState(
      sampleState({
        environment: "radio room with signal interference",
        layers: [layer("static")]
      })
    );

    expect(officePlans.map((plan) => plan.family)).toEqual(
      expect.arrayContaining(["office_paper", "office_footsteps", "office_phone_distant"])
    );
    expect(officePlans.map((plan) => plan.family)).not.toContain("radio_static_burst");
    expect(radioPlans.map((plan) => plan.family)).toContain("radio_static_burst");
  });

  it("fires at most one cue per eligibility window and reopens later", () => {
    const state = sampleState({
      environment: "quiet office floor",
      layers: [layer("roomTone")]
    });
    const scheduler = new SoundscapeCueScheduler();
    const random = () => 0;

    scheduler.syncScene(state, 1_000, random);

    expect(scheduler.consumeDueCue(state, 6_999, random)).toBeNull();
    expect(scheduler.consumeDueCue(state, 7_000, random)).toMatchObject({
      family: "office_paper",
      path: "paper_rustle_soft_01_v1.mp3"
    });
    expect(scheduler.consumeDueCue(state, 7_001, random)).toBeNull();
    expect(scheduler.consumeDueCue(state, 127_000, random)).toMatchObject({
      family: "office_footsteps"
    });
  });

  it("resets cue eligibility when the scene changes", () => {
    const office = sampleState({
      environment: "quiet office floor",
      layers: [layer("roomTone")]
    });
    const cafe = sampleState({
      environment: "small cafe",
      layers: [layer("roomTone")]
    });
    const scheduler = new SoundscapeCueScheduler();
    const random = () => 0;

    scheduler.syncScene(office, 1_000, random);
    expect(scheduler.consumeDueCue(office, 7_000, random)).toMatchObject({
      family: "office_paper"
    });
    expect(scheduler.syncScene(cafe, 8_000, random)).toBe(true);
    expect(scheduler.consumeDueCue(cafe, 14_000, random)).toMatchObject({
      family: "cafe_cup"
    });
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
