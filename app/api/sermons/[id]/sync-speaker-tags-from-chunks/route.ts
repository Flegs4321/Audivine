/**
 * POST /api/sermons/:id/sync-speaker-tags-from-chunks
 *
 * Reads recordings.transcript_chunks, derives transcript_speaker_tags rows from
 * speakerTag markers (live recorder), replaces tag_source = live for this recording.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";
import { syncLiveSpeakerTagsFromRecordingChunks } from "@/lib/transcript/syncLiveSpeakerTags";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const { data: recording, error: lookupError } = await supabase
      .from("recordings")
      .select("id, transcript_chunks")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: "Lookup failed", message: lookupError.message },
        { status: 500 }
      );
    }
    if (!recording) {
      return NextResponse.json(
        { error: "Not found", message: "Recording not found" },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const liveTags = Array.isArray(body?.liveTags) ? body.liveTags : null;

    const result = await syncLiveSpeakerTagsFromRecordingChunks(supabase, {
      recordingId: id,
      userId: user.id,
      transcriptChunks: recording.transcript_chunks,
      liveTags,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Sync failed", message: result.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: result.inserted,
      recordingId: id,
    });
  } catch (error) {
    console.error("sync-speaker-tags-from-chunks POST error:", error);
    return NextResponse.json(
      {
        error: "Server error",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 }
    );
  }
}
