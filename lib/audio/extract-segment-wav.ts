/**
 * Decode a recording blob and export a time slice as 16-bit WAV (browser-only).
 */

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const length = buffer.length;
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
  const view = new DataView(arrayBuffer);
  const channels: Float32Array[] = [];
  let offset = 0;
  let pos = 0;

  const setUint16 = (data: number) => {
    view.setUint16(pos, data, true);
    pos += 2;
  };
  const setUint32 = (data: number) => {
    view.setUint32(pos, data, true);
    pos += 4;
  };

  setUint32(0x46464952); // "RIFF"
  setUint32(36 + length * numberOfChannels * 2);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1);
  setUint16(numberOfChannels);
  setUint32(sampleRate);
  setUint32(sampleRate * numberOfChannels * 2);
  setUint16(numberOfChannels * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length * numberOfChannels * 2);

  for (let i = 0; i < numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < arrayBuffer.byteLength) {
    for (let i = 0; i < numberOfChannels; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/**
 * Extract [startMs, endMs) from decoded audio. endMs null = end of file.
 */
export async function extractSegmentWavFromBlob(
  blob: Blob,
  startMs: number,
  endMs: number | null
): Promise<Blob | null> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const audioContext = new Ctor();
  try {
    const raw = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(raw.slice(0));
    const totalMs = (audioBuffer.length / audioBuffer.sampleRate) * 1000;
    const effectiveEndMs = endMs == null ? totalMs : Math.min(endMs, totalMs);
    const effectiveStartMs = Math.max(0, Math.min(startMs, effectiveEndMs));
    const startSample = Math.floor((effectiveStartMs / 1000) * audioBuffer.sampleRate);
    const endSample = Math.floor((effectiveEndMs / 1000) * audioBuffer.sampleRate);
    const segmentLength = Math.max(0, endSample - startSample);
    if (segmentLength === 0) return null;

    const segmentBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      segmentLength,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const inputData = audioBuffer.getChannelData(channel);
      const outputData = segmentBuffer.getChannelData(channel);
      for (let i = 0; i < segmentLength; i++) {
        outputData[i] = inputData[startSample + i];
      }
    }

    return audioBufferToWav(segmentBuffer);
  } catch (e) {
    console.error("[extractSegmentWavFromBlob]", e);
    return null;
  } finally {
    await audioContext.close().catch(() => {});
  }
}
