/**
 * Decide whether saved transcript_chunks already contain enough Whisper/live-backed text
 * for the recording length (vs tags + sparse browser captions only).
 */

export type ChunkLike = {
  text?: string;
  speakerTag?: boolean;
  source?: string;
};

export function whisperBackedNonTagCharCount(chunks: unknown[]): number {
  let n = 0;
  for (const raw of chunks) {
    const c = raw as ChunkLike;
    if (c.source !== "whisper" && c.source !== "whisper-live") continue;
    if (c.speakerTag === true) continue;
    const t = typeof c.text === "string" ? c.text.trim() : "";
    n += t.length;
  }
  return n;
}

/** Rough minimum Whisper/live transcript length before we treat a recording as fully transcribed. */
export function whisperMinCharsForDuration(durationSeconds: number): number {
  if (!durationSeconds || durationSeconds <= 0) return 400;
  return Math.min(12_000, Math.max(250, Math.floor(durationSeconds * 2)));
}

export function hasCompleteBackedTranscript(
  chunks: unknown[] | null | undefined,
  durationSeconds: number
): boolean {
  if (!chunks?.length) return false;
  const hasBackedChunk = chunks.some((raw) => {
    const c = raw as ChunkLike;
    return c.source === "whisper" || c.source === "whisper-live";
  });
  if (!hasBackedChunk) return false;
  const backedChars = whisperBackedNonTagCharCount(chunks);
  const minChars = whisperMinCharsForDuration(durationSeconds);
  return backedChars >= minChars;
}
