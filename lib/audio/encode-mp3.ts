/**
 * Browser-side helpers for converting any audio source into an MP3 blob.
 *
 * The encoder runs entirely in the browser by:
 *   1. Fetching the audio bytes (or accepting a Blob).
 *   2. Decoding through the Web Audio API (handles webm/opus, mp4/aac, ogg, wav, ...).
 *   3. Encoding the PCM samples to MP3 with @breezystack/lamejs.
 */

import { Mp3Encoder } from "@breezystack/lamejs";

/** lamejs only supports a fixed set of sample rates; pick the closest valid one. */
const SUPPORTED_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

function pickSupportedSampleRate(sampleRate: number): number {
  if (SUPPORTED_SAMPLE_RATES.includes(sampleRate)) return sampleRate;
  // Default to 44.1 kHz when the source uses something exotic.
  return 44100;
}

/** Convert a Float32 sample (-1..1) into a 16-bit signed integer. */
function floatToInt16(input: Float32Array, output: Int16Array): void {
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
}

/**
 * Resample one channel of audio to `targetRate` using linear interpolation.
 * Cheap and good-enough for speech-quality MP3s.
 */
function resampleChannel(
  channel: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate) return channel;
  const ratio = sourceRate / targetRate;
  const newLength = Math.floor(channel.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, channel.length - 1);
    const frac = srcIndex - i0;
    result[i] = channel[i0] * (1 - frac) + channel[i1] * frac;
  }
  return result;
}

export interface EncodeMp3Options {
  /** MP3 bitrate in kbps. Defaults to 128 kbps (good speech/music balance). */
  bitrateKbps?: number;
  /** Optional progress callback (0..1). */
  onProgress?: (progress: number) => void;
  /** Force mono output (averages stereo channels). Useful for speech to keep file size small. */
  mono?: boolean;
}

/**
 * Decode any browser-supported audio Blob into an AudioBuffer.
 *
 * The caller can pass an existing AudioContext to avoid creating one per call;
 * if not provided, a temporary one is created and closed when the returned
 * promise resolves.
 */
export async function decodeAudioBlob(
  blob: Blob,
  audioContext?: AudioContext
): Promise<AudioBuffer> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API is not available in this browser.");
  }

  const ctx = audioContext ?? new Ctor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (!audioContext) {
      await ctx.close().catch(() => {});
    }
  }
}

/**
 * Return a new AudioBuffer covering the time range [startSec, endSec) of the source.
 * The original buffer is not mutated.
 */
export function sliceAudioBuffer(
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sampleRate = source.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(source.length, Math.floor(endSec * sampleRate));
  const length = Math.max(0, endSample - startSample);

  const Ctor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) {
    throw new Error("OfflineAudioContext is not available in this browser.");
  }

  const offline = new Ctor(source.numberOfChannels, Math.max(1, length), sampleRate);
  const slice = offline.createBuffer(source.numberOfChannels, Math.max(1, length), sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = slice.getChannelData(ch);
    for (let i = 0; i < length; i++) dst[i] = src[startSample + i];
  }
  return slice;
}

/**
 * Encode a decoded AudioBuffer to an MP3 Blob.
 */
export function audioBufferToMp3(
  buffer: AudioBuffer,
  options: EncodeMp3Options = {}
): Blob {
  const { bitrateKbps = 128, onProgress, mono = false } = options;
  const channels = mono ? 1 : Math.min(buffer.numberOfChannels, 2);
  const targetSampleRate = pickSupportedSampleRate(buffer.sampleRate);

  let leftFloat: Float32Array;
  let rightFloat: Float32Array | undefined;

  if (mono && buffer.numberOfChannels > 1) {
    // Average all channels into one for mono output.
    const len = buffer.length;
    const mixed = new Float32Array(len);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) mixed[i] += data[i];
    }
    const inv = 1 / buffer.numberOfChannels;
    for (let i = 0; i < len; i++) mixed[i] *= inv;
    leftFloat = mixed;
  } else {
    leftFloat = buffer.getChannelData(0);
    rightFloat = channels > 1 ? buffer.getChannelData(1) : undefined;
  }

  if (buffer.sampleRate !== targetSampleRate) {
    leftFloat = resampleChannel(leftFloat, buffer.sampleRate, targetSampleRate);
    if (rightFloat) {
      rightFloat = resampleChannel(rightFloat, buffer.sampleRate, targetSampleRate);
    }
  }

  const left = new Int16Array(leftFloat.length);
  floatToInt16(leftFloat, left);
  let right: Int16Array | undefined;
  if (rightFloat) {
    right = new Int16Array(rightFloat.length);
    floatToInt16(rightFloat, right);
  }

  const encoder = new Mp3Encoder(channels, targetSampleRate, bitrateKbps);
  const blockSize = 1152; // lame's preferred frame size
  const mp3Data: Uint8Array[] = [];
  const totalSamples = left.length;

  for (let i = 0; i < totalSamples; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const rightChunk = right ? right.subarray(i, i + blockSize) : undefined;
    const mp3buf = rightChunk
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    if (onProgress && (i % (blockSize * 64) === 0)) {
      onProgress(Math.min(0.99, i / totalSamples));
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Data.push(flushed);
  onProgress?.(1);

  return new Blob(mp3Data as BlobPart[], { type: "audio/mpeg" });
}

/**
 * Decode any supported audio Blob and return an MP3 Blob.
 */
export async function blobToMp3(
  blob: Blob,
  options: EncodeMp3Options = {}
): Promise<Blob> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API is not available in this browser.");
  }

  const audioContext = new Ctor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // decodeAudioData requires its own ArrayBuffer copy in some browsers.
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return audioBufferToMp3(audioBuffer, options);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

/**
 * Fetch a remote audio URL and convert it to an MP3 Blob.
 */
export async function urlToMp3(
  url: string,
  options: EncodeMp3Options = {}
): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download audio (HTTP ${response.status} ${response.statusText}).`);
  }
  const blob = await response.blob();
  return blobToMp3(blob, options);
}

/**
 * Trigger a browser download for a Blob with the given filename.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Sanitize a string so it's safe to use as a filename across OSes.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "sermon";
}
