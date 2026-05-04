import type { TranscriptChunk } from "@/lib/transcript/merge";
import {
  hasCompleteBackedTranscript,
  whisperBackedNonTagCharCount,
} from "@/lib/transcript/whisper-backed-stats";

export type MergeTranscriptSource = "recording" | "editable";

/**
 * Choose transcript chunks to merge with speaker tags: editable is preferred when it
 * already has a full Whisper/live-backed transcript, but recordings.transcript_chunks wins
 * when it was backfilled later (stale editable from tag-only era).
 */
export function pickMergeSourceTranscriptChunks(params: {
  recordingChunks: TranscriptChunk[];
  editableChunks: TranscriptChunk[] | null | undefined;
  durationSeconds: number;
}): { chunks: TranscriptChunk[]; source: MergeTranscriptSource } {
  const { recordingChunks, editableChunks, durationSeconds } = params;
  const hasEditable = Boolean(editableChunks?.length);

  if (!hasEditable) {
    return { chunks: recordingChunks, source: "recording" };
  }

  const ec = editableChunks as TranscriptChunk[];

  const recordingComplete = hasCompleteBackedTranscript(
    recordingChunks as unknown[],
    durationSeconds
  );
  const editableComplete = hasCompleteBackedTranscript(ec as unknown[], durationSeconds);

  if (recordingComplete && !editableComplete) {
    return { chunks: recordingChunks, source: "recording" };
  }
  if (!recordingComplete && editableComplete) {
    return { chunks: ec, source: "editable" };
  }
  if (!recordingComplete && !editableComplete) {
    const recBacked = whisperBackedNonTagCharCount(recordingChunks as unknown[]);
    const editBacked = whisperBackedNonTagCharCount(ec as unknown[]);
    return recBacked > editBacked
      ? { chunks: recordingChunks, source: "recording" }
      : { chunks: ec, source: "editable" };
  }

  return { chunks: ec, source: "editable" };
}
