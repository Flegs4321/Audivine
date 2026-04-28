/**
 * Replaces live-derived rows in transcript_speaker_tags from transcript_chunks
 * speakerTag markers. Manual UI tags (tag_source = manual) are left intact.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveLiveSpeakerTagsFromChunks } from "./liveTagsFromChunks";

export async function syncLiveSpeakerTagsFromRecordingChunks(
  supabase: SupabaseClient,
  params: {
    recordingId: string;
    userId: string;
    transcriptChunks: unknown[] | null | undefined;
  }
): Promise<{ ok: true; inserted: number } | { ok: false; message: string }> {
  const { recordingId, userId } = params;
  const chunks = Array.isArray(params.transcriptChunks)
    ? params.transcriptChunks
    : [];

  const derived = deriveLiveSpeakerTagsFromChunks(
    chunks as { text?: string; timestampMs?: number; speakerTag?: boolean }[]
  );

  const { error: deleteError } = await supabase
    .from("transcript_speaker_tags")
    .delete()
    .eq("recording_id", recordingId)
    .eq("user_id", userId)
    .eq("tag_source", "live");

  if (deleteError) {
    return { ok: false, message: deleteError.message };
  }

  if (derived.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const rows = derived.map((d) => ({
    recording_id: recordingId,
    user_id: userId,
    timestamp_ms: d.timestamp_ms,
    end_timestamp_ms: null as number | null,
    speaker_name: d.speaker_name,
    role: d.role,
    note: null as string | null,
    tag_source: "live" as const,
  }));

  const { error: insertError } = await supabase.from("transcript_speaker_tags").insert(rows);

  if (insertError) {
    return { ok: false, message: insertError.message };
  }

  return { ok: true, inserted: derived.length };
}
