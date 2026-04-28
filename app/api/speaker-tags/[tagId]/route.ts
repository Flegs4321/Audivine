/**
 * Update or delete a single speaker tag.
 *
 *   PUT    /api/speaker-tags/:tagId  -> partial update
 *   DELETE /api/speaker-tags/:tagId  -> delete
 *
 * Tags are stored independently of transcript text, so changing them never
 * modifies the original or editable transcript.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ tagId: string }>;
}

const ALLOWED_ROLES = ["sharing", "sermon", "general"] as const;

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { tagId } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (typeof body?.speakerName === "string") {
      const v = body.speakerName.trim();
      if (!v) {
        return NextResponse.json(
          { error: "Bad request", message: "speakerName cannot be empty" },
          { status: 400 }
        );
      }
      updates.speaker_name = v;
    }
    if (body?.role !== undefined) {
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json(
          { error: "Bad request", message: `role must be one of: ${ALLOWED_ROLES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.role = body.role;
    }
    if (body?.timestampMs !== undefined) {
      updates.timestamp_ms = Math.max(0, Math.floor(Number(body.timestampMs) || 0));
    }
    if (body?.endTimestampMs !== undefined) {
      updates.end_timestamp_ms =
        body.endTimestampMs == null ? null : Math.max(0, Math.floor(Number(body.endTimestampMs) || 0));
    }
    if (body?.note !== undefined) {
      updates.note = typeof body.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Bad request", message: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("transcript_speaker_tags")
      .update(updates)
      .eq("id", tagId)
      .eq("user_id", user.id)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Update failed", message: error.message },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Not found", message: "Speaker tag not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      tag: {
        id: data.id,
        recordingId: data.recording_id,
        timestampMs: data.timestamp_ms,
        endTimestampMs: data.end_timestamp_ms,
        speakerName: data.speaker_name,
        role: data.role,
        note: data.note,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    console.error("speaker-tag PUT error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { tagId } = await params;
    const auth = await authenticate(request);
    if (isErrorResponse(auth)) return auth;
    const { supabase, user } = auth;

    const { error } = await supabase
      .from("transcript_speaker_tags")
      .delete()
      .eq("id", tagId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Delete failed", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("speaker-tag DELETE error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
