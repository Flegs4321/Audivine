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
    liveTags?: Array<{
      timestampMs?: number;
      endTimestampMs?: number | null;
      speakerName?: string;
      role?: string;
    }> | null;
  }
): Promise<{ ok: true; inserted: number } | { ok: false; message: string }> {
  const { recordingId, userId } = params;
  const chunks = Array.isArray(params.transcriptChunks)
    ? params.transcriptChunks
    : [];

  const explicitTags = Array.isArray(params.liveTags)
    ? params.liveTags
        .map((tag) => {
          const speakerName = String(tag?.speakerName || "").trim();
          const role = tag?.role === "sermon" ? "sermon" : tag?.role === "sharing" ? "sharing" : null;
          if (!speakerName || !role) return null;
          const timestampMs = Math.max(0, Math.floor(Number(tag?.timestampMs) || 0));
          const endTimestampMs =
            tag?.endTimestampMs == null
              ? null
              : Math.max(timestampMs, Math.floor(Number(tag.endTimestampMs) || timestampMs));
          return {
            timestamp_ms: timestampMs,
            end_timestamp_ms: endTimestampMs,
            speaker_name: speakerName,
            role,
          };
        })
        .filter((tag): tag is {
          timestamp_ms: number;
          end_timestamp_ms: number | null;
          speaker_name: string;
          role: "sharing" | "sermon";
        } => tag !== null)
    : [];

  const derived =
    explicitTags.length > 0
      ? explicitTags
      : deriveLiveSpeakerTagsFromChunks(
          chunks as { text?: string; timestampMs?: number; speakerTag?: boolean }[]
        ).map((tag) => ({ ...tag, end_timestamp_ms: null as number | null }));

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
    end_timestamp_ms: d.end_timestamp_ms,
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
