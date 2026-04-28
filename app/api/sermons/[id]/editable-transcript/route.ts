/**
 * Editable transcript copy for a single recording.
 *
 *   GET  /api/sermons/:id/editable-transcript
 *     - Returns the editable transcript chunks for this recording.
 *     - If none exists yet, lazily clones from recordings.transcript_chunks
 *       (the *original* Whisper output) so the user has a starting point.
 *
 *   PUT  /api/sermons/:id/editable-transcript
 *     - Saves the user's edited chunks. Never touches the original recording row.
 *
 *   POST /api/sermons/:id/editable-transcript/reset is implemented in the
 *   sibling `reset/route.ts` file.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type RecordingLookup =
  | { error: { status: number; message: string } }
  | { recording: { id: string; transcript_chunks: unknown } };

async function ensureOwnership(
  supabase: any,
  recordingId: string,
  userId: string
): Promise<RecordingLookup> {
  const { data, error } = await supabase
    .from("recordings")
    .select("id, transcript_chunks")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: { status: 500, message: error.message } };
  if (!data) return { error: { status: 404, message: "Recording not found" } };
  return { recording: data };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const ownership = await ensureOwnership(supabase, id, user.id);
    if ("error" in ownership) {
      const { error } = ownership;
      return NextResponse.json(
        { error: "Lookup failed", message: error.message },
        { status: error.status }
      );
    }

    // Look up an existing editable transcript row.
    const { data: existing, error: fetchError } = await supabase
      .from("editable_transcripts")
      .select("id, transcript_chunks, created_at, updated_at")
      .eq("recording_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: "Lookup failed", message: fetchError.message },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json({
        editableTranscript: {
          id: existing.id,
          recordingId: id,
          chunks: Array.isArray(existing.transcript_chunks) ? existing.transcript_chunks : [],
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
          clonedFromOriginal: false,
        },
      });
    }

    // Lazy clone from the original recording's transcript_chunks. The original
    // is never modified — we just copy the JSON across.
    const originalChunks = Array.isArray(ownership.recording.transcript_chunks)
      ? ownership.recording.transcript_chunks
      : [];

    const { data: created, error: insertError } = await supabase
      .from("editable_transcripts")
      .insert({
        recording_id: id,
        user_id: user.id,
        transcript_chunks: originalChunks,
      })
      .select("id, transcript_chunks, created_at, updated_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Could not create editable transcript", message: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      editableTranscript: {
        id: created.id,
        recordingId: id,
        chunks: Array.isArray(created.transcript_chunks) ? created.transcript_chunks : [],
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        clonedFromOriginal: true,
      },
    });
  } catch (error) {
    console.error("editable-transcript GET error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const ownership = await ensureOwnership(supabase, id, user.id);
    if ("error" in ownership) {
      const { error } = ownership;
      return NextResponse.json(
        { error: "Lookup failed", message: error.message },
        { status: error.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const incoming = body?.chunks;
    if (!Array.isArray(incoming)) {
      return NextResponse.json(
        { error: "Bad request", message: "chunks must be an array" },
        { status: 400 }
      );
    }

    const cleaned = incoming
      .filter((c: any) => c && typeof c.text === "string")
      .map((c: any) => ({
        text: String(c.text),
        timestampMs: Math.max(0, Math.floor(Number(c.timestampMs) || 0)),
        isFinal: c.isFinal !== false,
        speaker: typeof c.speaker === "string" ? c.speaker : undefined,
        speakerTag: c.speakerTag === true ? true : false,
        source: c.source || undefined,
      }))
      .sort((a: any, b: any) => (a.timestampMs || 0) - (b.timestampMs || 0));

    // Upsert: create if missing, update if present. Either way the original
    // recordings.transcript_chunks row is untouched.
    const { data: existing } = await supabase
      .from("editable_transcripts")
      .select("id")
      .eq("recording_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("editable_transcripts")
        .update({ transcript_chunks: cleaned })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (updateError) {
        return NextResponse.json(
          { error: "Save failed", message: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase.from("editable_transcripts").insert({
        recording_id: id,
        user_id: user.id,
        transcript_chunks: cleaned,
      });
      if (insertError) {
        return NextResponse.json(
          { error: "Save failed", message: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, chunks: cleaned });
  } catch (error) {
    console.error("editable-transcript PUT error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
