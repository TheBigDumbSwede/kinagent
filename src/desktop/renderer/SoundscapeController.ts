import { normalizeSoundscapeState } from "../../soundscape/ProceduralLayers.js";
import type {
  ProceduralLayerDescriptor,
  ProceduralLayerType,
  SoundscapeState
} from "../../soundscape/SoundscapeState.js";

interface SoundscapeControllerOptions {
  onStatus?: (message: string) => void;
}

interface LayerVoice {
  descriptor: ProceduralLayerDescriptor;
  output: GainNode;
  stop: (at: number) => void;
  update: (descriptor: ProceduralLayerDescriptor, intensity: number, at: number) => void;
}

const fadeSeconds = 1.2;
const stopFadeSeconds = 0.18;
const masterVolume = 0.08;
const duckedVolumeMultiplier = 0.32;

export class SoundscapeController {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private layers = new Map<ProceduralLayerType, LayerVoice>();
  private currentState: SoundscapeState | null = null;
  private userInteractionReady = false;
  private duckedUntil = 0;
  private duckTimer: number | undefined;

  constructor(private readonly options: SoundscapeControllerOptions = {}) {}

  markUserInteractionReady(): void {
    this.userInteractionReady = true;
    if (this.currentState?.enabled) {
      void this.applyState(this.currentState);
    }
  }

  async update(input: SoundscapeState): Promise<void> {
    const state = normalizeSoundscapeState(input);
    this.currentState = state;

    if (!state.enabled) {
      this.stop();
      this.options.onStatus?.("Soundscape off.");
      return;
    }

    if (!this.userInteractionReady) {
      this.options.onStatus?.("Soundscape ready. Use a soundscape control to start audio.");
      return;
    }

    await this.applyState(state);
  }

  duckFor(durationMs: number): void {
    if (!this.context || !this.masterGain || !this.currentState?.enabled) {
      return;
    }

    const now = this.context.currentTime;
    this.duckedUntil = Math.max(this.duckedUntil, performance.now() + durationMs);
    this.rampMasterGain(targetMasterGain(this.currentState.intensity, true), now, 0.08);
    window.clearTimeout(this.duckTimer);
    this.duckTimer = window.setTimeout(() => {
      if (performance.now() >= this.duckedUntil - 20 && this.context && this.masterGain && this.currentState?.enabled) {
        this.rampMasterGain(targetMasterGain(this.currentState.intensity, false), this.context.currentTime, 0.45);
      }
    }, durationMs);
  }

  stop(): void {
    if (!this.context || !this.masterGain) {
      this.layers.clear();
      return;
    }

    const now = this.context.currentTime;
    this.rampMasterGain(0, now, stopFadeSeconds);
    for (const layer of this.layers.values()) {
      layer.stop(now + stopFadeSeconds + 0.04);
    }
    this.layers.clear();
    window.clearTimeout(this.duckTimer);
    this.duckTimer = undefined;
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
  }

  private async applyState(state: SoundscapeState): Promise<void> {
    const context = this.ensureContext();
    const masterGain = this.masterGain;
    if (!masterGain) {
      throw new Error("Soundscape audio graph was not initialized.");
    }
    if (context.state === "suspended") {
      await context.resume();
    }

    const now = context.currentTime;
    const nextTypes = new Set(state.layers.map((layer) => layer.type));
    for (const [type, voice] of this.layers.entries()) {
      if (!nextTypes.has(type)) {
        fadeGain(voice.output.gain, 0, now, fadeSeconds);
        voice.stop(now + fadeSeconds + 0.05);
        this.layers.delete(type);
      }
    }

    for (const descriptor of state.layers) {
      const existing = this.layers.get(descriptor.type);
      if (existing) {
        existing.update(descriptor, state.intensity, now);
      } else {
        const voice = createLayerVoice(context, descriptor, state.intensity);
        voice.output.connect(masterGain);
        fadeGain(voice.output.gain, targetLayerGain(descriptor, state.intensity), now, fadeSeconds);
        this.layers.set(descriptor.type, voice);
      }
    }

    this.rampMasterGain(
      targetMasterGain(state.intensity, false),
      now,
      state.transition === "swell" ? 2.4 : fadeSeconds
    );
    this.options.onStatus?.(`Soundscape: ${state.environment} (${state.layers.length} layers).`);
  }

