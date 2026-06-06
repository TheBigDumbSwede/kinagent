import type { ProceduralLayerDescriptor, SoundscapeState } from "../../soundscape/SoundscapeState.js";

export interface SampleLoopChoice {
  path: string;
  baseGain: number;
}

export function chooseSampleLoop(
  state: SoundscapeState,
  descriptor: ProceduralLayerDescriptor
): SampleLoopChoice | null {
  const environment = state.environment.toLowerCase();
  const mood = state.mood.toLowerCase();
  const combined = `${environment} ${mood}`;
  const intensity = Math.max(state.intensity, descriptor.volume);

  switch (descriptor.type) {
    case "rain":
      return {
        path: intensity > 0.55 ? "rain_window_heavy_01.mp3" : "rain_window_soft_01.mp3",
        baseGain: 0.9
      };
    case "wind":
      return {
        path: "wind_open_field_soft_01.mp3",
        baseGain: 0.85
      };
    case "roomTone":
      return chooseRoomToneSample(combined);
    case "static":
      return chooseStaticSample(combined);
    case "hum":
      return chooseHumSample(combined);
    case "lowDrone":
      return chooseLowDroneSample(combined);
    case "tensionPulse":
      return chooseTensionSample(combined);
  }
}

export function playableLayerDescriptors(state: SoundscapeState): ProceduralLayerDescriptor[] {
  return state.layers.filter((descriptor) => {
    if (descriptor.type !== "static") {
      return true;
    }

    return Boolean(chooseSampleLoop(state, descriptor));
  });
}

export function describeSoundscapeLayerSample(
  state: SoundscapeState,
  descriptor: ProceduralLayerDescriptor
): string | null {
  const sample = chooseSampleLoop(state, descriptor);
  if (!sample && descriptor.type === "static") {
    return "muted";
  }
  return sample ? sample.path.replace(/\.mp3$/i, "") : null;
}

export function layerVoiceKey(state: SoundscapeState, descriptor: ProceduralLayerDescriptor): string {
  const sample = chooseSampleLoop(state, descriptor);
  return sample ? `${descriptor.type}:${sample.path}` : `${descriptor.type}:procedural`;
}

export function soundscapeLayerSummary(state: SoundscapeState): string {
  const layers = playableLayerDescriptors(state);
  if (layers.length === 0) {
    return "silent";
  }

  return layers
    .map((descriptor) => {
      const sample = describeSoundscapeLayerSample(state, descriptor);
      return sample ? `${descriptor.type}:${sample}` : descriptor.type;
    })
    .join(", ");
}

function chooseRoomToneSample(combined: string): SampleLoopChoice {
  if (/\b(elevator lobby|lift lobby|office lobby|building lobby)\b/.test(combined)) {
    return { path: "elevator_lobby_sparse_01.mp3", baseGain: 0.95 };
  }
  if (/\b(elevator|lift|elevator-car)\b/.test(combined)) {
    return { path: "elevator_car_idle_01.mp3", baseGain: 1.0 };
  }
  const vehicle = chooseVehicleSample(combined);
  if (vehicle) {
    return vehicle;
  }
  if (/\b(office hallway|workplace hallway|corridor outside|hallway)\b/.test(combined)) {
    return { path: "office_hallway_passing_01.mp3", baseGain: 0.95 };
  }
  if (
    /\b(open office|cubicle|cubicles|workplace|corporate|office floor|office|conference room|meeting room|reception|desk)\b/.test(
      combined
    )
  ) {
    return { path: "office_coworker_murmur_soft_01.mp3", baseGain: 0.95 };
  }
  if (/\b(library|book|study)\b/.test(combined)) {
    return { path: "old_library_soft_01.mp3", baseGain: 1.05 };
  }
  if (/\b(cafe|restaurant)\b/.test(combined)) {
    return { path: "cafe_murmur_indistinct_soft_01.mp3", baseGain: 0.9 };
  }
  if (/\b(market|street)\b/.test(combined)) {
    return { path: "market_murmur_distant_soft_01.mp3", baseGain: 0.9 };
  }
  if (/\b(crowd|station|lobby|public)\b/.test(combined)) {
    return { path: "crowd_murmur_distant_soft_01.mp3", baseGain: 0.84 };
  }
  if (/\b(cave|stone|corridor)\b/.test(combined)) {
    return { path: "cave_air_soft_01.mp3", baseGain: 1.0 };
  }
  if (/\b(fire|fireplace|hearth|cabin|cozy)\b/.test(combined)) {
    return { path: "fireplace_soft_01.mp3", baseGain: 0.86 };
  }
  if (/\b(city|night|urban)\b/.test(combined)) {
    return { path: "city_distant_night_01.mp3", baseGain: 0.9 };
  }
  return { path: "room_tone_empty_01.mp3", baseGain: 1.15 };
}

