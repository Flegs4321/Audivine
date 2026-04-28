/**
 * Speaker tags for a recording.
 *
 *   GET  /api/sermons/:id/speaker-tags  -> { tags: SpeakerTag[] }
 *   POST /api/sermons/:id/speaker-tags  -> create one
 *
 * Single-tag updates and deletes live in /api/speaker-tags/[tagId]/route.ts.
 *
 * These rows are independent of any transcript text, so creating, editing or
 * deleting a tag never modifies the original or editable transcript.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["sharing", "sermon", "general"] as const;

function rowToTag(row: any) {
  return {
    id: row.id,
    recordingId: row.recording_id,
    timestampMs: row.timestamp_ms,
    endTimestampMs: row.end_timestamp_ms,
    speakerName: row.speaker_name,
    role: row.role,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const { data, error } = await supabase
      .from("transcript_speaker_tags")
      .select("*")
      .eq("recording_id", id)
      .eq("user_id", user.id)
      .order("timestamp_ms", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Lookup failed", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ tags: (data || []).map(rowToTag) });
  } catch (error) {
    console.error("speaker-tags GET error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    // Verify ownership of the recording the tag will attach to.
    const { data: recording, error: lookupError } = await supabase
      .from("recordings")
      .select("id")
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
    const speakerName = String(body?.speakerName || "").trim();
    const role = String(body?.role || "general") as (typeof ALLOWED_ROLES)[number];
    const timestampMs = Math.max(0, Math.floor(Number(body?.timestampMs) || 0));
    const endTimestampMs =
      body?.endTimestampMs == null
        ? null
        : Math.max(timestampMs, Math.floor(Number(body.endTimestampMs)));
    const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null;

    if (!speakerName) {
      return NextResponse.json(
        { error: "Bad request", message: "speakerName is required" },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "Bad request", message: `role must be one of: ${ALLOWED_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    const { data: created, error: insertError } = await supabase
      .from("transcript_speaker_tags")
      .insert({
        recording_id: id,
        user_id: user.id,
        timestamp_ms: timestampMs,
        end_timestamp_ms: endTimestampMs,
        speaker_name: speakerName,
        role,
        note,
        tag_source: "manual",
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Create failed", message: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ tag: rowToTag(created) });
  } catch (error) {
    console.error("speaker-tags POST error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