  private ensureContext(): AudioContext {
    if (this.context && this.masterGain) {
      return this.context;
    }

    this.context = new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  private rampMasterGain(value: number, at: number, seconds: number): void {
    if (!this.masterGain) {
      return;
    }

    fadeGain(this.masterGain.gain, value, at, seconds);
  }
}

function createLayerVoice(context: AudioContext, descriptor: ProceduralLayerDescriptor, intensity: number): LayerVoice {
  switch (descriptor.type) {
    case "rain":
      return createNoiseLayer(context, descriptor, intensity, { highpass: 700, lowpass: 5400 });
    case "wind":
      return createWindLayer(context, descriptor);
    case "roomTone":
      return createNoiseLayer(context, descriptor, intensity, { highpass: 80, lowpass: 900 });
    case "static":
      return createNoiseLayer(context, descriptor, intensity, { highpass: 1500, lowpass: 7600 });
    case "hum":
      return createOscillatorLayer(context, descriptor, intensity, "sawtooth", 60);
    case "lowDrone":
      return createOscillatorLayer(context, descriptor, intensity, "sine", 74);
    case "tensionPulse":
      return createTensionPulseLayer(context, descriptor);
  }
}

function createNoiseLayer(
  context: AudioContext,
  descriptor: ProceduralLayerDescriptor,
  intensity: number,
  shape: { highpass: number; lowpass: number }
): LayerVoice {
  const source = context.createBufferSource();
  source.buffer = createNoiseBuffer(context, descriptor.density ?? 0.5);
  source.loop = true;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = shape.highpass;
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = shape.lowpass;
  const output = context.createGain();
  output.gain.value = 0;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(output);
  source.start();

  return {
    descriptor,
    output,
    update(next, nextIntensity, at) {
      fadeGain(output.gain, targetLayerGain(next, nextIntensity), at, 0.7);
      rampParam(lowpass.frequency, shapedLowpass(shape.lowpass, next.warmth, next.movement), at, 0.7);
    },
    stop(at) {
      source.stop(at);
      scheduleCleanup(context, at, () => {
        source.disconnect();
        highpass.disconnect();
        lowpass.disconnect();
        output.disconnect();
      });
    }
  };
}

function createWindLayer(context: AudioContext, descriptor: ProceduralLayerDescriptor): LayerVoice {
  const source = context.createBufferSource();
  source.buffer = createNoiseBuffer(context, descriptor.density ?? 0.44);
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = windFrequency(descriptor);
  filter.Q.value = 0.7;
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.08 + (descriptor.movement ?? 0.5) * 0.16;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 260 + (descriptor.movement ?? 0.5) * 520;
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.detune);

  const output = context.createGain();
  output.gain.value = 0;
  source.connect(filter);
  filter.connect(output);
  source.start();
  lfo.start();

  return {
    descriptor,
    output,
    update(next, nextIntensity, at) {
      fadeGain(output.gain, targetLayerGain(next, nextIntensity), at, 0.7);
      rampParam(filter.frequency, windFrequency(next), at, 0.8);
      rampParam(lfo.frequency, 0.08 + (next.movement ?? 0.5) * 0.16, at, 0.8);
      rampParam(lfoDepth.gain, 260 + (next.movement ?? 0.5) * 520, at, 0.8);
    },
    stop(at) {
      source.stop(at);
      lfo.stop(at);
      scheduleCleanup(context, at, () => {
        source.disconnect();
        lfo.disconnect();
        lfoDepth.disconnect();
        filter.disconnect();
        output.disconnect();
      });
    }
  };
}

