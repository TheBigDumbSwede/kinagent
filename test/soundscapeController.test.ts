import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundscapeController } from "../src/desktop/renderer/SoundscapeController.js";
import { silentSoundscapeState, type SoundscapeState } from "../src/soundscape/SoundscapeState.js";

describe("SoundscapeController", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/renderer/index.html" },
      setTimeout,
      clearTimeout
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("evicts failed sample loads so a later update can retry the same sample", async () => {
    const loadSample = vi
      .fn<SoundscapeLoadSample>()
      .mockRejectedValueOnce(new Error("sample missing"))
      .mockResolvedValueOnce(new ArrayBuffer(8));
    const controller = new SoundscapeController({
      loadSample,
      random: () => 0.99
    });
    controller.markUserInteractionReady();

    await controller.update(sampleState({ environment: "quiet office floor" }));
    await controller.update(silentSoundscapeState);
    await controller.update(sampleState({ environment: "quiet office floor" }));

    expect(loadSample).toHaveBeenCalledTimes(2);
    expect(loadSample).toHaveBeenNthCalledWith(1, "loops/office_coworker_murmur_soft_01.mp3");
    expect(loadSample).toHaveBeenNthCalledWith(2, "loops/office_coworker_murmur_soft_01.mp3");
  });

  it("does not let a stale async sample update overwrite newer playback state", async () => {
    const firstLoad = deferred<ArrayBuffer>();
    const statuses: string[] = [];
    const loadSample = vi.fn<SoundscapeLoadSample>((relativePath) => {
      if (relativePath === "loops/office_coworker_murmur_soft_01.mp3") {
        return firstLoad.promise;
      }
      return Promise.resolve(new ArrayBuffer(8));
    });
    const controller = new SoundscapeController({
      loadSample,
      onStatus: (message) => statuses.push(message),
      random: () => 0.99
    });
    controller.markUserInteractionReady();

    const staleUpdate = controller.update(sampleState({ environment: "quiet office floor" }));
    await Promise.resolve();
    await controller.update(sampleState({ environment: "small cafe" }));

    firstLoad.resolve(new ArrayBuffer(8));
    await staleUpdate;

    expect(statuses).toContain("Soundscape: small cafe (roomTone:cafe_murmur_indistinct_soft_01).");
    expect(statuses).not.toContain("Soundscape: quiet office floor (roomTone:office_coworker_murmur_soft_01).");
    expect(statuses.at(-1)).toBe("Soundscape: small cafe (roomTone:cafe_murmur_indistinct_soft_01).");
  });
});

type SoundscapeLoadSample = (relativePath: string) => Promise<ArrayBuffer>;

function sampleState(overrides: Partial<SoundscapeState>): SoundscapeState {
  return {
    enabled: true,
    environment: "room",
    mood: "neutral",
    intensity: 0.5,
    transition: "fade",
    layers: [{ type: "roomTone", volume: 0.5 }],
    ...overrides
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class FakeAudioParam {
  value = 0;

  cancelScheduledValues(_at: number): void {}

  setValueAtTime(value: number, _at: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number, _at: number): void {
    this.value = value;
  }

  setTargetAtTime(value: number, _at: number, _constant: number): void {
    this.value = value;
  }
}

class FakeAudioNode {
  connect(_destination: unknown): void {}

  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  detune = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();

  start(): void {}

  stop(_at?: number): void {}
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;

  start(_when?: number, _offset?: number): void {}

  stop(_at?: number): void {}
}

class FakeAudioBuffer {
  sampleRate = 44_100;
  length = 88_200;
  duration = 2;
  numberOfChannels = 1;
  private readonly data = new Float32Array(this.length);

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 1;
  sampleRate = 44_100;
  destination = new FakeAudioNode();

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode();
  }

  createBuffer(_channels: number, _frameCount: number, _sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer();
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode();
  }

  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode();
  }

  async decodeAudioData(_audio: ArrayBuffer): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer();
  }

  async resume(): Promise<void> {}

  async close(): Promise<void> {}
}
