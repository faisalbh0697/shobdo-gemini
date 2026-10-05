import { MAX_AUDIO_BYTES } from "@/lib/transcript";

export type AudioChunk = {
  blob: Blob;
  filename: string;
  offsetSeconds: number;
  index: number;
  total: number;
};

/** ~8 min mono 16 kHz WAV stays under the 25 MB per-request body limit. */
export const CHUNK_SECONDS = 480;
const OVERLAP_SECONDS = 0.75;
const TARGET_SAMPLE_RATE = 16_000;
const MAX_CHUNK_BYTES = MAX_AUDIO_BYTES - 256 * 1024;

function wavByteLength(sampleCount: number): number {
  return 44 + sampleCount * 2;
}

function maxSamplesForLimit(): number {
  return Math.floor((MAX_CHUNK_BYTES - 44) / 2);
}

function createAudioContext(): AudioContext {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const context = createAudioContext();
  try {
    const bytes = await file.arrayBuffer();
    return await context.decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error(
      "এই অডিও ব্রাউজারে খোলা যায়নি। mp3, wav, m4a, ogg, বা webm চেষ্টা করুন।",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();

  const mixed = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mixed[i] += data[i] / channels;
    }
  }
  return mixed;
}

async function resampleMono(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  if (fromRate === toRate) return input;
  const frameCount = Math.max(1, Math.ceil((input.length * toRate) / fromRate));
  const offline = new OfflineAudioContext(1, frameCount, toRate);
  const buffer = offline.createBuffer(1, input.length, fromRate);
  buffer.copyToChannel(Float32Array.from(input), 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export function encodeWavMono16k(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function sliceMonoSamples(
  mono16k: Float32Array,
  chunkSeconds: number,
): Array<{ samples: Float32Array; offsetSeconds: number }> {
  const maxSamples = Math.min(
    Math.floor(chunkSeconds * TARGET_SAMPLE_RATE),
    maxSamplesForLimit(),
  );
  const overlapSamples = Math.min(
    Math.floor(OVERLAP_SECONDS * TARGET_SAMPLE_RATE),
    Math.floor(maxSamples / 4),
  );
  const step = Math.max(1, maxSamples - overlapSamples);

  const slices: Array<{ samples: Float32Array; offsetSeconds: number }> = [];
  if (mono16k.length === 0) return slices;

  for (let start = 0; start < mono16k.length; start += step) {
    const end = Math.min(start + maxSamples, mono16k.length);
    slices.push({
      samples: mono16k.slice(start, end),
      offsetSeconds: start / TARGET_SAMPLE_RATE,
    });
    if (end >= mono16k.length) break;
  }

  return slices;
}

export async function prepareAudioChunks(
  file: File,
  options?: { chunkSeconds?: number; maxDurationSeconds?: number; maxBytes?: number },
): Promise<AudioChunk[]> {
  const chunkSeconds = options?.chunkSeconds ?? CHUNK_SECONDS;
  const maxDurationSeconds = options?.maxDurationSeconds ?? chunkSeconds;
  const maxBytes = options?.maxBytes ?? MAX_AUDIO_BYTES;
  const decoded = await decodeAudioFile(file);

  // Fits one request — keep original quality.
  if (decoded.duration <= maxDurationSeconds && file.size <= maxBytes) {
    return [
      {
        blob: file,
        filename: file.name,
        offsetSeconds: 0,
        index: 0,
        total: 1,
      },
    ];
  }

  const mono = mixToMono(decoded);
  const mono16k = await resampleMono(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);

  if (
    decoded.duration <= chunkSeconds &&
    wavByteLength(mono16k.length) <= MAX_CHUNK_BYTES
  ) {
    return [
      {
        blob: encodeWavMono16k(mono16k),
        filename: `${baseName(file.name)}.chunk-0.wav`,
        offsetSeconds: 0,
        index: 0,
        total: 1,
      },
    ];
  }

  const slices = sliceMonoSamples(mono16k, chunkSeconds);
  return slices.map((slice, index) => ({
    blob: encodeWavMono16k(slice.samples),
    filename: `${baseName(file.name)}.chunk-${index}.wav`,
    offsetSeconds: slice.offsetSeconds,
    index,
    total: slices.length,
  }));
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "audio";
}