function createOscillatorLayer(
  context: AudioContext,
  descriptor: ProceduralLayerDescriptor,
  intensity: number,
  type: OscillatorType,
  fallbackFrequency: number
): LayerVoice {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequencyFromPitch(descriptor.pitch, fallbackFrequency);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 280 + (descriptor.warmth ?? 0.5) * 520;
  const output = context.createGain();
  output.gain.value = 0;

  oscillator.connect(filter);
  filter.connect(output);
  oscillator.start();

  return {
    descriptor,
    output,
    update(next, nextIntensity, at) {
      fadeGain(output.gain, targetLayerGain(next, nextIntensity), at, 0.7);
      rampParam(oscillator.frequency, frequencyFromPitch(next.pitch, fallbackFrequency), at, 0.7);
      rampParam(filter.frequency, 280 + (next.warmth ?? 0.5) * 520, at, 0.7);
    },
    stop(at) {
      oscillator.stop(at);
      scheduleCleanup(context, at, () => {
        oscillator.disconnect();
        filter.disconnect();
        output.disconnect();
      });
    }
  };
}

function createTensionPulseLayer(context: AudioContext, descriptor: ProceduralLayerDescriptor): LayerVoice {
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequencyFromPitch(descriptor.pitch, 96);
  const pulseGain = context.createGain();
  pulseGain.gain.value = 0.08;
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.18 + (descriptor.density ?? 0.5) * 0.42;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.11 + (descriptor.movement ?? 0.5) * 0.18;
  const output = context.createGain();
  output.gain.value = 0;

  oscillator.connect(pulseGain);
  pulseGain.connect(output);
  lfo.connect(lfoDepth);
  lfoDepth.connect(pulseGain.gain);
  oscillator.start();
  lfo.start();

  return {
    descriptor,
    output,
    update(next, nextIntensity, at) {
      fadeGain(output.gain, targetLayerGain(next, nextIntensity), at, 0.7);
      rampParam(oscillator.frequency, frequencyFromPitch(next.pitch, 96), at, 0.7);
      rampParam(lfo.frequency, 0.18 + (next.density ?? 0.5) * 0.42, at, 0.7);
      rampParam(lfoDepth.gain, 0.11 + (next.movement ?? 0.5) * 0.18, at, 0.7);
    },
    stop(at) {
      oscillator.stop(at);
      lfo.stop(at);
      scheduleCleanup(context, at, () => {
        oscillator.disconnect();
        pulseGain.disconnect();
        lfo.disconnect();
        lfoDepth.disconnect();
        output.disconnect();
      });
    }
  };
}

function createNoiseBuffer(context: AudioContext, density: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * 2));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  const holdFrames = Math.max(1, Math.floor((1 - density) * 18));
  let sample = 0;
  for (let index = 0; index < frameCount; index += 1) {
    if (index % holdFrames === 0) {
      sample = Math.random() * 2 - 1;
    }
    data[index] = sample;
  }

  return buffer;
}

function targetLayerGain(descriptor: ProceduralLayerDescriptor, intensity: number): number {
  return Math.max(0, descriptor.volume) * (0.35 + intensity * 0.65);
}

function targetMasterGain(intensity: number, ducked: boolean): number {
  const gain = masterVolume * (0.45 + intensity * 0.55);
  return ducked ? gain * duckedVolumeMultiplier : gain;
}

function fadeGain(param: AudioParam, value: number, at: number, seconds: number): void {
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(value, at + seconds);
}

function rampParam(param: AudioParam, value: number, at: number, seconds: number): void {
  param.cancelScheduledValues(at);
  param.setTargetAtTime(value, at, Math.max(0.01, seconds / 3));
}

function frequencyFromPitch(pitch: number | string | undefined, fallback: number): number {
  if (typeof pitch === "number" && Number.isFinite(pitch) && pitch > 0) {
    return pitch;
  }

  if (typeof pitch === "string") {
    const parsed = Number(pitch);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  return fallback;
}

function shapedLowpass(base: number, warmth = 0.5, movement = 0.3): number {
  return base * (0.75 + warmth * 0.25 + movement * 0.18);
}

function windFrequency(descriptor: ProceduralLayerDescriptor): number {
  return 260 + (descriptor.movement ?? 0.5) * 920 + (descriptor.warmth ?? 0.3) * 180;
}

function scheduleCleanup(context: AudioContext, at: number, cleanup: () => void): void {
  window.setTimeout(cleanup, Math.max(0, (at - context.currentTime) * 1000 + 20));
}
