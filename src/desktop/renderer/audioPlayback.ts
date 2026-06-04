export interface VoiceAudioPayload {
  audio?: ArrayBuffer | ArrayBufferView;
  format?: string;
  boundaryGapMs?: number;
}

export interface VoiceAudioPlayerOptions {
  onError: (error: unknown) => void;
}

export function createVoiceAudioPlayer({
  onError
}: VoiceAudioPlayerOptions): (payload?: VoiceAudioPayload) => Promise<void> {
  const voiceAudio: {
    context: AudioContext | null;
    nextStartTime: number;
  } = {
    context: null,
    nextStartTime: 0
  };

  return async function playVoiceAudio(payload?: VoiceAudioPayload) {
    if (!payload?.audio || payload.format !== "mp3") {
      return;
    }

    try {
      const context = voiceAudio.context || new AudioContext();
      voiceAudio.context = context;
      if (context.state === "suspended") {
        await context.resume();
      }

      const audio = audioPayloadToArrayBuffer(payload.audio);
      const decoded = await context.decodeAudioData(audio.slice(0));
      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(context.destination);

      const now = context.currentTime;
      const boundaryGapSeconds = Math.max(0, Number(payload.boundaryGapMs ?? 80)) / 1000;
      const startAt = Math.max(now + 0.02, voiceAudio.nextStartTime + boundaryGapSeconds);
      source.start(startAt);
      voiceAudio.nextStartTime = startAt + decoded.duration;
      source.onended = () => {
        if (context.currentTime >= voiceAudio.nextStartTime - 0.05) {
          voiceAudio.nextStartTime = 0;
        }
      };
    } catch (error) {
      onError(error);
    }
  };
}

function audioPayloadToArrayBuffer(audio: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (audio instanceof ArrayBuffer) {
    return audio;
  }

  if (ArrayBuffer.isView(audio)) {
    return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  }

  throw new Error("Unsupported audio payload.");
}
