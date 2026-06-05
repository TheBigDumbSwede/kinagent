import type { ProceduralLayerDescriptor, SoundscapeState, SoundscapeTransition } from "./SoundscapeState.js";

const validTransitions = new Set<SoundscapeTransition>(["hold", "fade", "swell", "drop_to_silence"]);

export interface LayerDiff {
  added: ProceduralLayerDescriptor[];
  updated: ProceduralLayerDescriptor[];
  removed: ProceduralLayerDescriptor[];
  unchanged: ProceduralLayerDescriptor[];
}

export function clamp01(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function normalizeLayer(layer: ProceduralLayerDescriptor): ProceduralLayerDescriptor {
  return {
    type: layer.type,
    volume: clamp01(layer.volume),
    density: layer.density === undefined ? undefined : clamp01(layer.density),
    pitch: normalizePitch(layer.pitch),
    warmth: layer.warmth === undefined ? undefined : clamp01(layer.warmth),
    movement: layer.movement === undefined ? undefined : clamp01(layer.movement)
  };
}

export function normalizeSoundscapeState(state: SoundscapeState): SoundscapeState {
  const transition = validTransitions.has(state.transition) ? state.transition : "fade";
  return {
    enabled: Boolean(state.enabled),
    environment: state.environment.trim() || "unspecified",
    mood: state.mood.trim() || "neutral",
    intensity: clamp01(state.intensity),
    transition,
    layers: state.layers.map(normalizeLayer)
  };
}

export function diffLayers(previous: ProceduralLayerDescriptor[], next: ProceduralLayerDescriptor[]): LayerDiff {
  const previousByType = new Map(previous.map((layer) => [layer.type, layer]));
  const nextByType = new Map(next.map((layer) => [layer.type, layer]));
  const added: ProceduralLayerDescriptor[] = [];
  const updated: ProceduralLayerDescriptor[] = [];
  const unchanged: ProceduralLayerDescriptor[] = [];
  const removed: ProceduralLayerDescriptor[] = [];

  for (const layer of next) {
    const previousLayer = previousByType.get(layer.type);
    if (!previousLayer) {
      added.push(layer);
      continue;
    }

    if (JSON.stringify(normalizeLayer(previousLayer)) === JSON.stringify(normalizeLayer(layer))) {
      unchanged.push(layer);
    } else {
      updated.push(layer);
    }
  }

  for (const layer of previous) {
    if (!nextByType.has(layer.type)) {
      removed.push(layer);
    }
  }

  return { added, updated, removed, unchanged };
}

function normalizePitch(value: number | string | undefined): number | string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  return undefined;
}
