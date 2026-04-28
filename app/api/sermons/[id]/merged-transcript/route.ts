/**
 * Merged transcript: editable transcript + timestamped speaker tags.
 *
 *   GET /api/sermons/:id/merged-transcript
 *
 * This is the format consumed by the member-summary endpoint and the UI's
 * "preview merged" view. It NEVER mutates either transcript or any tags —
 * only reads them and combines the strings on the fly.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";
import { mergeTranscriptWithTags, SpeakerTag, TranscriptChunk } from "@/lib/transcript/merge";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    // Pull all three sources in parallel: original (fallback), editable, tags.
    const [recordingRes, editableRes, tagsRes] = await Promise.all([
      supabase
        .from("recordings")
        .select("id, transcript_chunks")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("editable_transcripts")
        .select("transcript_chunks")
        .eq("recording_id", id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("transcript_speaker_tags")
        .select("*")
        .eq("recording_id", id)
        .eq("user_id", user.id)
        .order("timestamp_ms", { ascending: true }),
    ]);

    if (recordingRes.error) {
      return NextResponse.json(
        { error: "Lookup failed", message: recordingRes.error.message },
        { status: 500 }
      );
    }
    if (!recordingRes.data) {
      return NextResponse.json(
        { error: "Not found", message: "Recording not found" },
        { status: 404 }
      );
    }
    if (editableRes.error) {
      return NextResponse.json(
        { error: "Lookup failed", message: editableRes.error.message },
        { status: 500 }
      );
    }
    if (tagsRes.error) {
      return NextResponse.json(
        { error: "Lookup failed", message: tagsRes.error.message },
        { status: 500 }
      );
    }

    const editableChunks: TranscriptChunk[] = Array.isArray(editableRes.data?.transcript_chunks)
      ? (editableRes.data!.transcript_chunks as TranscriptChunk[])
      : Array.isArray(recordingRes.data.transcript_chunks)
        ? (recordingRes.data.transcript_chunks as TranscriptChunk[])
        : [];

    const tags: SpeakerTag[] = (tagsRes.data || []).map((row: any) => ({
      id: row.id,
      timestampMs: row.timestamp_ms,
      endTimestampMs: row.end_timestamp_ms,
      speakerName: row.speaker_name,
      role: row.role,
      note: row.note,
    }));

    const merged = mergeTranscriptWithTags(editableChunks, tags);

    return NextResponse.json({
      recordingId: id,
      sourceTranscript: editableRes.data ? "editable" : "original",
      tagCount: tags.length,
      ...merged,
    });
  } catch (error) {
    console.error("merged-transcript GET error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
