import type { SoundscapeState } from "../../soundscape/SoundscapeState.js";
import { layerVoiceKey, playableLayerDescriptors } from "./SoundscapeSampleSelection.js";

export interface SoundscapeCuePlan {
  family: string;
  candidates: string[];
  probability: number;
  gain: number;
  cooldownMs: number;
}

export interface SoundscapeCueChoice {
  family: string;
  path: string;
  gain: number;
}

export interface SoundscapeCueSchedulerSnapshot {
  sceneKey: string | null;
  nextAmbientCueAt: number | null;
}

const initialCueDelayMinMs = 6_000;
const initialCueDelayFuzzMs = 8_000;
const ambientCueDelayMinMs = 120_000;
const ambientCueDelayFuzzMs = 60_000;

export class SoundscapeCueScheduler {
  private sceneKey: string | null = null;
  private firedFamilies = new Set<string>();
  private cooldownUntil = new Map<string, number>();
  private nextAmbientCueAt: number | null = null;

  syncScene(state: SoundscapeState, nowMs: number, random = Math.random): boolean {
    const nextSceneKey = cueSceneKey(state);
    if (nextSceneKey === this.sceneKey) {
      return false;
    }

    this.sceneKey = nextSceneKey;
    this.firedFamilies.clear();
    this.nextAmbientCueAt = nowMs + jitter(initialCueDelayMinMs, initialCueDelayFuzzMs, random);
    return true;
  }

  reset(): void {
    this.sceneKey = null;
    this.firedFamilies.clear();
    this.cooldownUntil.clear();
    this.nextAmbientCueAt = null;
  }

  consumeDueCue(state: SoundscapeState, nowMs: number, random = Math.random): SoundscapeCueChoice | null {
    this.syncScene(state, nowMs, random);
    if (this.nextAmbientCueAt === null || nowMs < this.nextAmbientCueAt) {
      return null;
    }

    this.firedFamilies.clear();
    const cue = chooseSoundscapeCue(state, {
      nowMs,
      firedFamilies: this.firedFamilies,
      cooldownUntil: this.cooldownUntil,
      random
    });
    this.nextAmbientCueAt = nowMs + jitter(ambientCueDelayMinMs, ambientCueDelayFuzzMs, random);
    if (cue) {
      this.firedFamilies.add(cue.family);
      this.cooldownUntil.set(cue.family, nowMs + cueCooldownMs(state, cue.family));
    }
    return cue;
  }

  snapshot(): SoundscapeCueSchedulerSnapshot {
    return {
      sceneKey: this.sceneKey,
      nextAmbientCueAt: this.nextAmbientCueAt
    };
  }
}

export function cueSceneKey(state: SoundscapeState): string {
  const layers = playableLayerDescriptors(state)
    .map((layer) => layerVoiceKey(state, layer))
    .sort()
    .join(",");
  return [normalizeSceneText(state.environment), normalizeSceneText(state.mood), layers].join("|");
}