function chooseVehicleSample(combined: string): SampleLoopChoice | null {
  if (!/\b(car|vehicle|driving|drive|road|highway|freeway|backseat|taxi|cab|truck)\b/.test(combined)) {
    return null;
  }
  if (/\b(rain|rainy|wet road|windshield|wiper|wipers)\b/.test(combined)) {
    return { path: "car_interior_rain_drive_01.mp3", baseGain: 1.0 };
  }
  if (/\b(parked|idling|idle|parking lot|curb)\b/.test(combined)) {
    return { path: "car_idle_interior_01.mp3", baseGain: 0.95 };
  }
  if (/\b(highway|freeway|interstate|motorway|road trip|open road)\b/.test(combined)) {
    return { path: "car_interior_highway_01.mp3", baseGain: 1.0 };
  }
  if (/\b(backseat|taxi|cab|night)\b/.test(combined)) {
    return { path: "car_backseat_night_01.mp3", baseGain: 0.95 };
  }
  return { path: "car_interior_city_drive_01.mp3", baseGain: 1.0 };
}

function chooseStaticSample(combined: string): SampleLoopChoice | null {
  if (
    /\b(radio|static|interference|signal|transmission|comms|scanner|shortwave|white noise|television|tv|eerie_static)\b/.test(
      combined
    )
  ) {
    return { path: "radio_static_soft_01.mp3", baseGain: 0.22 };
  }

  return null;
}

function chooseHumSample(combined: string): SampleLoopChoice {
  if (/\b(server|machine|technical|computer)\b/.test(combined)) {
    return { path: "server_room_soft_01.mp3", baseGain: 0.58 };
  }
  if (/\b(electrical|fluorescent|office|equipment)\b/.test(combined)) {
    return { path: "server_room_soft_01.mp3", baseGain: 0.38 };
  }
  return { path: "spaceship_hum_idle_01.mp3", baseGain: 0.34 };
}

function chooseLowDroneSample(combined: string): SampleLoopChoice {
  if (/\b(dream|surreal|abstract)\b/.test(combined)) {
    return { path: "dream_space_soft_01.mp3", baseGain: 0.58 };
  }
  if (/\b(cave|stone)\b/.test(combined)) {
    return { path: "cave_air_soft_01.mp3", baseGain: 0.64 };
  }
  if (/\b(ocean|shore|wave|porch)\b/.test(combined)) {
    return { path: "ocean_distant_soft_01.mp3", baseGain: 0.62 };
  }
  return { path: "haunted_house_subtle_01.mp3", baseGain: 0.48 };
}

function chooseTensionSample(combined: string): SampleLoopChoice {
  if (/\b(neon|alley|city)\b/.test(combined)) {
    return { path: "neon_alley_soft_01.mp3", baseGain: 0.55 };
  }
  if (/\b(spaceship|ship|crew)\b/.test(combined)) {
    return { path: "spaceship_crew_murmur_indistinct_01.mp3", baseGain: 0.46 };
  }
  return { path: "haunted_house_subtle_01.mp3", baseGain: 0.44 };
}
