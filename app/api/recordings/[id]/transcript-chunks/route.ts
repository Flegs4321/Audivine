/**
 * API route for updating transcript chunks in a recording
 * PATCH /api/recordings/[id]/transcript-chunks
 * Updates the transcript_chunks field in the recordings table
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update recordings" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Server configuration error", message: "Supabase not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update recordings" },
        { status: 401 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const recordingId = resolvedParams.id;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { transcript_chunks } = body;

    if (!transcript_chunks || !Array.isArray(transcript_chunks)) {
      return NextResponse.json(
        { error: "Bad request", message: "transcript_chunks must be an array" },
        { status: 400 }
      );
    }

    // Update the recording using PostgREST API
    const updateUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${recordingId}&user_id=eq.${user.id}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        transcript_chunks: transcript_chunks,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("[PATCH transcript-chunks] Error updating recording:", errorText);
      return NextResponse.json(
        { error: "Failed to update recording", message: errorText },
        { status: updateResponse.status }
      );
    }

    const result = await updateResponse.json();
    const updatedRecording = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: true,
      recording: updatedRecording,
    });
  } catch (error) {
    console.error("Update transcript chunks API error:", error);
    return NextResponse.json(
      {
        error: "Failed to update transcript chunks",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

