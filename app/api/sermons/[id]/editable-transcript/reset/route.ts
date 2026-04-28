/**
 * Reset the editable transcript for a recording back to the original
 * Whisper output stored on the `recordings` row. The original is never
 * touched — we only overwrite the editable copy.
 *
 * POST /api/sermons/:id/editable-transcript/reset
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";

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
      .select("transcript_chunks")
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

    const original = Array.isArray(recording.transcript_chunks) ? recording.transcript_chunks : [];

    const { data: existing } = await supabase
      .from("editable_transcripts")
      .select("id")
      .eq("recording_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("editable_transcripts")
        .update({ transcript_chunks: original })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (updateError) {
        return NextResponse.json(
          { error: "Reset failed", message: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase.from("editable_transcripts").insert({
        recording_id: id,
        user_id: user.id,
        transcript_chunks: original,
      });
      if (insertError) {
        return NextResponse.json(
          { error: "Reset failed", message: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, chunks: original });
  } catch (error) {
    console.error("editable-transcript reset error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