export function cuePlansForState(state: SoundscapeState): SoundscapeCuePlan[] {
  const combined = `${state.environment} ${state.mood}`.toLowerCase();
  const plans: SoundscapeCuePlan[] = [];

  if (/\b(office|workplace|corporate|cubicle|conference room|meeting room|desk|reception)\b/.test(combined)) {
    plans.push(
      cuePlan("office_paper", ["paper_rustle_soft_01_v1.mp3", "paper_rustle_soft_01_v2.mp3"], 0.2, 0.42, 180_000),
      cuePlan(
        "office_footsteps",
        ["office_footsteps_passing_soft_01_v1.mp3", "office_footsteps_passing_soft_01_v2.mp3"],
        0.16,
        0.38,
        180_000
      ),
      cuePlan(
        "office_murmur_passby",
        ["office_murmur_passby_soft_01_v1.mp3", "office_murmur_passby_soft_01_v2.mp3"],
        0.1,
        0.34,
        240_000
      ),
      cuePlan(
        "office_phone_distant",
        ["office_phone_ring_distant_01_v1.mp3", "office_phone_ring_distant_01_v2.mp3"],
        0.05,
        0.32,
        420_000
      )
    );
  }

  if (/\b(cafe|restaurant|coffee|diner)\b/.test(combined)) {
    plans.push(
      cuePlan(
        "cafe_cup",
        ["cup_clink_soft_01_v1.mp3", "cup_clink_soft_01_v2.mp3", "cup_clink_soft_01_v3.mp3"],
        0.18,
        0.38,
        180_000
      ),
      cuePlan("cafe_glass", ["glass_set_down_soft_01_v1.mp3", "glass_set_down_soft_01_v2.mp3"], 0.1, 0.34, 240_000),
      cuePlan("chair_shift", ["chair_shift_soft_01_v1.mp3", "chair_shift_soft_01_v2.mp3"], 0.08, 0.3, 240_000)
    );
  }

  if (/\b(elevator|lift)\b/.test(combined)) {
    plans.push(
      cuePlan("elevator_ding", ["elevator_ding_soft_01_v1.mp3", "elevator_ding_soft_01_v2.mp3"], 0.12, 0.36, 360_000),
      cuePlan("elevator_doors", ["elevator_doors_soft_01_v1.mp3", "elevator_doors_soft_01_v2.mp3"], 0.14, 0.4, 300_000)
    );
  }

  if (/\b(rain|storm|thunder|window)\b/.test(combined)) {
    plans.push(
      cuePlan("rain_window_tap", ["window_tap_rain_01_v1.mp3", "window_tap_rain_01_v2.mp3"], 0.14, 0.34, 180_000)
    );
  }
  if (/\b(storm|thunder)\b/.test(combined)) {
    plans.push(
      cuePlan(
        "distant_thunder",
        ["distant_thunder_soft_01_v1.mp3", "distant_thunder_soft_01_v2.mp3"],
        0.16,
        0.46,
        360_000
      )
    );
  }

  if (/\b(library|study|book)\b/.test(combined)) {
    plans.push(
      cuePlan("library_paper", ["paper_rustle_soft_01_v1.mp3", "paper_rustle_soft_01_v2.mp3"], 0.16, 0.34, 180_000),
      cuePlan("book_close", ["book_close_soft_01_v1.mp3", "book_close_soft_01_v2.mp3"], 0.08, 0.3, 300_000)
    );
  }

  if (/\b(hallway|corridor|wood floor|old house|cabin)\b/.test(combined)) {
    plans.push(
      cuePlan(
        "distant_footsteps",
        ["footstep_wood_soft_01_v1.mp3", "footstep_wood_soft_01_v2.mp3"],
        0.08,
        0.28,
        300_000
      ),
      cuePlan("floorboard", ["floorboard_creak_soft_01_v1.mp3", "floorboard_creak_soft_01_v2.mp3"], 0.08, 0.3, 300_000)
    );
  }

  if (/\b(door|doorway|threshold|entry|entrance)\b/.test(combined)) {
    plans.push(
      cuePlan("door_close", ["door_close_soft_01_v1.mp3", "door_close_soft_01_v2.mp3"], 0.12, 0.36, 360_000),
      cuePlan("door_creak", ["door_creak_soft_01_v1.mp3", "door_creak_soft_01_v2.mp3"], 0.08, 0.32, 420_000)
    );
  }

  if (/\b(radio|static|interference|signal|transmission|comms|scanner|shortwave)\b/.test(combined)) {
    plans.push(
      cuePlan(
        "radio_static_burst",
        ["radio_static_burst_soft_01_v1.mp3", "radio_static_burst_soft_01_v2.mp3"],
        0.08,
        0.24,
        360_000
      )
    );
  }

  if (plans.length === 0 && /\b(room|apartment|house|home)\b/.test(combined)) {
    plans.push(
      cuePlan("cloth_rustle", ["cloth_rustle_soft_01_v1.mp3", "cloth_rustle_soft_01_v2.mp3"], 0.08, 0.26, 300_000),
      cuePlan("chair_shift", ["chair_shift_soft_01_v1.mp3", "chair_shift_soft_01_v2.mp3"], 0.06, 0.28, 300_000)
    );
  }

  return plans;
}

function chooseSoundscapeCue(
  state: SoundscapeState,
  options: {
    nowMs: number;
    firedFamilies: Set<string>;
    cooldownUntil: Map<string, number>;
    random: () => number;
  }
): SoundscapeCueChoice | null {
  const triggered = cuePlansForState(state).filter((plan) => {
    if (options.firedFamilies.has(plan.family)) {
      return false;
    }
    if ((options.cooldownUntil.get(plan.family) ?? 0) > options.nowMs) {
      return false;
    }
    return options.random() <= plan.probability;
  });

  if (triggered.length === 0) {
    return null;
  }

  const plan = triggered[Math.min(triggered.length - 1, Math.floor(options.random() * triggered.length))];
  const path =
    plan.candidates[Math.min(plan.candidates.length - 1, Math.floor(options.random() * plan.candidates.length))];
  return {
    family: plan.family,
    path,
    gain: plan.gain
  };
}

function cueCooldownMs(state: SoundscapeState, family: string): number {
  return cuePlansForState(state).find((plan) => plan.family === family)?.cooldownMs ?? 300_000;
}

function cuePlan(
  family: string,
  candidates: string[],
  probability: number,
  gain: number,
  cooldownMs: number
): SoundscapeCuePlan {
  return { family, candidates, probability, gain, cooldownMs };
}

function jitter(minMs: number, fuzzMs: number, random: () => number): number {
  return minMs + Math.floor(random() * fuzzMs);
}

function normalizeSceneText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
