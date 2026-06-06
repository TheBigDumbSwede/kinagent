import { normalizeSoundscapeState } from "../../soundscape/ProceduralLayers.js";
import type { ProceduralLayerDescriptor, SoundscapeState } from "../../soundscape/SoundscapeState.js";
import { SoundscapeCueScheduler, type SoundscapeCueChoice } from "./SoundscapeCueSelection.js";
import {
  chooseSampleLoop,
  layerVoiceKey,
  playableLayerDescriptors,
  soundscapeLayerSummary
} from "./SoundscapeSampleSelection.js";

interface SoundscapeControllerOptions {
  onStatus?: (message: string) => void;
  onCue?: (label: string) => void;
  loadSample?: (relativePath: string) => Promise<ArrayBuffer>;
  random?: () => number;
}

interface LayerVoice {
  descriptor: ProceduralLayerDescriptor;
  output: GainNode;
  stop: (at: number) => void;
  update: (descriptor: ProceduralLayerDescriptor, intensity: number, at: number) => void;
}

interface LoopRegion {
  start: number;
  end: number;
}

const fadeSeconds = 1.2;
const stopFadeSeconds = 0.18;
const masterVolume = 1;
const duckedVolumeMultiplier = 0.32;
const sampleAssetRoot = "../assets/soundscape-normalized";
const samplePresenceFloor = 0.8;
const samplePlaybackBoost = 1.6;
const cuePlaybackBoost = 1.38;

export class SoundscapeController {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private layers = new Map<string, LayerVoice>();
  private sampleCache = new Map<string, Promise<AudioBuffer>>();
  private currentState: SoundscapeState | null = null;
  private userInteractionReady = false;
  private duckedUntil = 0;
  private duckTimer: number | undefined;
  private cueTimer: number | undefined;
  private cueScheduler = new SoundscapeCueScheduler();

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
      this.cueScheduler.reset();
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
    window.clearTimeout(this.cueTimer);
    this.cueTimer = undefined;
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
    const nextLayers = playableLayerDescriptors(state).map((descriptor) => ({
      descriptor,
      key: layerVoiceKey(state, descriptor)
    }));
    const nextKeys = new Set(nextLayers.map((layer) => layer.key));
    for (const [key, voice] of this.layers.entries()) {
      if (!nextKeys.has(key)) {
        fadeGain(voice.output.gain, 0, now, fadeSeconds);
        voice.stop(now + fadeSeconds + 0.05);
        this.layers.delete(key);
      }
    }

    for (const { descriptor, key } of nextLayers) {
      const existing = this.layers.get(key);
      if (existing) {
        existing.update(descriptor, state.intensity, now);
      } else {
        const voice = await this.createLayerVoice(context, state, descriptor);
        voice.output.connect(masterGain);
        voice.update(descriptor, state.intensity, now);
        this.layers.set(key, voice);
      }
    }

    this.rampMasterGain(
      targetMasterGain(state.intensity, false),
      now,
      state.transition === "swell" ? 2.4 : fadeSeconds
    );
    this.scheduleCuePlayback(state);
    this.options.onStatus?.(`Soundscape: ${state.environment} (${soundscapeLayerSummary(state)}).`);
  }

  private async createLayerVoice(
    context: AudioContext,
    state: SoundscapeState,
    descriptor: ProceduralLayerDescriptor
  ): Promise<LayerVoice> {
    const sample = chooseSampleLoop(state, descriptor);
    if (!sample) {
      return createProceduralLayerVoice(context, descriptor, state.intensity);
    }

    try {
      const buffer = await this.loadSampleBuffer(context, `loops/${sample.path}`);
      return createSampleLayerVoice(context, descriptor, buffer, sample.baseGain);
    } catch (error) {
      this.options.onStatus?.(`Soundscape sample unavailable: ${errorMessage(error)}`);
      return createProceduralLayerVoice(context, descriptor, state.intensity);
    }
  }

  private loadSampleBuffer(context: AudioContext, relativePath: string): Promise<AudioBuffer> {
    const url = new URL(`${sampleAssetRoot}/${relativePath}`, window.location.href).href;
    const cached = this.sampleCache.get(url);
    if (cached) {
      return cached;
    }

    const promise = (
      this.options.loadSample
        ? this.options.loadSample(relativePath)
        : fetch(url).then((response) => {
            if (!response.ok) {
              throw new Error(`Unable to load soundscape sample: ${relativePath}`);
            }
            return response.arrayBuffer();
          })
    ).then((audio) => context.decodeAudioData(audio.slice(0)));
    this.sampleCache.set(url, promise);
    return promise;
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

  private scheduleCuePlayback(state: SoundscapeState): void {
    const nowMs = performance.now();
    this.cueScheduler.syncScene(state, nowMs, this.random);
    window.clearTimeout(this.cueTimer);

    const nextAt = this.cueScheduler.snapshot().nextAmbientCueAt;
    if (!this.userInteractionReady || !state.enabled || nextAt === null) {
      this.cueTimer = undefined;
      return;
    }

    const delayMs = Math.max(0, nextAt - nowMs);
    this.cueTimer = window.setTimeout(() => {
      void this.playScheduledCue();
    }, delayMs);
  }

  private async playScheduledCue(): Promise<void> {
    if (!this.currentState?.enabled || !this.userInteractionReady) {
      return;
    }

    const cue = this.cueScheduler.consumeDueCue(this.currentState, performance.now(), this.random);
    if (cue) {
      await this.playCue(cue, this.currentState.intensity);
    }
    this.scheduleCuePlayback(this.currentState);
  }

  private async playCue(cue: SoundscapeCueChoice, intensity: number): Promise<void> {
    const context = this.ensureContext();
    const masterGain = this.masterGain;
    if (!masterGain) {
      return;
    }

    try {
      const buffer = await this.loadSampleBuffer(context, `cues/${cue.path}`);
      playOneShotCue(context, masterGain, buffer, targetCueGain(cue, intensity));
      this.options.onCue?.(cue.path.replace(/\.mp3$/i, ""));
    } catch (error) {
      this.options.onStatus?.(`Soundscape cue unavailable: ${errorMessage(error)}`);
    }
  }

  private random = (): number => this.options.random?.() ?? Math.random();
}

