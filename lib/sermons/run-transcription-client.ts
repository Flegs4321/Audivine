/**
 * Client-side sermon transcription: single-file Whisper, then chunked fallback.
 * Shared by Sermons library (optional quick actions) and Review page.
 */

import {
  audioBufferToMp3,
  decodeAudioBlob,
  sliceAudioBuffer,
} from "@/lib/audio/encode-mp3";

export interface TranscriptionChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string;
  speakerTag?: boolean;
  source?: "whisper" | "whisper-live";
}

export interface RunSermonTranscriptionOptions {
  recordingId: string;
  storageUrl: string | undefined;
  accessToken: string;
  onStatus: (status: string) => void;
}

/**
 * Returns new transcript chunks on success. Throws on failure.
 */
export async function runSermonTranscription(
  options: RunSermonTranscriptionOptions
): Promise<TranscriptionChunk[]> {
  const { recordingId, storageUrl, accessToken, onStatus } = options;

  onStatus("Sending audio to Whisper…");
  const response = await fetch("/api/sermons/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recordingId,
      audioUrl: storageUrl,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (response.ok) {
    return Array.isArray(data.chunks) ? data.chunks : [];
  }

  const tooLarge =
    response.status === 413 ||
    /too large|exceeds 25MB/i.test(String(data?.error || data?.message || ""));

  if (!tooLarge) {
    const message =
      data.message || data.error || `Transcription failed (HTTP ${response.status})`;
    throw new Error(message);
  }

  if (!storageUrl) {
    throw new Error("This recording has no audio URL, so it cannot be transcribed.");
  }

  return runChunkedTranscription({
    recordingId,
    storageUrl,
    accessToken,
    onStatus,
  });
}

async function runChunkedTranscription(params: {
  recordingId: string;
  storageUrl: string;
  accessToken: string;
  onStatus: (status: string) => void;
}): Promise<TranscriptionChunk[]> {
  const { recordingId, storageUrl, accessToken, onStatus } = params;

  onStatus("File is too large for one request — downloading audio for splitting…");
  const audioResponse = await fetch(storageUrl);
  if (!audioResponse.ok) {
    throw new Error(`Could not download audio (HTTP ${audioResponse.status}).`);
  }
  const originalBlob = await audioResponse.blob();

  onStatus("Decoding audio…");
  const audioBuffer = await decodeAudioBlob(originalBlob);

  const totalSeconds = audioBuffer.duration;
  const CHUNK_SECONDS = 5 * 60;
  const totalChunks = Math.max(1, Math.ceil(totalSeconds / CHUNK_SECONDS));

  const allTranscriptChunks: TranscriptionChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const startSec = i * CHUNK_SECONDS;
    const endSec = Math.min(totalSeconds, (i + 1) * CHUNK_SECONDS);

    onStatus(`Encoding chunk ${i + 1} of ${totalChunks}…`);
    const slice = sliceAudioBuffer(audioBuffer, startSec, endSec);
    const mp3Blob = audioBufferToMp3(slice, { bitrateKbps: 64, mono: true });

    onStatus(`Transcribing chunk ${i + 1} of ${totalChunks}…`);
    const formData = new FormData();
    formData.append("audio", mp3Blob, `chunk-${i + 1}.mp3`);
    formData.append("recordingId", recordingId);
    formData.append("offsetMs", String(Math.floor(startSec * 1000)));

    const chunkResponse = await fetch("/api/sermons/transcribe-chunk", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });

    const chunkData = await chunkResponse.json().catch(() => ({}));
    if (!chunkResponse.ok) {
      const message =
        chunkData.message ||
        chunkData.error ||
        `Chunk ${i + 1} failed (HTTP ${chunkResponse.status})`;
      throw new Error(message);
    }

    const incoming: TranscriptionChunk[] = Array.isArray(chunkData.chunks)
      ? chunkData.chunks
      : [];
    allTranscriptChunks.push(...incoming);
  }

  onStatus("Saving transcript…");
  const saveResponse = await fetch("/api/sermons/save-transcript", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recordingId,
      chunks: allTranscriptChunks,
    }),
  });

  const saveData = await saveResponse.json().catch(() => ({}));
  if (!saveResponse.ok) {
    throw new Error(saveData.message || saveData.error || "Failed to save transcript.");
  }

  return Array.isArray(saveData.chunks) ? saveData.chunks : allTranscriptChunks;
}