function createProceduralLayerVoice(
  context: AudioContext,
  descriptor: ProceduralLayerDescriptor,
  intensity: number
): LayerVoice {
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

function createSampleLayerVoice(
  context: AudioContext,
  descriptor: ProceduralLayerDescriptor,
  buffer: AudioBuffer,
  baseGain: number
): LayerVoice {
  const source = context.createBufferSource();
  const loopRegion = detectLoopRegion(buffer);
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = loopRegion.start;
  source.loopEnd = loopRegion.end;
  const output = context.createGain();
  output.gain.value = 0;
  source.connect(output);
  source.start(0, loopRegion.start);

  return {
    descriptor,
    output,
    update(next, nextIntensity, at) {
      fadeGain(output.gain, targetSampleLayerGain(next, nextIntensity, baseGain), at, 0.7);
    },
    stop(at) {
      source.stop(at);
      scheduleCleanup(context, at, () => {
        source.disconnect();
        output.disconnect();
      });
    }
  };
}

function playOneShotCue(context: AudioContext, destination: AudioNode, buffer: AudioBuffer, gain: number): void {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const output = context.createGain();
  const now = context.currentTime;
  output.gain.setValueAtTime(0, now);
  output.gain.linearRampToValueAtTime(gain, now + 0.035);
  output.gain.setValueAtTime(gain, Math.max(now + 0.035, now + buffer.duration - 0.16));
  output.gain.linearRampToValueAtTime(0, now + buffer.duration);
  source.connect(output);
  output.connect(destination);
  source.start(now);
  source.stop(now + buffer.duration + 0.04);
  scheduleCleanup(context, now + buffer.duration + 0.08, () => {
    source.disconnect();
    output.disconnect();
  });
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

function targetSampleLayerGain(descriptor: ProceduralLayerDescriptor, intensity: number, baseGain: number): number {
  const layerGain = targetLayerGain(descriptor, intensity);
  if (layerGain <= 0) {
    return 0;
  }

  return (samplePresenceFloor + layerGain * (1 - samplePresenceFloor)) * baseGain * samplePlaybackBoost;
}

function targetCueGain(cue: SoundscapeCueChoice, intensity: number): number {
  return cue.gain * (0.72 + intensity * 0.28) * cuePlaybackBoost;
}

function detectLoopRegion(buffer: AudioBuffer): LoopRegion {
  const threshold = 0.001;
  const guardFrames = Math.floor(buffer.sampleRate * 0.005);
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_value, channel) =>
    buffer.getChannelData(channel)
  );
  let first = 0;
  let last = buffer.length - 1;

  for (let frame = 0; frame < buffer.length; frame += 1) {
    if (isAudibleFrame(channelData, frame, threshold)) {
      first = Math.max(0, frame - guardFrames);
      break;
    }
  }

  for (let frame = buffer.length - 1; frame >= 0; frame -= 1) {
    if (isAudibleFrame(channelData, frame, threshold)) {
      last = Math.min(buffer.length - 1, frame + guardFrames);
      break;
    }
  }

  if (last - first < buffer.sampleRate) {
    return { start: 0, end: buffer.duration };
  }

  return {
    start: first / buffer.sampleRate,
    end: (last + 1) / buffer.sampleRate
  };
}

function isAudibleFrame(channelData: Float32Array[], frame: number, threshold: number): boolean {
  for (const channel of channelData) {
    if (Math.abs(channel[frame] ?? 0) > threshold) {
      return true;
    }
  }

  return false;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
